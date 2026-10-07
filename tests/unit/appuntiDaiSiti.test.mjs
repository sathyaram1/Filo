// #589.4 — chi tocca la cronologia appunti: Filo sempre; un sito legge l'elenco solo dal riquadro dove l'utente ha appena
// aperto il menu, nella scheda in vista, e scrive solo dopo un gesto dell'utente su quella scheda.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scorri, inAttesa, finoA } from '../helpers/orologio.mjs';

const require = createRequire(import.meta.url);
const Appunti = require('../../src/main/services/appuntiDaiSiti.js');
const Permessi = require('../../src/main/services/permessiPagine.js');

function wcFinto() {
  const ascolti = {};
  return {
    isDestroyed: () => false,
    on: (ev, fn) => { (ascolti[ev] ||= []).push(fn); },
    emetti: (ev, ...a) => { for (const fn of ascolti[ev] || []) fn(...a); },
  };
}

function finestra({ attiva = 1, vista = true } = {}) {
  return { isDestroyed: () => false, _filoTabs: { inVista: (id) => vista && id === attiva } };
}

const PRINCIPALE = { frameTreeNodeId: 3, origin: 'https://sito.example' };
const RIQUADRO = { frameTreeNodeId: 4, origin: 'https://pubblicita.example' };

const sito = (over = {}) => {
  const wc = wcFinto();
  Permessi.seguiGesti(wc);
  return { tab: { id: 1, url: 'https://sito.example/' }, url: 'https://sito.example/', win: finestra(), wc, frame: PRINCIPALE, ...over };
};
const apriMenu = (s, frame) => s.wc.emetti('context-menu', {}, { frame });
const leggi = (s) => Appunti.elencoLeggibile(s, 'https://sito.example/');

// Le attese del menu sull'orologio finto: «subito» e «dopo l'attesa» si contano in tick, non in millisecondi di una
// macchina che può essere carica (#1063). Si parte dall'ora vera: un gesto all'istante zero sembrerebbe assente.
async function conOrologioFinto(fn) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  try { await fn(); } finally { mock.timers.reset(); }
}

test('una scheda di sfondo non legge l\'elenco, nemmeno col menu appena aperto, e non aspetta', () => conOrologioFinto(async () => {
  const s = sito({ tab: { id: 2, url: 'https://sito.example/' } });
  apriMenu(s, PRINCIPALE);
  const esito = inAttesa(leggi(s));
  await scorri(0);
  assert.equal(esito.fatto, true, 'il rifiuto per la scheda di sfondo è subito, senza che passi tempo');
  assert.equal(esito.valore, false);
}));

test('la scheda in vista legge solo col menu aperto nel suo riquadro: un clic qualunque non basta', () => conOrologioFinto(async () => {
  const s = sito();
  s.wc.emetti('input-event', {}, { type: 'mouseDown', modifiers: ['leftbuttondown'] });
  const lettura = leggi(s);
  const esito = inAttesa(lettura);
  await scorri(Appunti.ATTESA_DEL_MENU_MS - 50);
  assert.equal(esito.fatto, false, 'prima del no si aspetta il segnale del menu');
  assert.equal(await finoA(lettura, { passo: 20 }), false, 'un clic che non apre il menu');
  apriMenu(s, PRINCIPALE);
  assert.equal(await finoA(leggi(s), { passo: 20 }), true);
  s.wc._filoMenuAperto.alle = Date.now() - Permessi.GESTO_MS - 1;
  assert.equal(await finoA(leggi(s), { passo: 20 }), false, 'un menu vecchio non vale');
}));

test('il menu aperto nella pagina non vale per il riquadro di un altro sito, e viceversa', async () => {
  const s = sito();
  apriMenu(s, PRINCIPALE);
  assert.equal(await leggi({ ...s, frame: RIQUADRO }), false, 'il riquadro non ha avuto il menu');
  apriMenu(s, RIQUADRO);
  assert.equal(await leggi({ ...s, frame: RIQUADRO }), true);
  assert.equal(await leggi(s), false, 'ora il menu è del riquadro');
  assert.equal(await leggi({ ...s, frame: { frameTreeNodeId: 4, origin: 'https://altro.example' } }), false,
    'stesso riquadro passato a un altro sito');
  assert.equal(await leggi({ ...s, frame: null }), false, 'senza riquadro noto non si legge');
});

test('il segnale del menu arriva dopo la domanda: vale se arriva entro l\'attesa', () => conOrologioFinto(async () => {
  const s = sito();
  const esito = leggi({ ...s, frame: RIQUADRO });
  await scorri(60);
  apriMenu(s, RIQUADRO);
  assert.equal(await finoA(esito, { passo: 20 }), true);
}));

test('le domande che arrivano insieme dallo stesso riquadro aspettano una volta sola', async () => {
  const s = sito();
  const a = leggi(s);
  const b = leggi(s);
  assert.equal(s.wc._filoAttesaMenu.size, 1, 'una raffica di domande non moltiplica le attese');
  assert.equal(await a, false);
  assert.equal(await b, false);
  assert.equal(s.wc._filoAttesaMenu.size, 0);
});

