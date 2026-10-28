// Schede dal bordo alto a schermo intero (#1343): un trascinamento contro il bordo le chiama anche quando la pagina
// tace, come sopra un riquadro di un altro sito in cima; il bordo alto di un riquadro a metà pagina no.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { SchedeInAlto } = require(join(ROOT, 'src', 'main', 'schedeInAlto.js'));

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function prepara(cursore) {
  const wc = {};
  const tabs = {
    contentFullscreen: true,
    pageFullscreen: false,
    barra: { opzioni: { schede: true, attesaMs: 30, uscitaMs: 60 } },
    vistaSottoIlVuoto: () => ({ webContents: wc, getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) }),
    layout() {},
  };
  const win = { getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), webContents: { on() {} } };
  const s = new SchedeInAlto(win, tabs);
  s._cursore = () => cursore.p;
  return { s, wc };
}

test('la pagina ha detto «via» entrando in un riquadro che non le passa niente: col puntatore sul bordo le schede arrivano', async () => {
  const cursore = { p: { x: 300, y: 400 } };
  const { s, wc } = prepara(cursore);
  s.dalTrascinamento(wc, 'via');
  cursore.p = { x: 300, y: 0 };
  await pausa(450);
  assert.equal(s.visibili, true);
  assert.equal(s.timer.trascina, null, 'scese le schede, il puntatore non si segue più');
});

test('fermo sul bordo alto di un riquadro a metà pagina le schede restano su', async () => {
  const cursore = { p: { x: 300, y: 260 } };
  const { s, wc } = prepara(cursore);
  s.dalTrascinamento(wc, 'via');
  await pausa(450);
  assert.equal(s.visibili, false);
  s.dalTrascinamento(wc, 'fine');
});

test('finché la pagina dice «via» decide lei, anche col puntatore del sistema altrove; al rilascio non si segue più', async () => {
  const cursore = { p: { x: 300, y: 0 } };
  const { s, wc } = prepara(cursore);
  for (let i = 0; i < 6; i++) { s.dalTrascinamento(wc, 'via'); await pausa(50); }
  assert.equal(s.visibili, false);
  s.dalTrascinamento(wc, 'fine');
  assert.equal(s.timer.trascina, null);
  await pausa(400);
  assert.equal(s.visibili, false);
});

test('fuori dallo schermo intero un trascinamento non si segue', async () => {
  const cursore = { p: { x: 300, y: 0 } };
  const { s, wc } = prepara(cursore);
  s.tabs.contentFullscreen = false;
  s.dalTrascinamento(wc, 'bordo');
  assert.equal(s.timer.trascina, null);
  await pausa(200);
  assert.equal(s.visibili, false);
});
