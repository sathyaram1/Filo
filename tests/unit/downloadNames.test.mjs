// Unit test per i nomi file degli scaricamenti (#410.1) — logica pura, niente
// Electron. Due invarianti:
//   1. safeName: il nome che arriva DAL SERVER non deve poter uscire dalla
//      cartella Download né portare caratteri di percorso/controllo;
//   2. shortName: l'avviso di fine scaricamento deve restare un riquadro
//      leggibile anche con un nome lunghissimo (senza accorciarlo, il toast
//      diventava un muro di testo), conservando l'estensione.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DL = require(join(ROOT, 'src', 'main', 'services', 'downloads.js'));

test('safeName: nessun nome può uscire dalla cartella Download', () => {
  for (const evil of ['../../../../evaso.txt', '..\\..\\evaso.txt', '/etc/passwd', 'a/b/c.txt']) {
    const s = DL._safeName(evil);
    assert.ok(!s.includes('/') && !s.includes('\\'), `separatori rimasti in "${s}"`);
    assert.ok(!s.startsWith('.'), `nome che inizia con punto: "${s}"`);
  }
  assert.equal(DL._safeName('..'), 'download');
  assert.equal(DL._safeName(''), 'download');
  assert.ok(DL._safeName('x'.repeat(500)).length <= 180);
});

// Il traversal arriva anche in MEZZO al nome: Chromium ha già cambiato le barre
// in `_`, e `../../pwned` si presenta come `_.._.._pwned`. Togliere i punti
// solo in testa lo lasciava passare (tests/verifica/410/verifier-stress-410, «nome file
// ostile», rosso per questo).
test('safeName: un ".." in mezzo al nome non sopravvive, i punti normali sì', () => {
  for (const evil of ['_.._.._pwned.txt', 'a..b', 'pwned...txt', 'x.._y..']) {
    const s = DL._safeName(evil);
    assert.ok(!s.includes('..'), `resta un ".." in "${s}" (da "${evil}")`);
  }
  assert.equal(DL._safeName('_.._.._pwned.txt'), '_._._pwned.txt');
  assert.equal(DL._safeName('pwned...txt'), 'pwned.txt');
  // Estensioni e punti singoli non si toccano.
  for (const ok of ['a.b.txt', 'archivio.tar.gz', 'foto 2026.jpg', 'v1.2.3.zip']) {
    assert.equal(DL._safeName(ok), ok);
  }
  // Solo punti: non resta niente, e niente diventa «download».
  for (const nulla of ['.', '..', '...', '....']) assert.equal(DL._safeName(nulla), 'download');
});

test('shortName: un nome lunghissimo viene accorciato in mezzo tenendo l\'estensione', () => {
  const lungo = 'relazione-' + 'x'.repeat(400) + '.pdf';
  const s = DL._shortName(lungo);
  assert.ok(s.length <= 48, `avviso ancora enorme: ${s.length} caratteri`);
  assert.ok(s.startsWith('relazione-'), `inizio del nome perso: ${s}`);
  assert.ok(s.endsWith('.pdf'), `estensione persa: ${s}`);
  assert.ok(s.includes('…'), 'manca il segno di troncamento');
});

test('shortName: un nome normale resta identico', () => {
  for (const ok of ['report.pdf', 'foto vacanze 2026.jpg', 'archivio.tar.gz']) {
    assert.equal(DL._shortName(ok), ok);
  }
});
