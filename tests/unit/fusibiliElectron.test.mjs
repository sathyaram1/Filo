// #1905.1 — Il fusibile dei privilegi file:// si spegne in ogni filo del binario, su ogni sistema del pacchetto, e il
// motore delle prove gira spento anche quando i moduli non sono di questo checkout (una copia, non il binario altrui).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const F = require('../../scripts/lib/fusibili-electron.js');

// Un binario finto: rumore, il filo (versione 1, nove fusibili, il settimo acceso), altro rumore; `fili` volte.
function binario(file, { fili = 1, stato = '1', versione = 1, lunghezza = 9 } = {}) {
  const pezzi = [Buffer.alloc(5000, 7)];
  for (let i = 0; i < fili; i++) {
    const filo = Buffer.from(`1011000${stato}1`.slice(0, lunghezza));
    pezzi.push(F.SENTINELLA, Buffer.from([versione, lunghezza]), filo, Buffer.alloc(3000, 9));
  }
  writeFileSync(file, Buffer.concat(pezzi));
  return file;
}
const fusibili = (file) => {
  const b = readFileSync(file);
  const out = [];
  for (let i = b.indexOf(F.SENTINELLA); i !== -1; i = b.indexOf(F.SENTINELLA, i + 1)) out.push(b.subarray(i + F.SENTINELLA.length + 2, i + F.SENTINELLA.length + 11).toString());
  return out;
};

test('spegne solo GrantFileProtocolExtraPrivileges, in tutti e due i fili di un binario universale, e la seconda volta non tocca niente', () => {
  const dir = cartellaTemporanea('fusibili-');
  try {
    const file = binario(join(dir, 'electron'), { fili: 2 });
    assert.equal(F.privilegiFile(file), 'acceso');
    assert.equal(F.spegniPrivilegiFile(file), true);
    assert.deepEqual(fusibili(file), ['101100001', '101100001']);
    assert.equal(F.privilegiFile(file), 'spento');
    assert.equal(F.spegniPrivilegiFile(file), false);
  } finally { togliCartella(dir); }
});

test('un binario senza filo, con un filo di un\'altra versione o troppo corto fa fermare, non passa per spento', () => {
  const dir = cartellaTemporanea('fusibili-');
  try {
    writeFileSync(join(dir, 'nudo'), Buffer.alloc(9000, 1));
    assert.throws(() => F.spegniPrivilegiFile(join(dir, 'nudo')), /nessun filo/);
    assert.throws(() => F.privilegiFile(binario(join(dir, 'v2'), { versione: 2 })), /versione 2/);
    assert.throws(() => F.privilegiFile(binario(join(dir, 'corto'), { lunghezza: 7 })), /non arriva/);
    assert.throws(() => F.privilegiFile(binario(join(dir, 'tolto'), { stato: 'r' })), /tolto/);
  } finally { togliCartella(dir); }
});

test('il filo di un\'app per Mac sta nel framework, sia dal nome dell\'app sia dal suo eseguibile', () => {
  const fw = join('/x/Filo.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework');
  assert.equal(F.fileDelFilo('/x/Filo.app'), fw);
  assert.equal(F.fileDelFilo('/x/Filo.app/Contents/MacOS/Filo'), fw);
  assert.equal(F.fileDelFilo('/x/filo'), '/x/filo');
});

test('after-pack spegne il fusibile sull\'eseguibile di ogni sistema, e prima del lanciatore di Linux', async () => {
  const dir = cartellaTemporanea('fusibili-');
  try {
    const casi = [
      ['win32', 'Filo.exe'],
      ['linux', 'filo'],
      ['darwin', join('Filo.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')],
    ];
    for (const [sistema, nome] of casi) {
      const out = join(dir, sistema);
      mkdirSync(join(out, nome, '..'), { recursive: true });
      binario(join(out, nome));
      const context = { electronPlatformName: sistema, appOutDir: out, packager: { appInfo: { productFilename: 'Filo' }, executableName: 'filo' } };
      await F.afterPack(context);
      assert.deepEqual(fusibili(join(out, nome)), ['101100001'], sistema);
    }
    const smistatore = readFileSync(new URL('../../scripts/after-pack.js', import.meta.url), 'utf8');
    const chiamate = ['fusibili.afterPack', 'mac.default', 'linux.default'].map((c) => smistatore.indexOf(c));
    assert.ok(chiamate.every((i) => i > 0) && chiamate[0] < chiamate[1] && chiamate[0] < chiamate[2], 'il fusibile va prima della firma del Mac e del lanciatore di Linux');
    const senzaEseguibile = { electronPlatformName: 'linux', appOutDir: join(dir, 'vuota'), packager: { appInfo: { productFilename: 'Filo' }, executableName: 'filo' } };
    await assert.rejects(() => F.afterPack(senzaEseguibile), 'un pacchetto senza fusibile spento non esce');
  } finally { togliCartella(dir); }
});

// Un progetto con node_modules/electron: suo, o collegato da un'altra cartella come nei cloni delle routine.
function progetto(dir, { collegato = false } = {}) {
  const radice = join(dir, 'progetto');
  mkdirSync(join(radice, 'node_modules'), { recursive: true });
  const electron = collegato ? join(dir, 'altrove', 'electron') : join(radice, 'node_modules', 'electron');
  mkdirSync(join(electron, 'dist'), { recursive: true });
  writeFileSync(join(electron, 'package.json'), '{"name":"electron","version":"44.0.0"}');
  writeFileSync(join(electron, 'path.txt'), 'electron');
  writeFileSync(join(electron, 'dist', 'version'), '44.0.0');
  binario(join(electron, 'dist', 'electron'));
  if (collegato) symlinkSync(electron, join(radice, 'node_modules', 'electron'), 'junction');
  return { radice, binarioOriginale: join(electron, 'dist', 'electron') };
}

test('il motore di questo checkout si spegne sul posto', () => {
  const dir = cartellaTemporanea('fusibili-');
  try {
    const { radice, binarioOriginale } = progetto(dir);
    const m = F.motoreSenzaPrivilegi({ radice, cache: join(dir, 'cache') });
    assert.equal(m.copia, false);
    assert.equal(F.privilegiFile(binarioOriginale), 'spento');
  } finally { togliCartella(dir); }
});

test('il motore di un\'altra cartella non si tocca: le prove ne usano una copia spenta, riusata dalla corsa dopo', () => {
  const dir = cartellaTemporanea('fusibili-');
  try {
    const { radice, binarioOriginale } = progetto(dir, { collegato: true });
    const m = F.motoreSenzaPrivilegi({ radice, cache: join(dir, 'cache') });
    assert.equal(m.copia, true, m.errore);
    assert.equal(F.privilegiFile(binarioOriginale), 'acceso', 'il binario dell\'altra cartella resta com\'era');
    assert.equal(F.privilegiFile(join(m.dist, 'electron')), 'spento');
    assert.equal(readFileSync(join(m.dist, 'version'), 'utf8'), '44.0.0');
    assert.deepEqual(F.motoreSenzaPrivilegi({ radice, cache: join(dir, 'cache') }), m);
    assert.match(F.motoreSenzaPrivilegi({ radice }).errore, /copia/, 'senza cartella per la copia lo dice');
  } finally { togliCartella(dir); }
});
