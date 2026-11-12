// I rossi di una corsa come annotazioni di GitHub (scripts/annotazioni-github.mjs): l'unica parte di una corsa che dalla
// cloud delle routine si legge (registri e allegati stanno su un archivio che da lì non si raggiunge, #1429).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { annotazioni, dato, proprieta, MAX_ANNOTAZIONI, BYTE_PER_ANNOTAZIONE } from '../../scripts/annotazioni-github.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'annotazioni-github.mjs');

/** Il messaggio di un comando `::error …::`, decodificato come lo decodifica GitHub. */
const messaggio = (cmd) => cmd.slice(cmd.indexOf('::', 2) + 2).replace(/%0A/g, '\n').replace(/%0D/g, '\r').replace(/%25/g, '%');
const titolo = (cmd) => cmd.match(/^::error title=([^:]*)::/)[1].replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%25/g, '%');

test('due rossi: una sola annotazione d\'errore, una riga per rosso, col numero nel titolo', () => {
  const righe = ['tests/a.spec.mjs › il menu si apre', '', '  tests/b.spec.mjs › describe › 100% delle voci, anche «quella»  '];
  const out = annotazioni(righe, 'Rossi nuovi della suite');
  assert.equal(out.length, 1);
  assert.match(out[0], /^::error title=[^\n]*::[^\n]*$/, 'un comando di workflow sta su una riga sola');
  assert.equal(titolo(out[0]), 'Rossi nuovi della suite (2)');
  assert.equal(messaggio(out[0]), 'tests/a.spec.mjs › il menu si apre\ntests/b.spec.mjs › describe › 100% delle voci, anche «quella»');
});

test('nessun rosso, nessuna annotazione', () => {
  assert.deepEqual(annotazioni(['', '   ']), []);
  assert.deepEqual(annotazioni(undefined), []);
});

test('i caratteri che chiudono il comando si codificano, nel dato e nel titolo', () => {
  assert.equal(dato('50%\r\nfine'), '50%25%0D%0Afine');
  assert.equal(proprieta('a: b, c'), 'a%3A b%2C c');
  const [cmd] = annotazioni(['x::error title=finto::y'], 'T: uno, due');
  assert.equal(titolo(cmd), 'T: uno, due (1)');
  assert.equal(messaggio(cmd), 'x::error title=finto::y', 'un «::» nel testo di un rosso non apre un altro comando');
});

test('un elenco lungo va a pezzi di righe intere, sotto il tetto di GitHub, e nessuna riga si perde', () => {
  const righe = Array.from({ length: 120 }, (_, i) => `tests/spec-${i}.spec.mjs › un caso con un titolo piuttosto lungo, come quelli veri di Filo ${i}`);
  const out = annotazioni(righe, 'Rossi');
  assert.ok(out.length > 1 && out.length <= MAX_ANNOTAZIONI, `pezzi: ${out.length}`);
  for (const c of out) assert.ok(Buffer.byteLength(messaggio(c), 'utf8') <= BYTE_PER_ANNOTAZIONE);
  assert.deepEqual(out.flatMap((c) => messaggio(c).split('\n')), righe);
  assert.equal(titolo(out[0]), `Rossi (120, parte 1 di ${out.length})`);
});

test('oltre le dieci annotazioni il taglio si dice, col numero delle righe che mancano', () => {
  const righe = Array.from({ length: 2000 }, (_, i) => `tests/s-${i}.spec.mjs › caso ${'x'.repeat(60)} ${i}`);
  const out = annotazioni(righe);
  assert.equal(out.length, MAX_ANNOTAZIONI);
  const viste = out.slice(0, -1).flatMap((c) => messaggio(c).split('\n'));
  const ultimo = messaggio(out.at(-1));
  assert.match(ultimo, new RegExp(`altre ${righe.length - viste.length} righe`));
  assert.deepEqual(viste, righe.slice(0, viste.length));
});

test('una riga sola più lunga del tetto si accorcia dicendolo, invece di sparire', () => {
  const [cmd] = annotazioni([`errore fuori dai casi: ${'è'.repeat(5000)}`]);
  const m = messaggio(cmd);
  assert.ok(Buffer.byteLength(m, 'utf8') <= BYTE_PER_ANNOTAZIONE);
  assert.match(m, /^errore fuori dai casi: è+ … \(riga accorciata/);
});

test('da riga di comando: stampa i comandi, e senza file non stampa niente ed esce 0', () => {
  const dir = cartellaTemporanea('annotazioni-');
  try {
    const f = join(dir, 'rossi.txt');
    writeFileSync(f, 'tests/a.spec.mjs › uno\r\ntests/b.spec.mjs › due\r\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, f, 'Rossi nuovi della suite'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.equal(messaggio(r.stdout.trim()), 'tests/a.spec.mjs › uno\ntests/b.spec.mjs › due');
    const vuoto = spawnSync(process.execPath, [CLI, join(dir, 'non-esiste.txt'), 'X'], { encoding: 'utf8' });
    assert.equal(vuoto.status, 0);
    assert.equal(vuoto.stdout, '');
  } finally {
    togliCartella(dir);
  }
});
