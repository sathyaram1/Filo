// Verifica #581, giro 1 — il documento con le chiavi condivise non si apre più
// a chi ha soltanto fatto login.
//
// Il sintomo. Le chiavi che pagano le chiamate di tutti stavano in un documento
// che si leggeva con la sola condizione «account Google con email verificata».
// Iscriversi costa zero e la chiave web del progetto sta in un repo pubblico:
// chiunque, senza nemmeno installare Filo, se le portava via.
//
// Perché queste prove e non quelle che già esistono. La prova che accompagna il
// lavoro guarda un'installazione SLEGATA (nessun login): lì il documento non si
// chiede comunque, perché manca il gettone — quindi passerebbe anche se il
// controllo «sei un amministratore» non ci fosse. Il caso del feedback è un
// altro: uno che il login LO HA FATTO, con un account qualunque. È quello che
// si prova qui, insieme alle due cose che chiudere la porta non deve rompere:
// l'amministratore deve ancora poter ruotare le chiavi, e quando l'owner esce
// dall'installazione le chiavi che aveva letto non devono restare in uso.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..', '..');

// Le chiavi che in produzione la costruzione incastona nell'eseguibile. Qui
// passano per l'ambiente, che è il ripiego dichiarato: stessa strada, stesso
// codice, senza dover impacchettare.
const FABBRICA = {
  openrouter: 'or-fabbrica-581-giro1',
  tavily: 'tav-fabbrica-581-giro1',
  safeBrowsing: 'gsb-fabbrica-581-giro1',
};

// Le chiavi che un amministratore avrebbe scritto nel documento remoto.
const REMOTE = {
  openrouter: 'or-remoto-581-giro1',
  tavily: 'tav-remoto-581-giro1',
};

let app;
let userData;

test.beforeAll(async () => {
  userData = cartellaTemporanea('filo-verifica-581-g1-');
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
      FILO_DEFAULT_OPENROUTER_KEY: FABBRICA.openrouter,
      FILO_DEFAULT_TAVILY_KEY: FABBRICA.tavily,
      FILO_DEFAULT_SAFEBROWSING_KEY: FABBRICA.safeBrowsing,
    },
  });
  await app.firstWindow();
});

test.afterAll(async () => {
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

// Fa finta che qualcuno sia entrato, con o senza i poteri dell'owner, e guarda
// quali documenti l'app va a chiedere. Ritorna gli indirizzi visti e le chiavi
// che a quel punto partirebbero davvero verso il servizio AI.
async function giroDiAggiornamento(app, { admin }) {
  return app.evaluate(async (_electron, { admin, REMOTE }) => {
    const req = (typeof require !== 'undefined') ? require : process.mainModule.require;
    const auth = req(process.cwd() + '/src/main/auth/google-auth.js');
    const Defaults = globalThis.__filoDefaults;

    const veroToken = auth.getIdToken;
    const veroAdmin = auth.isAdmin;
    const veraFetch = global.fetch;
    const viste = [];

    // Un gettone c'è: chi prova a portarsi via le chiavi ce l'ha sempre, basta
    // un account Google qualunque.
    auth.getIdToken = async () => 'gettone-finto-581';
    auth.isAdmin = () => admin;
    global.fetch = async (u) => {
      const url = String(u);
      viste.push(url);
      // Il server risponde col documento solo a chi ha il diritto di leggerlo:
      // è quello che fanno le regole vere, qui riprodotto per vedere cosa l'app
      // farebbe di una risposta piena.
      if (url.includes('config/secrets')) {
        if (!admin) {
          return { ok: false, status: 403, async json() { return { error: { status: 'PERMISSION_DENIED' } }; }, async text() { return 'PERMISSION_DENIED'; } };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              fields: {
                apiKeys: { mapValue: { fields: {
                  openrouter: { stringValue: REMOTE.openrouter },
                  tavily: { stringValue: REMOTE.tavily },
                } } },
              },
            };
          },
          async text() { return ''; },
        };
      }
      return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    };

    try {
      await Defaults.refresh();
    } finally {
      global.fetch = veraFetch;
      auth.getIdToken = veroToken;
      auth.isAdmin = veroAdmin;
    }

    const eff = await globalThis.__filoHandlers.getEffectiveSettings();
    return {
      viste,
      chiaviEffettive: {
        openrouter: (eff.apiKeys && eff.apiKeys.openrouter) || '',
        tavily: (eff.apiKeys && eff.apiKeys.tavily) || '',
      },
    };
  }, { admin, REMOTE });
}

