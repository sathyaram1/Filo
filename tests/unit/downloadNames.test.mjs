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