test('una navigazione della pagina dimentica il menu', async () => {
  const s = sito();
  apriMenu(s, PRINCIPALE);
  s.wc.emetti('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(s.wc._filoMenuAperto, null);
});

test('un tasto premuto in un riquadro è un gesto, Esc no', () => {
  const wc = wcFinto();
  Permessi.seguiGesti(wc);
  wc.emetti('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
  assert.ok(!wc._filoGestoAlle);
  wc.emetti('before-input-event', {}, { type: 'keyDown', key: 'v' });
  assert.ok(wc._filoGestoAlle > 0);
});

test('Filo legge e scrive sempre, la cornice compresa', async () => {
  assert.equal(await Appunti.elencoLeggibile({ url: 'filo://newtab/' }, 'filo://newtab/'), true);
  assert.equal(await Appunti.elencoLeggibile({ isShell: true, url: '' }, ''), true);
  assert.equal(Appunti.scritturaAmmessa({ url: 'filo://newtab/' }, 'filo://newtab/'), true);
  assert.equal(Appunti.scritturaAmmessa({ isShell: true, url: '' }, ''), true);
});

test('un sito scrive solo entro un minuto da un gesto, nella scheda in vista', () => {
  const s = sito();
  assert.equal(Appunti.scritturaAmmessa(s, 'https://sito.example/'), false, 'senza gesto');
  apriMenu(s, RIQUADRO);
  assert.equal(Appunti.scritturaAmmessa(s, 'https://sito.example/'), true, 'il menu aperto è un gesto');
  s.wc._filoGestoAlle = Date.now() - Appunti.SCRITTURA_DOPO_IL_GESTO_MS - 1;
  assert.equal(Appunti.scritturaAmmessa(s, 'https://sito.example/'), false, 'gesto troppo vecchio');
  assert.equal(Appunti.scritturaAmmessa({ url: 'https://sito.example/' }, 'https://sito.example/'), false, 'mittente senza scheda');
});

test('passata sullo sfondo, la scheda non svuota né aggiunge testo: arriva solo la copia d\'immagine col gesto fatto prima', () => {
  const s = sito({ tab: { id: 2, url: 'https://sito.example/' } });
  apriMenu(s, PRINCIPALE);
  assert.equal(Appunti.scritturaAmmessa(s, 'https://sito.example/'), false, 'svuotare o togliere dallo sfondo');
  assert.equal(Appunti.scritturaAmmessa(s, 'https://sito.example/', { type: 'text', text: 'voce del sito' }), false);
  assert.equal(Appunti.scritturaAmmessa(s, 'https://sito.example/', { type: 'image', dataUrl: 'data:image/png;base64,AA' }), true);
  s.wc._filoGestoAlle = 0;
  assert.equal(Appunti.scritturaAmmessa(s, 'https://sito.example/', { type: 'image', dataUrl: 'data:image/png;base64,AA' }), false, 'senza gesto nemmeno l\'immagine');
});

test('il tasto destro vero sulla pagina vale come menu aperto anche se il sito annulla l\'evento del menu', async () => {
  const s = sito();
  s.wc.mainFrame = PRINCIPALE;
  s.wc.emetti('input-event', {}, { type: 'mouseDown', modifiers: ['rightbuttondown'] });
  assert.equal(await leggi(s), true);
  assert.equal(await leggi({ ...s, frame: RIQUADRO }), false, 'non vale per il riquadro di un altro sito');
  s.wc._filoMenuAperto = null;
  s.wc.emetti('input-event', {}, { type: 'rawKeyDown', key: 'ContextMenu' });
  assert.equal(await leggi(s), true, 'il tasto del menu sulla tastiera');
});

test('un mittente senza finestra non legge; una finestra aperta da un sito legge solo se si vede', async () => {
  assert.equal(Appunti.mittenteInVista({ url: 'https://sito.example/' }), false);
  const popup = (visibile, ridotta) => ({ tab: null, win: { isDestroyed: () => false, isVisible: () => visibile, isMinimized: () => ridotta } });
  assert.equal(Appunti.mittenteInVista(popup(true, false)), true);
  assert.equal(Appunti.mittenteInVista(popup(true, true)), false);
  assert.equal(Appunti.mittenteInVista(popup(false, false)), false);
  assert.equal(Appunti.mittenteInVista(sito({ win: finestra({ vista: false }) })), false, 'finestra ridotta o nascosta');
  assert.equal(Appunti.mittenteInVista(sito({ tab: null })), false, 'in una finestra con le schede serve la scheda');
});

test('una scheda che chiude durante l\'attesa non legge', () => conOrologioFinto(async () => {
  const s = sito();
  let morta = false;
  s.wc.isDestroyed = () => morta;
  const esito = inAttesa(leggi(s));
  await scorri(40);
  morta = true;
  await scorri(40);
  assert.equal(esito.fatto, true, 'chiusa la scheda, il no arriva prima della fine dell\'attesa del menu');
  assert.equal(esito.valore, false);
}));