test('chi ha fatto login con un account qualunque non chiede nemmeno il documento delle chiavi', async () => {
  const r = await giroDiAggiornamento(app, { admin: false });

  // Il cuore del feedback: con un gettone valido in mano, l'app NON va a
  // chiedere il documento dei segreti.
  expect(r.viste.some((u) => u.includes('config/secrets'))).toBe(false);
  // E non è che l'aggiornamento sia stato spento in blocco: la config che non è
  // segreta si continua a leggere.
  expect(r.viste.some((u) => u.includes('config/models'))).toBe(true);
  // Le chiavi con cui parte una richiesta restano quelle della costruzione:
  // niente di ciò che il documento remoto contiene è finito qui.
  expect(r.chiaviEffettive.openrouter).toBe(FABBRICA.openrouter);
  expect(r.chiaviEffettive.tavily).toBe(FABBRICA.tavily);
});

test('l’amministratore continua a leggere il documento, altrimenti non potrebbe più ruotare le chiavi', async () => {
  const r = await giroDiAggiornamento(app, { admin: true });

  // Chiudere la porta non deve togliere all'owner la schermata da cui le chiavi
  // si cambiano: se questo diventasse rosso, la rotazione chiesta dal feedback
  // non sarebbe più possibile da dentro Filo.
  expect(r.viste.some((u) => u.includes('config/secrets'))).toBe(true);
  expect(r.chiaviEffettive.openrouter).toBe(REMOTE.openrouter);
  expect(r.chiaviEffettive.tavily).toBe(REMOTE.tavily);
});

test('quando l’owner esce dall’installazione, le chiavi che aveva letto non restano in uso', async () => {
  // Ordine voluto: prima entra l'owner (e le chiavi remote finiscono in
  // memoria), poi esce e resta un account qualunque. Se la memoria non si
  // azzerasse, quelle chiavi continuerebbero a partire per un utente che non ha
  // più il diritto di leggerle.
  const conOwner = await giroDiAggiornamento(app, { admin: true });
  expect(conOwner.chiaviEffettive.openrouter).toBe(REMOTE.openrouter);

  const dopoUscita = await giroDiAggiornamento(app, { admin: false });
  expect(dopoUscita.chiaviEffettive.openrouter).toBe(FABBRICA.openrouter);
  expect(dopoUscita.chiaviEffettive.tavily).toBe(FABBRICA.tavily);
});

test('un rifiuto del server non lascia Filo senza chiavi', async () => {
  // Se un domani la regola dicesse di no anche all'owner (allowlist cambiata,
  // documento cancellato), l'app non deve restare muta: le chiavi della
  // costruzione sono il pavimento sotto ogni caso.
  const r = await app.evaluate(async () => {
    const req = (typeof require !== 'undefined') ? require : process.mainModule.require;
    const auth = req(process.cwd() + '/src/main/auth/google-auth.js');
    const Defaults = globalThis.__filoDefaults;
    const veroToken = auth.getIdToken;
    const veroAdmin = auth.isAdmin;
    const veraFetch = global.fetch;

    auth.getIdToken = async () => 'gettone-finto-581';
    auth.isAdmin = () => true;
    global.fetch = async () => ({
      ok: false, status: 403,
      async json() { return { error: { status: 'PERMISSION_DENIED' } }; },
      async text() { return 'PERMISSION_DENIED'; },
    });
    try {
      await Defaults.refresh();
    } finally {
      global.fetch = veraFetch;
      auth.getIdToken = veroToken;
      auth.isAdmin = veroAdmin;
    }
    const eff = await globalThis.__filoHandlers.getEffectiveSettings();
    return {
      openrouter: (eff.apiKeys && eff.apiKeys.openrouter) || '',
      tavily: (eff.apiKeys && eff.apiKeys.tavily) || '',
      safeBrowsing: eff.safeBrowsingKey || '',
    };
  });

  expect(r.openrouter).toBe(FABBRICA.openrouter);
  expect(r.tavily).toBe(FABBRICA.tavily);
  // La chiave del rilevamento siti pericolosi viveva SOLO nel documento remoto:
  // se non viaggiasse con la costruzione, chiudere la porta spegnerebbe in
  // silenzio il primo stadio per tutti.
  expect(r.safeBrowsing).toBe(FABBRICA.safeBrowsing);
});
