// Giro 3 di verifica del #679 — la stessa famiglia dei due giri prima, da tre
// porte nuove: quando la richiesta non torna indietro con la configurazione
// vera, Filo mette in circolo (e a volte mette via) un «non c'è» inventato.
//
// Qui la richiesta non fallisce per la rete: parte SENZA le credenziali,
// perché il rinnovo della sessione ha inciampato per un istante. Il server
// risponde «non ti riguarda», che è una risposta definitiva — ma solo per chi
// l'ha davvero chiesto da non-proprietario.
//
// Non serve aprire Filo: sono i moduli che leggono la configurazione.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const sessione = { tokenRotto: false };
const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true, children: [], paths: [],
  exports: {
    isSignedIn: () => true,
    isAdmin: () => true,
    getIdToken: async () => {
      if (sessione.tokenRotto) throw new Error('refresh sessione fallito (503)');
      return 'finto-id-token';
    },
    getProfile: () => ({ email: 'owner@esempio.it', name: 'Proprietario' }),
    getUid: async () => 'uid-finto',
    onChange: () => () => {},
  },
};

require(join(ROOT, 'src', 'main', 'services', 'loader.js'));
const Support = require(join(ROOT, 'src', 'main', 'services', 'supportModelsStore.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));

// Firestore finto: risponde con la configurazione vera SOLO a chi si presenta
// con le credenziali; a chiunque altro «non ti riguarda», come fanno le regole.
function firestoreDelProprietario({ slot = 'modello-scelto-dall-owner', chiave = 'sk-del-proprietario' } = {}) {
  return async (url, opts) => {
    const u = String(url);
    const metodo = (opts && opts.method) || 'GET';
    if (metodo === 'PATCH') return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
    const conCredenziali = Boolean(opts && opts.headers && opts.headers.Authorization);
    if (!conCredenziali) {
      return { ok: false, status: 403, async json() { return {}; }, async text() { return 'permission denied'; } };
    }
    if (u.includes('judgeSecrets')) {
      return { ok: true, status: 200, async json() { return { fields: { openrouterKey: { stringValue: chiave } } }; }, async text() { return ''; } };
    }
    if (u.includes('config/secrets')) {
      return {
        ok: true, status: 200, async text() { return ''; },
        async json() { return { fields: { apiKeys: { mapValue: { fields: { openrouter: { stringValue: chiave } } } } } }; },
      };
    }
    return { ok: true, status: 200, async json() { return { fields: { judge1: { stringValue: slot } } }; }, async text() { return ''; } };
  };
}

test('modelli di supporto: la sessione che inciampa per un istante spegne la configurazione del proprietario per cinque minuti', async () => {
  const origFetch = global.fetch;
  global.fetch = firestoreDelProprietario();
  let ora = 0;
  Support._setAdesso(() => ora);
  Support.invalidaCache();
  sessione.tokenRotto = false;
  try {
    const buona = await Support.get();
    expect(buona.judge1, 'premessa: con la sessione a posto la configurazione arriva').toBe('modello-scelto-dall-owner');
    expect(buona.openrouterKeyPresent, 'premessa: la chiave dei giudici risulta impostata').toBe(true);

    // Un solo istante: il rinnovo del token non parte, la richiesta esce nuda.
    Support.invalidaCache();
    sessione.tokenRotto = true;
    await Support.get();

    // La sessione è tornata subito dopo.
    sessione.tokenRotto = false;
    ora += 1000;
    const subitoDopo = await Support.get();
    expect(subitoDopo.judge1,
      'con la sessione già tornata la schermata mostra ancora gli slot vuoti e i controlli interni usano il modello scritto nel codice').toBe('modello-scelto-dall-owner');
    expect(subitoDopo.openrouterKeyPresent,
      'con la sessione già tornata la schermata dice ancora che la chiave dei giudici non è impostata').toBe(true);
  } finally {
    global.fetch = origFetch;
    Support._setAdesso(null);
    Support.invalidaCache();
    sessione.tokenRotto = false;
  }
});

test('modelli di supporto: un salvataggio andato a buon fine non deve svuotare la schermata se la rilettura non parte', async () => {
  const origFetch = global.fetch;
  global.fetch = firestoreDelProprietario();
  let ora = 0;
  Support._setAdesso(() => ora);
  Support.invalidaCache();
  sessione.tokenRotto = false;
  try {
    const buona = await Support.get();
    expect(buona.openrouterKeyPresent, 'premessa: la chiave risulta impostata').toBe(true);

    // Il salvataggio passa; un attimo dopo la rilettura no.
    global.fetch = async (url, opts) => {
      if ((opts && opts.method) === 'PATCH') return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
      return { ok: false, status: 503, async json() { return {}; }, async text() { return ''; } };
    };
    const dopoIlSalvataggio = await Support.update({ judge1: 'flash' }, 'finto-id-token');
    expect(dopoIlSalvataggio.openrouterKeyPresent,
      'appena salvato, la schermata dice che la chiave dei giudici non è impostata').toBe(true);
    expect(dopoIlSalvataggio.judge1,
      'appena salvato, la schermata mostra vuoto lo slot che si è appena scritto').toBe('flash');
  } finally {
    global.fetch = origFetch;
    Support._setAdesso(null);
    Support.invalidaCache();
    sessione.tokenRotto = false;
  }
});

test('configurazione condivisa: la sessione che inciampa fa spendere la chiave dell’installazione per mezz’ora', async () => {
  const origFetch = global.fetch;
  global.fetch = firestoreDelProprietario();
  let ora = 10_000_000;
  Defaults._setAdesso(() => ora);
  sessione.tokenRotto = false;
  try {
    await Defaults.refresh();
    expect(Defaults.get().apiKeys.openrouter, 'premessa: si usa la chiave che il proprietario ha ruotato').toBe('sk-del-proprietario');

    // Un istante senza sessione: `config/models` risponde comunque (è pubblico).
    sessione.tokenRotto = true;
    await Defaults.refresh();

    // La sessione torna un secondo dopo.
    sessione.tokenRotto = false;
    ora += 1000;
    await Defaults.refreshIfStale();
    expect(Defaults.get().apiKeys.openrouter,
      'con la sessione già tornata Filo continua a spendere la chiave incastonata nell’installazione invece di quella ruotata dal proprietario').toBe('sk-del-proprietario');
  } finally {
    global.fetch = origFetch;
    Defaults._setAdesso(null);
    sessione.tokenRotto = false;
  }
});
