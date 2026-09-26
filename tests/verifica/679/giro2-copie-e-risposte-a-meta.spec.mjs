// Giro 2 di verifica del #679 — le copie in memoria viste dal lato di chi usa
// Filo. La segnalazione chiede, per ciascuna, che «un errore di rete non
// avveleni la copia buona»: qui si guarda cosa vede l'utente quando una
// lettura riesce solo a metà, e quando la rete torna.
//
// Non serve aprire Filo: sono i moduli che leggono la configurazione, e
// girano in Node.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const sessione = { admin: true, email: 'owner@esempio.it' };
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

const Support = require(join(ROOT, 'src', 'main', 'services', 'supportModelsStore.js'));

// La porta gemella di quella del primo giro (la chiave dei giudici), dal lato
// che pesa: se metà risposta vale come risposta, gli slot letti a metà restano
// quelli per tutta la durata della copia, anche con la rete tornata.
test('modelli di supporto: gli slot letti a metà non restano fermi quando la rete torna', async () => {
  const origFetch = global.fetch;
  let slotRaggiungibili = false;
  global.fetch = async (url) => {
    if (String(url).includes('judgeSecrets')) {
      return { ok: true, status: 200, async json() { return { fields: { openrouterKey: { stringValue: 'sk-vera' } } }; }, async text() { return ''; } };
    }
    if (!slotRaggiungibili) throw new Error('rete');
    return { ok: true, status: 200, async json() { return { fields: { judge1: { stringValue: 'modello-scelto-dall-owner' } } }; }, async text() { return ''; } };
  };
  Support._setAdesso(() => 0);
  Support.invalidaCache();
  try {
    const primo = await Support.get();
    expect(primo.judge1 || '', 'premessa: la lettura degli slot non è riuscita').toBe('');
    slotRaggiungibili = true;
    Support._setAdesso(() => 5 * 1000);
    const secondo = await Support.get();
    expect(secondo.judge1,
      'i controlli interni continuano a usare il modello scritto nel codice invece di quello scelto dall’owner').toBe('modello-scelto-dall-owner');
  } finally {
    global.fetch = origFetch;
    Support._setAdesso(null);
    Support.invalidaCache();
  }
});
