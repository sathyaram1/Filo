// Verifica #581, giro 2 — le porte attorno alla chiave condivisa, provate una
// per una.
//
// Il sintomo di partenza. Le chiavi che pagano le chiamate di tutti stavano in
// un documento che si apriva alla sola condizione «account Google con email
// verificata». Iscriversi costa zero e la chiave web del progetto sta in un
// repo pubblico: chiunque se le portava via senza nemmeno installare Filo.
//
// Il giro 1 aveva provato la barriera (le regole, col motore vero) e il fatto
// che un'installazione appena fatta non chieda più quel documento. Qui si
// contano le ALTRE strade che portano allo stesso stato sbagliato — cioè «una
// chiave condivisa in mano a chi non deve averla», oppure il suo rovescio,
// «l'amministratore non riesce più a ruotarla»:
//
//   · l'amministratore la legge davvero (se no le chiavi non si ruotano più da
//     dentro Filo, e la porta chiusa avrebbe rotto la rotazione);
//   · l'amministratore ESCE dallo stesso computer: quello che aveva letto non
//     deve restare in uso per l'account che subentra;
//   · il documento risponde con campi vuoti: non deve cancellare le chiavi che
//     arrivano col pacchetto, lasciando Filo muto;
//   · valori strapazzati (spazi, diecimila caratteri, emoji, virgolette);
//   · il controllo locale «sono amministratore?» che esplode, e il server che
//     risponde permesso negato: in nessuno dei due casi si resta senza chiavi.
//
// Come sono provate. Il pezzo che decide tutto questo è lo store della
// configurazione condivisa nel processo principale di Filo. Qui viene caricato
// davvero, col suo codice, sostituendo solo il modulo che dice «chi sei» — che
// è l'unica cosa che in questo contenitore non si può avere (senza portachiavi
// di sistema una sessione vera non si può seminare, limite già dichiarato al
// giro 1). Le richieste di rete vengono intercettate: così si vede anche QUALI
// documenti Filo va a chiedere, che è metà della risposta.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);

// Le chiavi che in produzione la costruzione incastona nell'eseguibile. Qui
// passano per l'ambiente, che è la stessa strada letta dallo stesso codice.
const PACCHETTO = { tavily: 'tav-pacchetto-581-g2', safeBrowsing: 'gsb-pacchetto-581-g2' };
process.env.FILO_DEFAULT_TAVILY_KEY = PACCHETTO.tavily;
process.env.FILO_DEFAULT_SAFEBROWSING_KEY = PACCHETTO.safeBrowsing;
delete process.env.FILO_DEFAULT_OPENROUTER_KEY;

// Chi sta usando Filo. Il modulo vero parla col portachiavi di sistema, che in
// questo contenitore non c'è: qui si sostituisce SOLO lui.
const chi = { amministratore: false, token: null, esplode: false };
const percorsoAuth = require.resolve(resolve(RADICE, 'src', 'main', 'auth', 'google-auth.js'));
require.cache[percorsoAuth] = {
  id: percorsoAuth,
  filename: percorsoAuth,
  loaded: true,
  exports: {
    isAdmin: () => { if (chi.esplode) throw new Error('portachiavi non disponibile'); return chi.amministratore; },
    getIdToken: async () => chi.token,
    isSignedIn: () => Boolean(chi.token),
    getProfile: () => null,
  },
};

const Defaults = require(resolve(RADICE, 'src', 'main', 'services', 'defaultsStore.js'));

// Rete finta. `risposte` decide cosa torna per ogni documento; `chiesti` tiene
// l'elenco di quello che Filo è andato davvero a chiedere.
let chiesti = [];
let risposte = {};
const fetchVero = globalThis.fetch;

function campi(oggetto) {
  const fields = {};
  for (const [k, v] of Object.entries(oggetto)) {
    if (v && typeof v === 'object') {
      const dentro = {};
      for (const [k2, v2] of Object.entries(v)) dentro[k2] = { stringValue: String(v2) };
      fields[k] = { mapValue: { fields: dentro } };
    } else {
      fields[k] = { stringValue: String(v) };
    }
  }
  return { fields };
}

test.beforeEach(() => {
  chiesti = [];
  risposte = {};
  globalThis.fetch = async (u) => {
    const percorso = String(u).split('/documents/')[1]?.split('?')[0] || String(u);
    chiesti.push(percorso);
    const r = risposte[percorso];
    if (r === 'negato') return { ok: false, status: 403, async json() { return {}; }, async text() { return ''; } };
    if (!r) return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    return { ok: true, status: 200, async json() { return campi(r); }, async text() { return ''; } };
  };
});

test.afterAll(() => { globalThis.fetch = fetchVero; });

// Riporta lo store allo stato «installazione qualunque, appena aperta».
async function tornaUtenteNormale() {
  chi.amministratore = false; chi.token = null; chi.esplode = false;
  await Defaults.refresh();
}

test('un\'installazione qualunque non chiede nemmeno il documento delle chiavi', async () => {
  chi.amministratore = false; chi.token = null;
  risposte['config/secrets'] = { apiKeys: { tavily: 'tav-RUBATA' }, safeBrowsingKey: 'gsb-RUBATA' };

  await Defaults.refresh();

  expect(chiesti).not.toContain('config/secrets');
  const eff = Defaults.get();
  expect(eff.apiKeys.tavily).toBe(PACCHETTO.tavily);
  expect(eff.safeBrowsingKey).toBe(PACCHETTO.safeBrowsing);
  // E nemmeno per sbaglio deve comparire il valore del documento chiuso.
  expect(JSON.stringify(eff)).not.toContain('RUBATA');
});

