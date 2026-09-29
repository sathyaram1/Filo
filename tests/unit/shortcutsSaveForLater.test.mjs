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
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') {
    return { BrowserWindow: {} };
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

const { dispatch, consegnaConRicevuta, riceviRicevuta } = require(join(ROOT, 'src', 'main', 'shortcuts.js'));

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
  dispatch('save-for-later', makeWin(tab));
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
  const davanti = makeTab({ id: 'T2', url: 'https://altro.example.com/', title: 'Altro' }, null);
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
