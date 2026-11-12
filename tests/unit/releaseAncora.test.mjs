// Il citofono della ricetta verso l'àncora delle release (#1501): cosa manda al server, quando non chiede nemmeno,
// e come una risposta diventa un'uscita. Il server finto qui è una funzione: nessuna rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import {
  fileDelYml, fileDaAncorare, classificaAncora, exitCodeAncora, messaggioAncora, chiediAncora, main, YML,
} from '../../scripts/release-ancora.mjs';

const sha = (s) => createHash('sha512').update(s).digest('base64');

function dist(file, { yml = YML.Windows, dichiarate = {} } = {}) {
  const cartella = cartellaTemporanea('filo-release-ancora-');
  const righe = ['version: 0.2.247', 'files:'];
  for (const [nome, contenuto] of Object.entries(file)) {
    writeFileSync(join(cartella, nome), contenuto);
    righe.push(`  - url: ${nome}`, `    sha512: ${dichiarate[nome] || sha(contenuto)}`, `    size: ${contenuto.length}`);
  }
  const primo = Object.keys(file)[0];
  righe.push(`path: ${primo}`, `sha512: ${dichiarate[primo] || sha(file[primo])}`, "releaseDate: '2026-10-22T10:00:00.000Z'");
  writeFileSync(join(cartella, yml), `${righe.join('\n')}\n`);
  return cartella;
}

function server(...risposte) {
  const chieste = [];
  const fetchImpl = async (url, init) => {
    chieste.push({ url, corpo: JSON.parse(init.body) });
    const r = risposte.length > 1 ? risposte.shift() : risposte[0];
    if (r instanceof Error) throw r;
    return { status: r.status, text: async () => JSON.stringify(r.corpo || {}) };
  };
  return { chieste, fetchImpl };
}
const subito = { attese: [1, 1], dormi: async () => {} };

test('fileDelYml: le voci di files, o path quando manca; virgolette e a capo di Windows', () => {
  const mac = "version: 0.2.247\nfiles:\n  - url: Filo-Mac.zip\n    sha512: Zz==\n    size: 3\n  - url: 'Filo-Mac.dmg'\n    sha512: \"Dd==\"\n    size: 4\npath: Filo-Mac.zip\nsha512: Zz==\n";
  assert.deepEqual(fileDelYml(mac), [{ nome: 'Filo-Mac.zip', sha512: 'Zz==' }, { nome: 'Filo-Mac.dmg', sha512: 'Dd==' }]);
  assert.deepEqual(fileDelYml(mac.replace(/\n/g, '\r\n')), fileDelYml(mac));
  assert.deepEqual(fileDelYml('version: 1.0.0\npath: Filo-Setup.exe\nsha512: Ss==\n'), [{ nome: 'Filo-Setup.exe', sha512: 'Ss==' }]);
  assert.deepEqual(fileDelYml('version: 1.0.0\nfiles:\n  - url: a.exe\n    sha2: hh\n'), [{ nome: 'a.exe', sha512: '' }]);
  assert.deepEqual(fileDelYml(''), []);
});

