// Verifica #591 — giro 4. Il «confermo» scritto su un sito di truffa vale per
// tutti i suoi vicini di piattaforma.
//
// Il giro 2 aveva chiuso la strada del VERDETTO che sbordava fra vicini: il
// ricordo del controllo profondo è tornato sull'indirizzo completo, così il
// giudizio di paypa1-accedi.pages.dev non marchia più portfolio-di-marco.pages.dev.
// Resta aperta la metà opposta, quella che abbassa la guardia invece di
// alzarla: la conferma dell'utente («scrivi confermo per proseguire») e la
// chiusura dell'avviso giallo si ricordano per DOMINIO REGISTRABILE, che su
// quelle piattaforme è la piattaforma stessa. Chi ha proseguito una volta su
// un sito ospitato non vede più la pagina rossa su NESSUN altro sito ospitato
// lì, per tutta la vita della scheda — nemmeno su una truffa diversa, di un
// altro proprietario, che Filo ha riconosciuto pericolosa.
//
// Logica pura: niente Electron, la finestra nascosta è finta e la scheda è un
// oggetto finto su cui si installano i veri metodi di Filo.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));
const { installSafebrowse } = require_(join(REPO, 'src/main/tabs/tabSafebrowse.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const DA_EMAIL = { linkOrigin: 'email', hasPassword: true };

const TRUFFA_A = 'https://paypa1-accedi.pages.dev/login';
const TRUFFA_B = 'https://micros0ft-accesso.pages.dev/login';

function pulisci() {
  for (const c of Object.values(SB._caches)) if (typeof c.clear === 'function') c.clear();
  for (const s of Object.values(SB._inFlight)) s.clear();
}

// Una scheda finta con i metodi veri di Filo installati sopra.
function scheda() {
  class FintoTabManager {
    constructor() {
      this.tabs = [{ id: 1, view: { webContents: { send() {} } } }];
    }
  }
  installSafebrowse(FintoTabManager);
  return new FintoTabManager();
}

async function verdettoProfondo(url, pericoloso) {
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async () => null,
    sandbox: async () => (pericoloso
      ? { verdict: 'dangerous', finalUrl: 'https://x', redirects: [], download: 'setup.exe' }
      : { verdict: 'clean' }),
  });
  SB.analyze(url, DA_EMAIL, () => {});
  await attendi(200);
  return SB.checkSync(url, DA_EMAIL);
}

test('il «confermo» su una truffa toglie la pagina rossa a una truffa diversa dello stesso ospite', async () => {
  pulisci();
  const tm = scheda();

  // Prima truffa: pagina rossa, l'utente scrive «confermo» e prosegue.
  expect((await verdettoProfondo(TRUFFA_A, true)).level).toBe('pericoloso');
  tm.safebrowseProceed(1, TRUFFA_A);

  // Seconda truffa, di un altro proprietario, sullo stesso ospite gratuito:
  // Filo la riconosce pericolosa lo stesso.
  const vB = await verdettoProfondo(TRUFFA_B, true);
  expect(vB.level, 'il verdetto della seconda truffa è suo e resta pericoloso').toBe('pericoloso');

  // Ma quello che l'utente vede passa dallo stato della scheda.
  const mostrato = tm._sbApplyState(tm.tabs[0], vB);
  expect(mostrato.level,
    'la pagina rossa deve comparire: l\'utente non ha confermato NIENTE su questo sito')
    .toBe('pericoloso');
});

// La stessa identità sbagliata, nella direzione opposta: qui non abbassa la
// guardia, l'alza su chi non c'entra. L'esito del certificato è ricordato per
// dominio registrabile, quindi il certificato scaduto di UN sito ospitato
// dichiara «connessione non protetta» su tutti i vicini — col nome della
// piattaforma al posto del nome del sito.
test('il certificato scaduto di un sito ospitato mette l\'avviso sui vicini', async () => {
  pulisci();
  expect(SB.checkSync('https://portfolio-di-marco.pages.dev/', {}).level).toBe('safe');

  SB.recordCert('pages.dev', 'expired');

  const v = SB.checkSync('https://portfolio-di-marco.pages.dev/', {});
  expect(v.level, 'il certificato di un altro sito non dice niente su questo').toBe('safe');
});

test('anche l\'avviso giallo chiuso una volta non torna sui vicini', async () => {
  pulisci();
  const tm = scheda();

  const vA = SB.checkSync('http://accedi-sicuro.pages.dev/login', { hasPassword: true });
  expect(vA.level).toBe('sospetto');
  tm.safebrowseDismiss(1, 'http://accedi-sicuro.pages.dev/login');

  const vB = SB.checkSync('http://paypa1-conferma.pages.dev/login', { hasPassword: true });
  expect(vB.level).toBe('sospetto');
  const mostrato = tm._sbApplyState(tm.tabs[0], vB);
  expect(mostrato.level,
    'l\'avviso di questo sito non è stato chiuso da nessuno: deve comparire')
    .toBe('sospetto');
});
