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

// #1721 — la foto per un modello si copre sul bitmap prima del JPEG, e non parte se un riquadro di un altro sito sfugge.

const W = 20, H = 10;
const bitmap = () => Buffer.alloc(W * H * 4, 7);
const pixel = (b, x, y) => Array.from(b.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));

test('la pittura copre esattamente i pixel del rettangolo, in BGRA, e nient’altro', () => {
  const b = Foto.dipingi(bitmap(), W, H, [{ left: 2, top: 3, width: 4, height: 2, colore: [10, 20, 30] }], { x: 1, y: 1 });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dentro = x >= 2 && x < 6 && y >= 3 && y < 5;
      assert.deepEqual(pixel(b, x, y), dentro ? [30, 20, 10, 255] : [7, 7, 7, 7], `pixel ${x},${y}`);
    }
  }
});

test('col fattore 1,25 la pittura copre ogni pixel toccato, anche a metà, e ai bordi si ferma alla foto', () => {
  const b = Foto.dipingi(bitmap(), W, H, [{ left: 1, top: 1, width: 3, height: 2 }], { x: 1.25, y: 1.25 });
  // 1·1,25 = 1,25 → da 1; (1+3)·1,25 = 5 → fino a 5 escluso; (1+2)·1,25 = 3,75 → fino a 4 escluso.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dentro = x >= 1 && x < 5 && y >= 1 && y < 4;
      assert.equal(pixel(b, x, y)[3], dentro ? 255 : 7, `pixel ${x},${y}`);
    }
  }
  const bordo = Foto.dipingi(bitmap(), W, H, [{ left: -5, top: 7, width: 100, height: 100 }], { x: 1.25, y: 1.25 });
  for (let x = 0; x < W; x++) assert.equal(pixel(bordo, x, H - 1)[3], 255);
  assert.equal(pixel(bordo, 0, 9)[0], Foto.GRIGIO[2], 'senza colore la copertura è grigia');
  assert.equal(pixel(bordo, 0, 0)[3], 7, 'sopra il rettangolo la foto resta com’era');
});

test('un campo segreto si copre col suo sfondo e dei puntini neutri, mai del colore della scritta', () => {
  const lista = Foto.coperture([{ campi: [{ left: 0, top: 0, width: 20, height: 10, sfondo: 'rgb(250, 240, 230)', testo: 'rgba(1, 2, 3, 1)' }] }]);
  const b = Foto.dipingi(bitmap(), W, H, lista, { x: 1, y: 1 });
  const colori = new Set();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) colori.add(pixel(b, x, y).join(','));
  assert.deepEqual([...colori].sort(), ['230,240,250,255', '60,60,60,255'].sort());
  const scuro = Foto.coperture([{ campi: [{ left: 0, top: 0, width: 5, height: 5, sfondo: 'rgb(20, 20, 20)', testo: '#fff' }] }]);
  assert.deepEqual(scuro[0].puntini, [200, 200, 200], 'su un campo scuro i puntini sono chiari');
});

test('le coperture: prima e dopo lo scatto, campi poi testo ripetuto poi riquadri, e niente di non numerico', () => {
  const prima = { campi: [{ left: 1, top: 1, width: 5, height: 5, sfondo: '#fff', testo: '#000' }], ripetuti: [{ left: 2, top: 2, width: 3, height: 3 }], riquadri: [{ left: 0, top: 0, width: 9, height: 9 }] };
  const dopo = { campi: [], ripetuti: [], riquadri: [{ left: 0, top: 4, width: 9, height: 9 }, { left: NaN, top: 0, width: 1, height: 1 }, { left: 0, top: 0, width: 0, height: 3 }] };
  const lista = Foto.coperture([prima, dopo], [{ left: 3, top: 3, width: 2, height: 2, sfondo: 'transparent', testo: '' }]);
  assert.equal(lista.length, 5);
  assert.deepEqual(lista.slice(-2).map((c) => c.top), [0, 4], 'si coprono le due posizioni del riquadro, per ultime');
  assert.deepEqual(lista[1].colore, [255, 255, 255], 'uno sfondo che non si legge diventa bianco');
});

const frame = (origin, frames = [], url = origin + '/x') => ({ origin, url, frames, detached: false });

test('il frame tree conta i riquadri di altre origini appesi alla pagina o a riquadri della sua origine', () => {
  const albero = frame('http://a.test', [
    frame('http://b.test', [frame('http://c.test')]),
    frame('http://a.test', [frame('http://d.test'), frame('http://a.test', [frame('null')])]),
    frame('', [], ''),
  ]);
  assert.equal(Foto.frameDiAltreOrigini(albero), 3, 'b, d e il sandbox; c sta dentro b, coperto con lui; quello in arrivo non mostra niente');
  assert.equal(Foto.frameDiAltreOrigini(frame('null', [frame('null')])), 1, 'due origini opache non sono la stessa');
  assert.equal(Foto.frameDiAltreOrigini(frame('http://a.test')), 0);
});

test('il confronto rifiuta la foto se un riquadro del frame tree non è stato misurato, o se la misura manca', () => {
  const vista = { w: 800, h: 600 };
  assert.equal(Foto.rifiutoDellaMisura({ vista, conFrame: 2, attesi: 2 }), null);
  assert.equal(Foto.rifiutoDellaMisura({ vista, conFrame: 3, attesi: 2 }), null);
  assert.equal(Foto.rifiutoDellaMisura({ vista, conFrame: 1, attesi: 2 }), 'riquadri');
  assert.equal(Foto.rifiutoDellaMisura({ vista, conFrame: 5, attesi: Infinity }), 'riquadri', 'senza frame tree non si sa');
  assert.equal(Foto.rifiutoDellaMisura(null), 'misura');
  assert.equal(Foto.rifiutoDellaMisura({ vista: { w: 0, h: 600 }, conFrame: 0, attesi: 0 }), 'misura');
  for (const c of ['riquadri', 'segreti', 'misura']) assert.ok(Foto.perche(c), `il modello deve sapere perché: ${c}`);
  assert.equal(Foto.perche('__proto__'), '');
});