test('i file costruiti si controllano qui: ci sono, e hanno l\'impronta che il yml dichiara', async () => {
  const buona = dist({ 'Filo-Setup.exe': 'MZ vero' });
  assert.deepEqual(await fileDaAncorare({ cartella: buona, piattaforma: 'Windows' }), { file: [{ nome: 'Filo-Setup.exe', sha512: sha('MZ vero') }] });

  const mac = dist({ 'Filo-Mac.zip': 'zip', 'Filo-Mac.dmg': 'dmg' }, { yml: YML.Mac });
  assert.deepEqual((await fileDaAncorare({ cartella: mac, piattaforma: 'Mac' })).file.map((f) => f.nome), ['Filo-Mac.zip', 'Filo-Mac.dmg']);

  const casi = [
    [{ cartella: buona, piattaforma: 'Linux' }, /manca latest-linux\.yml/],
    [{ cartella: buona, piattaforma: 'Amiga' }, /piattaforma sconosciuta/],
    [{ cartella: dist({ 'Filo-Setup.exe': 'MZ sostituito' }, { dichiarate: { 'Filo-Setup.exe': sha('MZ vero') } }), piattaforma: 'Windows' }, /non ha l'impronta/],
  ];
  for (const [arg, atteso] of casi) assert.match((await fileDaAncorare(arg)).errore, atteso);

  const fuori = dist({ 'Filo-Setup.exe': 'MZ' });
  writeFileSync(join(fuori, YML.Windows), `files:\n  - url: ../altro/Filo-Setup.exe\n    sha512: ${sha('MZ')}\n`);
  assert.match((await fileDaAncorare({ cartella: fuori, piattaforma: 'Windows' })).errore, /nome fuori forma/);
  writeFileSync(join(fuori, YML.Windows), `files:\n  - url: Filo-Assente.exe\n    sha512: ${sha('MZ')}\n`);
  assert.match((await fileDaAncorare({ cartella: fuori, piattaforma: 'Windows' })).errore, /non c'è/);
});

test('al server vanno parola d\'ordine, versione, piattaforma e i file con le loro impronte, e nient\'altro', async () => {
  const cartella = dist({ 'Filo-Linux.AppImage': 'ELF' }, { yml: YML.Linux });
  const s = server({ status: 200, corpo: { ok: true, ancorati: ['Filo-Linux.AppImage'], gia: [] } });
  const codice = await main(['--piattaforma', 'Linux', '--cartella', cartella, '--versione', 'v0.2.247'],
    { FILO_BUILD_PASSPHRASE: '  parola\n' }, { fetchImpl: s.fetchImpl, url: 'https://server.test/releaseAnchor', ...subito });
  assert.equal(codice, 0);
  assert.equal(s.chieste.length, 1);
  assert.equal(s.chieste[0].url, 'https://server.test/releaseAnchor');
  assert.deepEqual(s.chieste[0].corpo, {
    passphrase: 'parola', versione: 'v0.2.247', piattaforma: 'Linux', file: [{ nome: 'Filo-Linux.AppImage', sha512: sha('ELF') }],
  });
});

test('senza versione in forma, parola d\'ordine o file giusti non si chiede niente, e si esce con 2', async () => {
  const cartella = dist({ 'Filo-Setup.exe': 'MZ' });
  const s = server({ status: 200, corpo: { ok: true } });
  const corsa = (argv, env = { FILO_BUILD_PASSPHRASE: 'p' }) => main(argv, env, { fetchImpl: s.fetchImpl, ...subito });
  assert.equal(await corsa(['--piattaforma', 'Windows', '--cartella', cartella, '--versione', '0.2.247']), 2);
  assert.equal(await corsa(['--piattaforma', 'Windows', '--cartella', cartella]), 2);
  assert.equal(await corsa(['--piattaforma', 'Mac', '--cartella', cartella, '--versione', 'v0.2.247']), 2);
  assert.equal(await corsa(['--piattaforma', 'Windows', '--cartella', cartella, '--versione', 'v0.2.247'], {}), 2);
  assert.equal(s.chieste.length, 0);
});

test('un server che non risponde si ritenta; un no no', async () => {
  const lento = server({ status: 503 }, new Error('ECONNRESET'), { status: 200, corpo: { ok: true, ancorati: ['a'], gia: [] } });
  const r = await chiediAncora({ passphrase: 'p', versione: 'v1.0.0', piattaforma: 'Windows', file: [], fetchImpl: lento.fetchImpl, ...subito });
  assert.equal(r.outcome, 'done');
  assert.equal(lento.chieste.length, 3);

  const sempreGiu = server({ status: 502 });
  assert.equal((await chiediAncora({ passphrase: 'p', fetchImpl: sempreGiu.fetchImpl, ...subito })).outcome, 'unreachable');
  assert.equal(sempreGiu.chieste.length, 3, 'dopo due attese si smette');

  const conflitto = server({ status: 409, corpo: { reason: 'impronta_diversa' } });
  assert.equal((await chiediAncora({ passphrase: 'p', fetchImpl: conflitto.fetchImpl, ...subito })).outcome, 'conflict');
  assert.equal(conflitto.chieste.length, 1);
});

test('le risposte del server: tre famiglie, tre uscite', () => {
  const casi = [
    [200, { ok: true, ancorati: ['a'], gia: ['b'] }, 'done', 0],
    [200, { ok: false }, 'fault', 3],
    [409, { reason: 'impronta_diversa' }, 'conflict', 2],
    [400, { reason: 'allegato_diverso' }, 'rejected', 2],
    [401, {}, 'denied', 2],
    [403, {}, 'denied', 2],
    [404, {}, 'not_deployed', 3],
    [429, {}, 'unreachable', 3],
    [500, {}, 'unreachable', 3],
    [0, {}, 'unreachable', 3],
  ];
  for (const [status, corpo, esito, codice] of casi) {
    const r = classificaAncora(status, corpo);
    assert.equal(r.outcome, esito, `${status}`);
    assert.equal(exitCodeAncora(r), codice, `${status}`);
    assert.ok(messaggioAncora(r, 'v1.0.0').startsWith('[release-ancora]'));
  }
  assert.equal(exitCodeAncora({ outcome: 'no_passphrase' }), 2);
  assert.equal(exitCodeAncora({ outcome: 'local', reason: 'x' }), 2);
  assert.match(messaggioAncora(classificaAncora(200, { ok: true, ancorati: [], gia: ['Filo-Setup.exe'] }), 'v1.0.0'), /già ancorati uguali: Filo-Setup\.exe/);
});
