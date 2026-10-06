// #589.5 — la foto di una pagina va al frame principale di una pagina in vista, e inquadra sé stessa: mai la scheda in
// primo piano di un'altra pagina, mai a un riquadro, mai la finestra principale a un popup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Foto = require('../../src/main/services/fotoDellaPagina.js');

const PRINCIPALE = { parent: null, detached: false };
const RIQUADRO = { parent: PRINCIPALE, detached: false };

function finestra({ attiva = 2, visibile = true } = {}) {
  const tabs = [1, 2].map((id) => ({ id, view: { webContents: { nome: `scheda ${id}` } } }));
  return {
    isDestroyed: () => false,
    _filoTabs: { tabs, activeId: attiva, inVista: (id) => visibile && id === attiva },
  };
}

const daScheda = (id, over = {}) => {
  const win = over.win || finestra();
  return { tab: { id }, win, wc: win._filoTabs.tabs.find((t) => t.id === id).view.webContents, frame: PRINCIPALE, ...over };
};

function popup({ visibile = true, ridotto = false } = {}) {
  const wc = { nome: 'popup' };
  return { tab: null, wc, frame: PRINCIPALE, win: { isDestroyed: () => false, isVisible: () => visibile, isMinimized: () => ridotto, webContents: wc } };
}

test('la scheda in vista fotografa sé stessa, e la barra sopra di lei', () => {
  const s = daScheda(2);
  assert.equal(Foto.paginaDaFotografare(s), s.wc);
  assert.equal(Foto.barraDaFotografare(s), s.win);
});

test('una scheda di sfondo non ha la foto della scheda in primo piano, né la barra', () => {
  const s = daScheda(1);
  assert.equal(Foto.paginaDaFotografare(s), null);
  assert.equal(Foto.barraDaFotografare(s), null);
});

test('una finestra ridotta a icona o nascosta non dà foto nemmeno alla sua scheda attiva', () => {
  const s = daScheda(2, { win: finestra({ visibile: false }) });
  assert.equal(Foto.paginaDaFotografare(s), null);
});

test('un riquadro, anche nella scheda in vista, non ha la foto della pagina che lo ospita', () => {
  assert.equal(Foto.paginaDaFotografare(daScheda(2, { frame: RIQUADRO })), null);
  assert.equal(Foto.barraDaFotografare(daScheda(2, { frame: RIQUADRO })), null);
  assert.equal(Foto.paginaDaFotografare(daScheda(2, { frame: { parent: null, detached: true } })), null);
  assert.equal(Foto.paginaDaFotografare(daScheda(2, { frame: null })), null);
});

test('un popup fotografa sé stesso finché si vede, e non ha una barra da dare', () => {
  const p = popup();
  assert.equal(Foto.paginaDaFotografare(p), p.wc);
  assert.equal(Foto.barraDaFotografare(p), null);
  assert.equal(Foto.paginaDaFotografare(popup({ ridotto: true })), null);
  assert.equal(Foto.paginaDaFotografare(popup({ visibile: false })), null);
});

test('la barra di Filo fotografa la scheda in primo piano della sua finestra, e la propria barra', () => {
  const win = finestra({ attiva: 1 });
  const barra = { isShell: true, win, tab: null, wc: { nome: 'barra' }, frame: PRINCIPALE };
  assert.equal(Foto.paginaDaFotografare(barra), win._filoTabs.tabs[0].view.webContents);
  assert.equal(Foto.barraDaFotografare(barra), win);
});

test('senza mittente o senza finestra nessuna foto', () => {
  assert.equal(Foto.paginaDaFotografare(undefined), null);
  assert.equal(Foto.paginaDaFotografare({}), null);
  assert.equal(Foto.barraDaFotografare({}), null);
});
