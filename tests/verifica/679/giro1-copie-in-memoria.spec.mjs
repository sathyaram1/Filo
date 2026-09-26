// Giro 1 di verifica del #679 — le copie in memoria e l'esito della lettura.
//
// La segnalazione chiede, per ogni copia, che «un errore di rete non avveleni
// la copia buona». Qui si guarda cosa succede quando la lettura NON riesce, o
// riesce solo a metà. Non serve aprire Filo: sono i moduli che leggono la
// configurazione, e girano in Node.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Sessione finta al posto del modulo di accesso: chi sta usando Filo e con
// quale token. La si cambia da un test all'altro.
const sessione = { admin: false, email: 'persona@esempio.it' };
const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true, children: [], paths: [],
  exports: {
    isSignedIn: () => true,
    isAdmin: () => sessione.admin,
    getIdToken: async () => 'finto-id-token',
    getProfile: () => ({ email: sessione.email, name: 'Persona' }),
    getUid: async () => 'uid-finto',
    onChange: () => () => {},
  },
};

const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));
const Support = require(join(ROOT, 'src', 'main', 'services', 'supportModelsStore.js'));

test('config dei modelli: una lettura NON riuscita non deve valere come lettura fatta', async () => {
  const origFetch = global.fetch;
  const chiamate = [];
  let rete = 'giu';
  global.fetch = async (url) => {
    chiamate.push(String(url));
    if (rete === 'giu') throw new Error('offline');
    return {
      ok: true, status: 200,
      async json() { return { fields: { models: { mapValue: { fields: { help: { stringValue: 'pro' } } } } } }; },
      async text() { return ''; },
    };
  };
  try {
    // Filo si apre mentre la rete non c'è ancora (portatile che si sveglia):
    // la config condivisa non arriva, e senza di lei nessuna funzione ha un
    // modello da usare.
    await Defaults.refresh();
    expect(Defaults.get().models.help, 'premessa: senza rete non c’è config remota').toBeFalsy();
    // La rete torna un istante dopo, e l'utente apre le Opzioni: è l'unico
    // punto in cui l'app riprova da sola.
    rete = 'su';
    const prima = chiamate.length;
    await Defaults.refreshIfStale();
    expect(chiamate.length,
      'dopo una lettura fallita l’app aspetta mezz’ora prima di riprovare, e intanto resta senza modelli').toBeGreaterThan(prima);
    expect(Defaults.get().models.help).toBe('pro');
  } finally {
    global.fetch = origFetch;
  }
});

test('modelli di supporto: a chi non gestisce Filo la copia dura mezzo minuto invece di cinque', async () => {
  const origFetch = global.fetch;
  let richieste = 0;
  sessione.admin = false;
  // Le regole del server negano questi due documenti a chiunque non gestisca
  // Filo: non è un singhiozzo, è la risposta normale e definitiva per quasi
  // tutti quelli che useranno Filo.
  global.fetch = async () => { richieste += 1; return { ok: false, status: 403, async json() { return {}; }, async text() { return 'denied'; } }; };
  Support._setAdesso(() => 0);
  Support.invalidaCache();
  try {
    await Support.get();
    const dopoLaPrima = richieste;
    Support._setAdesso(() => 60 * 1000); // un minuto dopo: dentro i cinque chiesti
    await Support.get();
    expect(richieste,
      'una risposta «non ti riguarda» non è un guasto passeggero: non deve far ripartire le letture ogni mezzo minuto').toBe(dopoLaPrima);
  } finally {
    global.fetch = origFetch;
    Support._setAdesso(null);
    Support.invalidaCache();
  }
});

test('modelli di supporto: un singhiozzo sulla chiave la fa sparire dalla schermata per cinque minuti', async () => {
  const origFetch = global.fetch;
  sessione.admin = true;
  let chiaveRaggiungibile = false;
  global.fetch = async (url) => {
    if (String(url).includes('judgeSecrets')) {
      if (!chiaveRaggiungibile) throw new Error('rete');
      return { ok: true, status: 200, async json() { return { fields: { openrouterKey: { stringValue: 'sk-vera' } } }; }, async text() { return ''; } };
    }
    return { ok: true, status: 200, async json() { return { fields: { judge1: { stringValue: 'flash' } } }; }, async text() { return ''; } };
  };
  Support._setAdesso(() => 0);
  Support.invalidaCache();
  try {
    const primo = await Support.get();
    expect(primo.openrouterKeyPresent, 'premessa: la lettura della chiave non è riuscita').toBe(false);
    chiaveRaggiungibile = true;
    Support._setAdesso(() => 5 * 1000); // cinque secondi dopo, la schermata si riapre
    const secondo = await Support.get();
    expect(secondo.openrouterKeyPresent,
      'la schermata continua a dire che la chiave dei giudici non è impostata anche quando c’è').toBe(true);
  } finally {
    global.fetch = origFetch;
    Support._setAdesso(null);
    Support.invalidaCache();
    sessione.admin = false;
  }
});
