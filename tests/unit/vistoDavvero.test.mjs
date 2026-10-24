// #589.11 — quando un clic vero su una voce del menu conta: la voce dev'essere scoperta per il browser, e dopo una
// copertura del sito deve restarlo mezzo secondo. Logica pura di src/content/vistoDavvero.js; il giro vero col
// velo sta in tests/menu-coperto-dal-sito.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'content', 'vistoDavvero.js'));
const V = globalThis.SN_VISTO;

const vista = { interseca: true, visibile: true };
const coperta = { interseca: true, visibile: false };
const nascosta = { interseca: false, visibile: false };

test('fuori da Electron la guardia è spenta e non monta niente', () => {
  assert.equal(V.ATTIVO, false);
  assert.equal(V.prima({}, {}), null);
});

test('finché il browser non ha risposto la voce non conta un clic', () => {
  assert.equal(V.giudica(undefined, 0), 'attesa');
  assert.equal(V.giudica(V.nuovoStato(), 1000), 'attesa');
});

test('una voce comparsa scoperta conta subito, senza attesa', () => {
  const r = V.aggiorna(V.nuovoStato(), { ...vista, tempo: 100 });
  assert.equal(V.giudica(r, 101), 'ok');
});

test('sotto un velo la voce non conta, e scoperta aspetta mezzo secondo', () => {
  const r = V.nuovoStato();
  V.aggiorna(r, { ...coperta, tempo: 100 });
  assert.equal(V.giudica(r, 5000), 'coperta');
  V.aggiorna(r, { ...vista, tempo: 6000 });
  assert.equal(V.giudica(r, 6000 + V.RITARDO_MS - 1), 'presto');
  assert.equal(V.giudica(r, 6000 + V.RITARDO_MS), 'ok');
});

test('una voce scoperta e poi coperta torna a non contare', () => {
  const r = V.aggiorna(V.nuovoStato(), { ...vista, tempo: 100 });
  V.aggiorna(r, { ...coperta, tempo: 900 });
  assert.equal(V.giudica(r, 5000), 'coperta');
});

test('una voce nascosta da Filo (filtro, lista che scorre) quando ricompare è una comparsa', () => {
  const r = V.aggiorna(V.nuovoStato(), { ...vista, tempo: 100 });
  V.aggiorna(r, { ...nascosta, tempo: 200 });
  assert.equal(V.giudica(r, 250), 'attesa');
  V.aggiorna(r, { ...vista, tempo: 300 });
  assert.equal(V.giudica(r, 301), 'ok');
});

test('coperta da un pezzo di Filo che se ne va: niente attesa, se il browser lo dice subito', () => {
  const r = V.aggiorna(V.nuovoStato(), { ...vista, tempo: 100 });
  V.aggiorna(r, { ...coperta, tempo: 200, nostra: true });
  r.ultimaNostra = 2000;
  V.aggiorna(r, { ...vista, tempo: 2000 + V.SCARTO_NOSTRO_MS });
  assert.equal(V.giudica(r, 2000 + V.SCARTO_NOSTRO_MS + 1), 'ok');
});

test('il pezzo di Filo è sparito da un pezzo e la voce resta coperta: a coprire era il sito', () => {
  const r = V.aggiorna(V.nuovoStato(), { ...vista, tempo: 100 });
  V.aggiorna(r, { ...coperta, tempo: 200, nostra: true });
  r.ultimaNostra = 2000;
  V.aggiorna(r, { ...vista, tempo: 2000 + V.SCARTO_NOSTRO_MS + 1 });
  assert.equal(V.giudica(r, 2000 + V.SCARTO_NOSTRO_MS + 2), 'presto');
});

test('il velo del sito arrivato per primo resta del sito anche se poi si aggiunge un pezzo di Filo', () => {
  const r = V.aggiorna(V.nuovoStato(), { ...vista, tempo: 100 });
  V.aggiorna(r, { ...coperta, tempo: 200, nostra: false });
  V.aggiorna(r, { ...coperta, tempo: 300, nostra: true });
  V.aggiorna(r, { ...vista, tempo: 310 });
  assert.equal(V.giudica(r, 311), 'presto');
});

test('il menu monta ogni suo pezzo sotto le sonde, e la guardia arriva prima del menu in entrambi i preload', () => {
  const menu = readFileSync(join(ROOT, 'src', 'content', 'menu.js'), 'utf8');
  const monta = menu.slice(menu.indexOf('function monta(el)'), menu.indexOf('function bloccaMenu'));
  assert.match(monta, /SN_VISTO\?\.prima\(host, el\)/);
  assert.doesNotMatch(menu, /menuHost\(\)\.appendChild/, 'un pezzo appeso in fondo finirebbe sopra le sonde');
  for (const f of ['page-preload.js', 'internal-preload.js']) {
    const src = readFileSync(join(ROOT, 'src', 'preload', f), 'utf8');
    const guardia = src.indexOf("'vistoDavvero.js'");
    assert.ok(guardia > 0 && guardia < src.indexOf("'menu.js'"), `${f}: vistoDavvero.js prima di menu.js`);
  }
});
