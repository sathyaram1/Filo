// #589.4 — chi legge l'elenco della cronologia appunti: Filo sempre, un sito solo dalla scheda in vista e dopo un gesto
// su quella scheda (anche il tasto destro in un riquadro di un altro sito, che arriva dopo la domanda).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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

const sito = (over = {}) => ({ tab: { id: 1, url: 'https://sito.example/' }, url: 'https://sito.example/', win: finestra(), wc: wcFinto(), ...over });

test('una scheda di sfondo non legge l\'elenco, nemmeno subito dopo un gesto, e non aspetta', async () => {
  const s = sito({ tab: { id: 2, url: 'https://sito.example/' } });
  s.wc._filoGestoAlle = Date.now();
  const t0 = Date.now();
  assert.equal(await Appunti.elencoLeggibile(s, 'https://sito.example/'), false);
  assert.ok(Date.now() - t0 < 200, 'il rifiuto per la scheda di sfondo è subito');
});

test('la scheda in vista senza gesto non legge; con un gesto recente sì', async () => {
  const s = sito();
  const t0 = Date.now();
  assert.equal(await Appunti.elencoLeggibile(s, 'https://sito.example/'), false);
  assert.ok(Date.now() - t0 >= Appunti.ATTESA_DEL_GESTO_MS - 50, 'prima del no si aspetta il segnale del menu');
  s.wc._filoGestoAlle = Date.now();
  assert.equal(await Appunti.elencoLeggibile(s, 'https://sito.example/'), true);
  s.wc._filoGestoAlle = Date.now() - Permessi.GESTO_MS - 1;
  assert.equal(await Appunti.elencoLeggibile(s, 'https://sito.example/'), false, 'un gesto vecchio non vale');
});

test('il tasto destro in un riquadro arriva dopo la domanda: vale se arriva entro l\'attesa', async () => {
  const s = sito();
  Permessi.seguiGesti(s.wc);
  const esito = Appunti.elencoLeggibile(s, 'https://sito.example/');
  setTimeout(() => s.wc.emetti('context-menu', {}, {}), 60);
  assert.equal(await esito, true);
});

test('le domande che arrivano insieme aspettano il gesto una volta sola', async () => {
  const wc = wcFinto();
  const a = Permessi.gestoEntro(wc, 200);
  const b = Permessi.gestoEntro(wc, 200);
  assert.equal(a, b, 'una raffica di domande da una pagina non moltiplica le attese');
  assert.equal(await a, false);
  assert.equal(wc._filoAttesaGesto, null);
  const c = Permessi.gestoEntro(wc, 200);
  assert.notEqual(c, a, 'finita l\'attesa, la domanda dopo ne apre un\'altra');
  wc._filoGestoAlle = Date.now();
  assert.equal(await c, true);
});

test('un tasto premuto in un riquadro è un gesto, Esc no', () => {
  const wc = wcFinto();
  Permessi.seguiGesti(wc);
  wc.emetti('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
  assert.ok(!wc._filoGestoAlle);
  wc.emetti('before-input-event', {}, { type: 'keyDown', key: 'v' });
  assert.ok(wc._filoGestoAlle > 0);
});

test('Filo legge sempre, la cornice compresa', async () => {
  assert.equal(await Appunti.elencoLeggibile({ url: 'filo://newtab/' }, 'filo://newtab/'), true);
  assert.equal(await Appunti.elencoLeggibile({ isShell: true, url: '' }, ''), true);
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

test('una scheda che chiude durante l\'attesa non legge', async () => {
  const s = sito();
  let morta = false;
  s.wc.isDestroyed = () => morta;
  const esito = Appunti.elencoLeggibile(s, 'https://sito.example/');
  setTimeout(() => { morta = true; }, 40);
  const t0 = Date.now();
  assert.equal(await esito, false);
  assert.ok(Date.now() - t0 < Appunti.ATTESA_DEL_GESTO_MS);
});
