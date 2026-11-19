// #473 — un file scaricato e poi spostato si ritrova: stesso nome e stessa dimensione, nelle cartelle date più un livello.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const R = require('../../src/main/services/ritrovaFile.js');

function casa() {
  const base = cartellaTemporanea('ritrova-');
  const radici = ['Download', 'Scrivania', 'Documenti'].map((nome) => {
    const dir = join(base, nome);
    mkdirSync(dir, { recursive: true });
    return { dir, nome };
  });
  return { base, radici, doc: radici[2].dir };
}

test('spostato in una sottocartella di Documenti: trovato, e dice dove', async () => {
  const { radici, doc } = casa();
  mkdirSync(join(doc, 'Bollette'));
  writeFileSync(join(doc, 'Bollette', 'luce.pdf'), 'x'.repeat(1234));
  const esito = await R.cerca('luce.pdf', 1234, radici);
  assert.equal(esito.trovato, join(doc, 'Bollette', 'luce.pdf'));
  assert.equal(esito.dove, 'Documenti/Bollette');
});

test('spostato sulla Scrivania, direttamente: trovato', async () => {
  const { radici } = casa();
  writeFileSync(join(radici[1].dir, 'foto.png'), 'abc');
  const esito = await R.cerca('foto.png', 3, radici);
  assert.equal(esito.dove, 'Scrivania');
});

test('stesso nome ma dimensione diversa: non è lui', async () => {
  const { radici, doc } = casa();
  writeFileSync(join(doc, 'luce.pdf'), 'x'.repeat(99));
  const esito = await R.cerca('luce.pdf', 1234, radici);
  assert.equal(esito.trovato, '');
  assert.equal(esito.scaduto, false);
});

test('due livelli sotto: fuori dalla ricerca', async () => {
  const { radici, doc } = casa();
  mkdirSync(join(doc, 'Casa', 'Bollette'), { recursive: true });
  writeFileSync(join(doc, 'Casa', 'Bollette', 'luce.pdf'), 'x'.repeat(1234));
  assert.equal((await R.cerca('luce.pdf', 1234, radici)).trovato, '');
});

test('una cartella che non esiste non ferma le altre', async () => {
  const { base, radici } = casa();
  writeFileSync(join(radici[2].dir, 'a.txt'), 'ciao');
  const esito = await R.cerca('a.txt', 4, [{ dir: join(base, 'manca'), nome: 'Manca' }, ...radici]);
  assert.equal(esito.dove, 'Documenti');
});

test('passato il tetto di tempo l’esito lo dice, non un «non c’è» falso', async () => {
  const { radici, doc } = casa();
  for (let i = 0; i < 30; i++) mkdirSync(join(doc, `cartella-${i}`));
  const esito = await R.cerca('luce.pdf', 1234, radici, { tettoMs: 0 });
  assert.equal(esito.trovato, '');
  assert.equal(esito.scaduto, true);
});

test('le cartelle solite si chiedono al sistema, mai scritte a mano', () => {
  const chieste = [];
  const app = { getPath: (k) => { chieste.push(k); return `/finta/${k}`; } };
  const radici = R.radiciSolite(app);
  assert.deepEqual(chieste, ['downloads', 'desktop', 'documents']);
  assert.deepEqual(radici.map((r) => r.nome), ['Download', 'Scrivania', 'Documenti']);
});
