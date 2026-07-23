// Unit test per la scorciatoia globale "Salva per dopo" (Alt+S) in
// src/main/shortcuts.js.
//
// BUG (feedback #277): premendo Alt+S mentre la tab attiva è una pagina interna
// di Filo (filo://newtab/, Opzioni, Cronologia, Bacheca...), dispatch() chiamava
// comunque saveForLater(), che salvava un URL interno in "Aperti per dopo" e
// CHIUDEVA la tab. Gli altri 3 comandi (explain/translate/help) sono già no-op
// sulle pagine interne perché nessun content script li ascolta: "salva per dopo"
// era l'unico caso speciale che non controllava isInternal.
//
// COSA ASSERIAMO (asserire il successo, non l'assenza di errore):
//   - su una tab INTERNA: NESSUN messaggio SAVE_PAGE inviato e closeTab NON
//     chiamato (la tab resta aperta);
//   - su una tab WEB: SAVE_PAGE inviato con l'URL della pagina e closeTab
//     chiamato (comportamento corretto preservato).
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
let closed; // id della tab chiusa, o null

// Stub di ./services/handlers (require-ato dentro saveForLater) e di electron
// (require-ato in cima a shortcuts.js). Intercettiamo Module._load.
const HANDLERS_ID = join(ROOT, 'src', 'main', 'services', 'handlers.js');
const origLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') {
    return { globalShortcut: { register: () => true }, BrowserWindow: {} };
  }
  if (request === './services/handlers') {
    return {
      handleMessage: async (msg) => {
        if (msg && msg.type === globalThis.SN_MSG.MSG.SAVE_PAGE) saved = msg.page;
      },
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

let dispatch;
try {
  ({ dispatch } = require(join(ROOT, 'src', 'main', 'shortcuts.js')));
} finally {
  Module._load = origLoad;
}

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

// Una tab con una webContents fittizia (i metodi async risolvono a vuoto).
function makeTab(over) {
  return {
    id: 'T1',
    url: 'https://example.com/',
    title: 'Example',
    favicon: '',
    isInternal: false,
    view: {
      webContents: {
        send: () => {},
        executeJavaScript: async () => ({}),
        capturePage: async () => ({ resize: () => ({ toDataURL: () => '' }) }),
      },
    },
    ...over,
  };
}

test('Alt+S su pagina interna filo:// non salva e non chiude la tab', async () => {
  saved = null; closed = null;
  const tab = makeTab({ url: 'filo://newtab/', isInternal: true, title: 'Nuova scheda' });
  dispatch('save-for-later', makeWin(tab));
  await new Promise((r) => setTimeout(r, 10)); // lascia svolgere l'eventuale promise
  assert.equal(saved, null, 'una pagina interna NON deve finire in "Aperti per dopo"');
  assert.equal(closed, null, 'la tab interna NON deve essere chiusa');
});

test('Alt+S su pagina interna (solo url filo://, isInternal assente) è comunque no-op', async () => {
  saved = null; closed = null;
  const tab = makeTab({ url: 'filo://history/', isInternal: false });
  dispatch('save-for-later', makeWin(tab));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(saved, null, 'lo schema filo:// da solo basta a bloccare il salvataggio');
  assert.equal(closed, null, 'la tab interna NON deve essere chiusa');
});

test('Alt+S su pagina web salva e chiude la tab (comportamento corretto preservato)', async () => {
  saved = null; closed = null;
  const tab = makeTab({ url: 'https://news.example.com/articolo', title: 'Articolo' });
  dispatch('save-for-later', makeWin(tab));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(saved, 'una pagina web DEVE essere salvata in "Aperti per dopo"');
  assert.equal(saved.url, 'https://news.example.com/articolo');
  assert.equal(closed, 'T1', 'la tab web va chiusa dopo il salvataggio');
});
