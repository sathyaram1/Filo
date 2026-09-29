// Unit test per la scorciatoia "Salva per dopo" (Alt+S) in
// src/main/shortcuts.js.
//
// #277: su una pagina interna di Filo (filo://) Alt+S non salva e non chiude.
// #839: su una pagina web Alt+S passa alla pagina, che fa la stessa cosa della
// voce del menu (miniatura piccola, conferma cliccabile, chiusura). Il main
// salva e chiude da solo SOLO se la pagina non la prende (ancora in
// caricamento, nessuna risposta), coi dati fotografati al momento del tasto
// (#334), e la conferma la mostra la scheda rimasta davanti.
//
// Electron e ./services/handlers sono stubati via Module._load, così il test
// gira in ms senza aprire nessuna finestra.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// SN_MSG.MSG.SAVE_PAGE è letto a runtime da saveForLater: carichiamo il modulo
// messaggi reale (IIFE su globalThis) così l'invariante resta vera.
require(join(ROOT, 'src', 'shared', 'messages.js'));

// Registro delle chiamate che i vari stub raccolgono per gli assert.
let saved; // payload di SAVE_PAGE, o null
let thumb; // payload di SET_SAVED_PAGE_THUMB, o null
let closed; // id della tab chiusa, o null

// Stub di ./services/handlers (require-ato dentro saveForLater) e di electron
// (require-ato in cima a shortcuts.js). Intercettiamo Module._load.
const HANDLERS_ID = join(ROOT, 'src', 'main', 'services', 'handlers.js');
const origLoad = Module._load;
// Condiviso: shortcuts.js lo destruttura al require, i test gli danno la finestra a fuoco.
const BrowserWindowStub = {};
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') {
    return { BrowserWindow: BrowserWindowStub };
  }
  if (request === './services/handlers') {
    return {
      handleMessage: async (msg) => {
        const { MSG } = globalThis.SN_MSG;
        if (msg && msg.type === MSG.SAVE_PAGE) { saved = msg.page; return { ok: true, entry: { id: 'E1' } }; }
        return { ok: false };
      },
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

// Lo stub resta installato per tutta la vita del file: saveForLater fa un
// require('./services/handlers') LAZY (a runtime, dopo che dispatch è tornato),
// quindi non possiamo ripristinare Module._load subito. Lo ripristiniamo alla
// chiusura del processo. Intercetta solo 'electron' e './services/handlers'.
process.on('exit', () => { Module._load = origLoad; });

globalThis.SN_SAVED_PAGES = { setThumbnail: async (id, thumbnail) => { thumb = { id, thumbnail }; return { id }; } };

const { dispatch, consegnaConRicevuta, riceviRicevuta, confermaSullaSchedaDavanti } = require(join(ROOT, 'src', 'main', 'shortcuts.js'));

// Costruisce una finta finestra con una sola tab attiva.
function makeWin(tab) {
  return {
    _filoTabs: {
      activeId: tab.id,
      tabs: [tab],
      closeTab: (id) => { closed = id; },
    },
  };
}

// Una tab con una webContents fittizia. `risposta` simula la pagina: 'presa'
// (content script di Filo che fa il salvataggio), 'rifiutata' (nessun
// ascoltatore: Filo non ancora montato) o null (nessuna risposta).
function makeTab(over = {}, risposta = 'rifiutata') {
  const tab = {
    id: 'T1',
    url: 'https://example.com/',
    title: 'Example',
    favicon: '',
    isInternal: false,
    ricevuti: [],
    ...over,
  };
  tab.view = {
    webContents: {
      send: (canale, payload) => {
        tab.ricevuti.push({ canale, payload });
        if (tab.primaDiRispondere) tab.primaDiRispondere();
        if (risposta) setTimeout(() => riceviRicevuta(payload.ricevuta, tab.id, risposta === 'presa'), 1);
      },
      // Una cattura come la dà Electron: una bitmap già in mano al main, niente da decodificare.
      capturePage: async () => ({
        isEmpty: () => false,
        getSize: () => ({ width: 1280, height: 800 }),
        crop() { return this; },
        resize() { return this; },
        toJPEG: () => Buffer.from('jpeg'),
      }),
    },
  };
  return tab;
}

test('Alt+S su pagina interna filo:// non salva e non chiude la tab', async () => {
  saved = null; closed = null;
  const tab = makeTab({ url: 'filo://newtab/', isInternal: true, title: 'Nuova scheda' });
  dispatch('save-for-later', makeWin(tab));
  await new Promise((r) => setTimeout(r, 10)); // lascia svolgere l'eventuale promise
  assert.equal(saved, null, 'una pagina interna NON deve finire in "Aperti per dopo"');
  assert.equal(closed, null, 'la tab interna NON deve essere chiusa');
  assert.equal(tab.ricevuti.length, 0, 'alla pagina interna non arriva niente');
});

test('Alt+S su pagina interna (solo url filo://, isInternal assente) è comunque no-op', async () => {
  saved = null; closed = null;
  const tab = makeTab({ url: 'filo://history/', isInternal: false });
  dispatch('save-for-later', makeWin(tab));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(saved, null, 'lo schema filo:// da solo basta a bloccare il salvataggio');
  assert.equal(closed, null, 'la tab interna NON deve essere chiusa');
});

test('Alt+S su pagina web con Filo dentro: lo fa la pagina, come la voce del menu', async () => {
  saved = null; thumb = null; closed = null;
  const tab = makeTab({ url: 'https://news.example.com/articolo', title: 'Articolo' }, 'presa');
  dispatch('save-for-later', makeWin(tab));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(tab.ricevuti.map((m) => [m.canale, m.payload.command]), [['shortcut:triggered', 'save-for-later']]);
  assert.ok(tab.ricevuti[0].payload.ricevuta, 'la consegna porta la ricevuta da restituire');
  assert.equal(saved, null, 'il main non salva una seconda volta: salva la pagina, con la sua conferma');
  assert.equal(closed, null, 'la scheda la chiude la conferma, non il main subito');
});

test('Alt+S su pagina web senza Filo: il main salva, allega la miniatura e chiude', async () => {
  saved = null; thumb = null; closed = null;
  const tab = makeTab({ url: 'https://news.example.com/articolo', title: 'Articolo' }, 'rifiutata');
  // Intanto la pagina naviga altrove: si salva quella su cui era stato premuto il tasto (#334).
  tab.primaDiRispondere = () => { tab.url = 'https://altrove.example.com/'; tab.title = 'Altrove'; };
  const win = makeWin(tab);
  win._filoTabs.tabs.push(makeTab({ id: 'T2' }, 'presa'));
  win._filoTabs.closeTab = (id) => { closed = id; win._filoTabs.activeId = 'T2'; };
  dispatch('save-for-later', win);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(saved, 'una pagina web DEVE essere salvata in "Aperti per dopo"');
  assert.equal(saved.url, 'https://news.example.com/articolo');
  assert.equal(saved.title, 'Articolo');
  assert.equal(thumb && thumb.id, 'E1', 'la miniatura va alla voce appena salvata');
  assert.match(thumb.thumbnail, /^data:image\/jpeg;base64,/, 'e ci va già compressa');
  assert.equal(closed, 'T1', 'la tab web va chiusa dopo il salvataggio');
});

test('Alt+S su una pagina che non risponde: la conferma la mostra la scheda rimasta davanti, senza chiudersi', async () => {
  saved = null; thumb = null; closed = null;
  const salvata = makeTab({ id: 'T1', url: 'https://news.example.com/articolo', title: 'Articolo' }, 'rifiutata');
  const davanti = makeTab({ id: 'T2', url: 'https://altro.example.com/', title: 'Altro' }, 'presa');
  const win = makeWin(salvata);
  win._filoTabs.tabs.push(davanti);
  win._filoTabs.closeTab = (id) => { closed = id; win._filoTabs.activeId = 'T2'; };
  dispatch('save-for-later', win);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(closed, 'T1');
  assert.deepEqual(davanti.ricevuti.map((m) => [m.canale, m.payload.command, m.payload.context && m.payload.context.entry && m.payload.context.entry.id]),
    [['shortcut:triggered', 'save-for-later-confirm', 'E1']], 'la scheda davanti riceve la conferma della voce appena salvata');
});

test('senza risposta dalla pagina la consegna si arrende, e una ricevuta da un\'altra scheda non vale', async () => {
  const muta = makeTab({}, null);
  assert.equal(await consegnaConRicevuta(muta, 'save-for-later', 20), false);

  const tab = makeTab({}, null);
  const esito = consegnaConRicevuta(tab, 'save-for-later', 50);
  const { ricevuta } = tab.ricevuti[0].payload;
  assert.equal(riceviRicevuta(ricevuta, 'ALTRA', true), false, 'ricevuta dalla scheda sbagliata');
  assert.equal(riceviRicevuta(ricevuta, tab.id, true), true);
  assert.equal(await esito, true);
  assert.equal(riceviRicevuta(ricevuta, tab.id, true), false, 'una ricevuta vale una volta');
});

test('la conferma di ripiego si riprova finché una pagina la prende: la scheda nata al posto dell\'ultima all\'inizio la perde', async () => {
  const nuova = makeTab({ id: 'N1', url: 'filo://newtab/', isInternal: true }, null);
  // Prima consegna persa (documento non ancora pronto), dalla seconda la pagina risponde.
  const send = nuova.view.webContents.send;
  nuova.view.webContents.send = (canale, payload) => {
    send(canale, payload);
    if (nuova.ricevuti.length > 1) setTimeout(() => riceviRicevuta(payload.ricevuta, nuova.id, true), 1);
  };
  const win = makeWin(nuova);
  const esito = await confermaSullaSchedaDavanti(win, { id: 'E9', category: null }, { tentativoMs: 20, totaleMs: 2000 });
  assert.equal(esito, true);
  assert.equal(nuova.ricevuti.length, 2, 'riprovata una volta, poi basta');
  assert.deepEqual(nuova.ricevuti.map((m) => [m.payload.command, m.payload.context.entry.id]), [['save-for-later-confirm', 'E9'], ['save-for-later-confirm', 'E9']]);
});

test('la conferma di ripiego segue la scheda che l\'utente ha davanti, e si arrende a tempo scaduto', async () => {
  const prima = makeTab({ id: 'A', url: 'https://a.example/' }, null);
  const dopo = makeTab({ id: 'B', url: 'https://b.example/' }, 'presa');
  const win = makeWin(prima);
  win._filoTabs.tabs.push(dopo);
  setTimeout(() => { win._filoTabs.activeId = 'B'; }, 30);
  assert.equal(await confermaSullaSchedaDavanti(win, { id: 'E7' }, { tentativoMs: 20, totaleMs: 2000 }), true);
  assert.equal(dopo.ricevuti.length, 1);

  const muta = makeTab({ id: 'M' }, null);
  assert.equal(await confermaSullaSchedaDavanti(makeWin(muta), { id: 'E8' }, { tentativoMs: 10, totaleMs: 500 }), false);
  assert.ok(muta.ricevuti.length >= 2, 'nel frattempo ha riprovato');
});

test('le scorciatoie vanno alla finestra di Filo a fuoco (anche l\'incognito), non a quella con cui sono state registrate', async () => {
  saved = null; closed = null;
  const dietro = makeTab({ id: 'N', url: 'https://normale.example/' }, 'presa');
  const davanti = makeTab({ id: 'I', url: 'https://incognito.example/' }, 'presa');
  const principale = makeWin(dietro);
  const incognito = makeWin(davanti);
  BrowserWindowStub.getFocusedWindow = () => incognito;
  try {
    dispatch('save-for-later', principale);
    dispatch('explain-selection', principale);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(dietro.ricevuti.length, 0, 'alla finestra dietro non arriva niente');
    assert.deepEqual(davanti.ricevuti.map((m) => m.payload.command), ['save-for-later', 'explain-selection']);
    // Una finestra senza schede a fuoco (un menu a comparsa) non conta: resta la finestra di Filo di prima.
    BrowserWindowStub.getFocusedWindow = () => ({ isDestroyed: () => false });
    dispatch('explain-selection', principale);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(dietro.ricevuti.length, 1);
  } finally {
    delete BrowserWindowStub.getFocusedWindow;
  }
});

test('ogni conferma di ripiego porta un\'etichetta sua, uguale in tutti i tentativi', async () => {
  const muta = makeTab({ id: 'M2' }, null);
  await confermaSullaSchedaDavanti(makeWin(muta), { id: 'E5' }, { tentativoMs: 10, totaleMs: 200 });
  const etichette = new Set(muta.ricevuti.map((m) => m.payload.context.conferma));
  assert.equal(etichette.size, 1, 'la pagina riconosce i tentativi dello stesso salvataggio');
  const altra = makeTab({ id: 'M3' }, null);
  await confermaSullaSchedaDavanti(makeWin(altra), { id: 'E5' }, { tentativoMs: 10, totaleMs: 50 });
  assert.notEqual(altra.ricevuti[0].payload.context.conferma, [...etichette][0], 'un salvataggio nuovo della stessa voce si conferma di nuovo');
});

test('un secondo Alt+S sulla scheda che aspetta ancora la pagina non avvia un secondo salvataggio', async () => {
  saved = null; closed = null;
  let chiusure = 0;
  const tab = makeTab({ id: 'D1', url: 'https://lenta.example/' }, 'rifiutata');
  const win = makeWin(tab);
  win._filoTabs.closeTab = (id) => { closed = id; chiusure++; };
  dispatch('save-for-later', win);
  dispatch('save-for-later', win);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(tab.ricevuti.filter((m) => m.payload.command === 'save-for-later').length, 1, 'un salvataggio per scheda alla volta');
  assert.equal(chiusure, 1);
  // Finito quello, la stessa scheda (se è ancora lì) si può salvare di nuovo.
  dispatch('save-for-later', win);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(tab.ricevuti.filter((m) => m.payload.command === 'save-for-later').length, 2);
});

test('una pagina che prende la scorciatoia quando il main ha smesso di aspettare non la esegue: la fa già lui', () => {
  const consegna = require(join(ROOT, 'src', 'preload', 'scorciatoia.js'));
  const esegui = (scade) => {
    const eseguiti = [];
    const ricevute = [];
    const ascoltatore = (msg, _s, rispondi) => { eseguiti.push(msg.command); rispondi({ presa: true }); };
    consegna([ascoltatore], { command: 'save-for-later', ricevuta: 'R', scade }, (m) => { ricevute.push(m.presa); });
    return { eseguiti, ricevute };
  };
  assert.deepEqual(esegui(Date.now() + 3000), { eseguiti: ['save-for-later'], ricevute: [true] });
  assert.deepEqual(esegui(Date.now() - 1), { eseguiti: [], ricevute: [false] }, 'in ritardo: il main ha già salvato da sé');
  assert.deepEqual(esegui(undefined), { eseguiti: ['save-for-later'], ricevute: [true] }, 'senza scadenza (vecchio main) si esegue');
});
