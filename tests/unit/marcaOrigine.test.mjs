// #1510 — la marca d'origine del sistema sui file scaricati: senza, un file aperto da fuori Filo salta SmartScreen,
// Gatekeeper e la Visualizzazione protetta. Il ramo Windows lo prova davvero il lavoro unit-windows; quello Mac si
// prova da qui con un xattr finto; su Linux non si scrive niente e non si rompe niente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DL = require(join(ROOT, 'src', 'main', 'services', 'downloads.js'));

const HOST = 'https://utente:segreto@cdn.esempio.it/file/setup.exe?v=2#token=abc';
const PAGINA = 'https://chiave@blog.esempio.it/articolo#commenti';

test('la marca dice zona Internet, chi ha servito i byte e la pagina, senza credenziali', () => {
  const t = DL._testoZoneIdentifier({ hostUrl: 'https://utente:segreto@blog.esempio.it/file/setup.exe?v=2#token=abc', referrerUrl: PAGINA });
  assert.equal(t, '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://blog.esempio.it/articolo\r\nHostUrl=https://blog.esempio.it/file/setup.exe?v=2\r\n');
  assert.ok(!/segreto|utente|chiave|token/.test(t), t);
});

test('un file servito da un altro sito si porta dietro solo l’origine della pagina, come il Referer', () => {
  const t = DL._testoZoneIdentifier({ hostUrl: HOST, referrerUrl: 'https://blog.esempio.it/cerca?q=fattura+mario' });
  assert.equal(t, '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://blog.esempio.it/\r\nHostUrl=https://cdn.esempio.it/file/setup.exe?v=2\r\n');
});

test('in incognito la marca arma gli avvisi ma non porta indirizzi', () => {
  const t = DL._testoZoneIdentifier({ hostUrl: HOST, referrerUrl: PAGINA, incognito: true });
  assert.equal(t, '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=about:internet\r\n');
});

test('un file fabbricato dalla pagina (data:, blob:) resta zona Internet, senza un indirizzo che non vuol dire niente', () => {
  for (const host of ['data:application/octet-stream;base64,TVo=', 'blob:https://esempio.it/1234', '', 'non un url']) {
    const t = DL._testoZoneIdentifier({ hostUrl: host, referrerUrl: 'filo://feedback' });
    assert.equal(t, '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=about:internet\r\n', host);
  }
});

test('su Mac la quarantena porta la data in esadecimale e il nome di chi ha scaricato', () => {
  assert.equal(DL._valoreQuarantena(Date.UTC(2026, 9, 22)), `0081;${(Date.UTC(2026, 9, 22) / 1000).toString(16)};Filo;`);
  assert.match(DL._valoreQuarantena(), /^0081;[0-9a-f]{8};Filo;$/);
});

test('su Mac la marca passa da xattr sul file finale; un xattr che manca non rompe lo scaricamento', async () => {
  const chiamate = [];
  const ok = await DL.marcaOrigine('/Users/a b/Downloads/setup.exe', { hostUrl: HOST }, {
    platform: 'darwin',
    execFile: (cmd, args, cb) => { chiamate.push([cmd, args]); cb(null); },
  });
  assert.equal(ok, true);
  assert.equal(chiamate.length, 1);
  const [cmd, args] = chiamate[0];
  assert.equal(cmd, '/usr/bin/xattr');
  assert.deepEqual(args.slice(0, 2), ['-w', 'com.apple.quarantine']);
  assert.match(args[2], /^0081;[0-9a-f]+;Filo;$/);
  assert.equal(args[3], '/Users/a b/Downloads/setup.exe');

  const fallita = await DL.marcaOrigine('/x', {}, { platform: 'darwin', execFile: (_c, _a, cb) => cb(new Error('ENOENT')) });
  assert.equal(fallita, false);
  const esplosa = await DL.marcaOrigine('/x', {}, { platform: 'darwin', execFile: () => { throw new Error('spawn'); } });
  assert.equal(esplosa, false);
});

test('senza file non si marca niente', async () => {
  assert.equal(await DL.marcaOrigine('', { hostUrl: HOST }), false);
});

test('su Windows lo stream Zone.Identifier sta davvero sul file', { skip: process.platform !== 'win32' && 'lo stream esiste solo su NTFS' }, async () => {
  const dir = cartellaTemporanea('filo-marca-');
  const file = join(dir, 'setup.exe');
  writeFileSync(file, 'MZ');
  assert.equal(await DL.marcaOrigine(file, { hostUrl: HOST, referrerUrl: PAGINA }), true);
  const marca = readFileSync(`${file}:Zone.Identifier`, 'utf8');
  assert.match(marca, /ZoneId=3/);
  assert.match(marca, /HostUrl=https:\/\/cdn\.esempio\.it\/file\/setup\.exe\?v=2/);
  assert.match(marca, /ReferrerUrl=https:\/\/blog\.esempio\.it\/\r\n/);
  assert.equal(readFileSync(file, 'utf8'), 'MZ');

  const privato = join(dir, 'privato.exe');
  writeFileSync(privato, 'MZ');
  assert.equal(await DL.marcaOrigine(privato, { hostUrl: HOST, referrerUrl: PAGINA, incognito: true }), true);
  const marcaPrivata = readFileSync(`${privato}:Zone.Identifier`, 'utf8');
  assert.match(marcaPrivata, /ZoneId=3/);
  assert.ok(!/esempio/.test(marcaPrivata), marcaPrivata);

  // Una cartella che non c'è: nessuna eccezione, e chi chiama sa che la marca non c'è.
  assert.equal(await DL.marcaOrigine(join(dir, 'manca', 'x.exe'), { hostUrl: HOST }), false);
});

test('su Linux non si scrive niente accanto al file e non si lancia', { skip: process.platform !== 'linux' && 'ramo Linux' }, async () => {
  const dir = cartellaTemporanea('filo-marca-');
  const file = join(dir, 'setup.exe');
  writeFileSync(file, 'MZ');
  assert.equal(await DL.marcaOrigine(file, { hostUrl: HOST, referrerUrl: PAGINA }), false);
  assert.deepEqual(readdirSync(dir), ['setup.exe']);
  assert.ok(!existsSync(`${file}:Zone.Identifier`));
  assert.equal(readFileSync(file, 'utf8'), 'MZ');
});