test('anche loggato, chi non è amministratore non apre il documento', async () => {
  // Il caso peggiore della segnalazione: un account Google vero, con email
  // verificata, che però non è nell\'elenco degli amministratori.
  chi.amministratore = false; chi.token = 'token-di-un-account-qualunque';
  risposte['config/secrets'] = { apiKeys: { tavily: 'tav-RUBATA' } };

  await Defaults.refresh();

  expect(chiesti).not.toContain('config/secrets');
  expect(Defaults.get().apiKeys.tavily).toBe(PACCHETTO.tavily);
});

test('l\'amministratore legge ancora: le chiavi si ruotano da dentro Filo', async () => {
  chi.amministratore = true; chi.token = 'token-amministratore';
  risposte['config/secrets'] = { apiKeys: { tavily: 'tav-RUOTATA' }, safeBrowsingKey: 'gsb-RUOTATA' };

  await Defaults.refresh();

  expect(chiesti).toContain('config/secrets');
  expect(Defaults.get().apiKeys.tavily).toBe('tav-RUOTATA');
  expect(Defaults.get().safeBrowsingKey).toBe('gsb-RUOTATA');

  await tornaUtenteNormale();
});

test('l\'amministratore esce: quello che aveva letto non resta in uso', async () => {
  // Stesso computer, due persone. Se la chiave letta da amministratore restasse
  // nella memoria di Filo, l\'account che subentra continuerebbe a spendere su
  // una credenziale che non potrebbe nemmeno leggere.
  chi.amministratore = true; chi.token = 'token-amministratore';
  risposte['config/secrets'] = { apiKeys: { tavily: 'tav-RUOTATA' }, safeBrowsingKey: 'gsb-RUOTATA' };
  await Defaults.refresh();
  expect(Defaults.get().apiKeys.tavily).toBe('tav-RUOTATA');

  chiesti = [];
  chi.amministratore = false; chi.token = null;
  await Defaults.refresh();

  expect(chiesti).not.toContain('config/secrets');
  expect(Defaults.get().apiKeys.tavily).toBe(PACCHETTO.tavily);
  expect(Defaults.get().safeBrowsingKey).toBe(PACCHETTO.safeBrowsing);
});

test('un documento a campi vuoti non lascia Filo senza chiavi', async () => {
  // Il documento esiste ma l\'amministratore non l\'ha ancora riempito (o ha
  // appena svuotato un campo): le chiavi del pacchetto sono il pavimento.
  chi.amministratore = true; chi.token = 'token-amministratore';
  risposte['config/secrets'] = { apiKeys: { tavily: '   ' }, safeBrowsingKey: '' };

  await Defaults.refresh();

  expect(Defaults.get().apiKeys.tavily).toBe(PACCHETTO.tavily);
  expect(Defaults.get().safeBrowsingKey).toBe(PACCHETTO.safeBrowsing);

  await tornaUtenteNormale();
});

test('valori strapazzati: spazi, diecimila caratteri, emoji e virgolette', async () => {
  chi.amministratore = true; chi.token = 'token-amministratore';
  const lunga = 'k'.repeat(10000);
  risposte['config/secrets'] = {
    apiKeys: { tavily: `  ${lunga}  ` },
    safeBrowsingKey: '  gsb-🙂-"<script>alert(1)</script>"  ',
  };

  await Defaults.refresh();

  const eff = Defaults.get();
  expect(eff.apiKeys.tavily).toBe(lunga);              // ripulita ai bordi, non troncata
  expect(eff.safeBrowsingKey).toBe('gsb-🙂-"<script>alert(1)</script>"');
  expect(() => Defaults.getPublicForAdmin()).not.toThrow();
  expect(Defaults.getPublicForAdmin().apiKeysPresent.tavily).toBe(true);
  // La versione che la pagina dell\'amministratore riceve non porta mai i valori.
  expect(JSON.stringify(Defaults.getPublicForAdmin())).not.toContain(lunga.slice(0, 50));

  await tornaUtenteNormale();
});

test('se il controllo locale «sono amministratore?» esplode, il documento resta chiuso', async () => {
  chi.esplode = true; chi.token = 'token-qualunque';
  risposte['config/secrets'] = { apiKeys: { tavily: 'tav-RUBATA' } };

  await Defaults.refresh();

  expect(chiesti).not.toContain('config/secrets');
  expect(Defaults.get().apiKeys.tavily).toBe(PACCHETTO.tavily);

  await tornaUtenteNormale();
});

test('permesso negato su tutto: restano le chiavi del pacchetto, senza crollare', async () => {
  chi.amministratore = true; chi.token = 'token-amministratore';
  risposte['config/models'] = 'negato';
  risposte['config/secrets'] = 'negato';

  await Defaults.refresh();

  const eff = Defaults.get();
  expect(eff.apiKeys.tavily).toBe(PACCHETTO.tavily);
  expect(eff.safeBrowsingKey).toBe(PACCHETTO.safeBrowsing);

  await tornaUtenteNormale();
});

test('dieci aggiornamenti insieme non fanno sfuggire una richiesta al documento chiuso', async () => {
  chi.amministratore = false; chi.token = 'token-di-un-account-qualunque';
  risposte['config/secrets'] = { apiKeys: { tavily: 'tav-RUBATA' } };

  await Promise.all(Array.from({ length: 10 }, () => Defaults.refresh()));

  expect(chiesti.filter((c) => c === 'config/secrets')).toEqual([]);
  expect(Defaults.get().apiKeys.tavily).toBe(PACCHETTO.tavily);
});
