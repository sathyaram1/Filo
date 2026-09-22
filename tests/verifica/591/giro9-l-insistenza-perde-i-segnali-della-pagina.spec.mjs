// Verifica #591 — giro 9. L'insistenza della scheda ripresenta la pagina con il
// contesto sbagliato.
//
// Il giro 8 ha chiuso la porta «la pagina ostile svuota il conto della catena e
// la truffa che arriva dopo resta senza controllo»: quando il conto è vuoto la
// verifica non si perde, si RIMANDA, e la scheda la richiede insistendo finché
// l'utente è rimasto lì.
//
// Il contesto che la scheda ripresenta però è quello che aveva in mano quando
// ha programmato il rinvio, e il primo a chiederlo è il cammino della
// NAVIGAZIONE, che della pagina non sa ancora niente: nessun campo password,
// nessun campo di pagamento. È proprio quel segnale a far salire la pagina a
// «sospetto» e a far partire il giudizio del modello. La richiesta più ricca,
// che arriva subito dopo dallo script della pagina, trova un rinvio già in
// coda e viene buttata.
//
// Due conseguenze, una causa sola:
//   1) la truffa non riceve mai il giudizio del modello né la finestra nascosta;
//   2) l'avviso che lo script della pagina aveva già mostrato viene ritirato
//      dall'insistenza stessa, che annuncia «sicuro» cinque secondi dopo.
//
// Logica pura: le chiamate di rete e al modello sono finte.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));
const { installSafebrowse } = require_(join(REPO, 'src/main/tabs/tabSafebrowse.js'));

// Due pagine di accesso mai viste. Sulla prima il campo password è l'unico
// motivo per cui Filo chiede al modello: senza, non c'è niente da approfondire.
// Sulla seconda, che viaggia anche in chiaro, il campo password è quello che la
// porta da «sicuro» a «sospetto», cioè fa comparire l'avviso.
const TRUFFA_MUTA = 'https://accesso-clienti.banca-esempio-verify.top/login';
const TRUFFA_AVVISATA = 'http://banca-intesa.verify.top/login';

function banco() {
  const giudizi = [];
  const finestre = [];
  const elenco = [];
  SB.setProviders({
    gsb: (url) => { elenco.push(url); return Promise.resolve({ hit: false }); },
    rdap: () => Promise.resolve(null),
    ct: () => Promise.resolve(null),
    llm: (meta) => { giudizi.push(meta.host); return Promise.resolve(null); },
    sandbox: (url) => { finestre.push(url); return Promise.resolve(null); },
  });
  for (const c of Object.values(SB._caches)) c.clear();
  for (const s of Object.values(SB._inFlight)) s.clear();

  class FintoManager {}
  installSafebrowse(FintoManager);
  const tm = new FintoManager();
  tm.incognito = false;

  const annunci = [];
  let dove = '';
  const tab = {
    id: 1,
    view: {
      webContents: {
        getURL: () => dove,
        isDestroyed: () => false,
        send: (_canale, m) => annunci.push({ url: m.url, level: m.level }),
      },
    },
  };
  tm.tabs = [tab];

  // Una navigazione vera: prima si committa (la scheda chiede il verdetto senza
  // sapere niente della pagina), poi la pagina parte e manda i suoi segnali.
  async function naviga(url, { password = false, conNavigazione = true, attesa = 420 } = {}) {
    dove = url;
    if (conNavigazione) tm._sbOnNavigate(tab, url);
    const risposta = tm.safebrowseGet(tab.id, url, { hasPassword: password });
    await new Promise((r) => setTimeout(r, attesa));
    return risposta;
  }

  // La pagina ostile si porta da sola su indirizzi suoi, uno dietro l'altro,
  // e svuota i conti della catena di navigazioni.
  async function raffica(n = 24, conNavigazione = true) {
    for (let i = 0; i < n; i++) {
      await naviga(`https://accesso-clienti.ostile${i}-xyz.top/login`, { password: true, conNavigazione });
    }
  }

  return { giudizi, finestre, elenco, annunci, naviga, raffica };
}

const ATTESA_RINVII = 22000; // i rinvii della scheda sono tre, a poco più di cinque secondi l'uno

test('la truffa in fondo alla raffica non riceve mai il giudizio del modello', async () => {
  test.setTimeout(120000);
  const b = banco();
  await b.raffica();
  const giudiziPrima = b.giudizi.length;
  const finestrePrima = b.finestre.length;

  await b.naviga(TRUFFA_MUTA, { password: true, attesa: 100 });
  await new Promise((r) => setTimeout(r, ATTESA_RINVII));

  expect(
    b.giudizi.slice(giudiziPrima),
    'la pagina dove l\'utente è rimasto deve ricevere il giudizio del modello: è quello che l\'insistenza doveva riottenere',
  ).toContain('accesso-clienti.banca-esempio-verify.top');
  expect(
    b.finestre.length - finestrePrima,
    'e anche il controllo nella finestra nascosta',
  ).toBeGreaterThan(0);
});

test('l\'avviso già mostrato non deve essere ritirato dall\'insistenza', async () => {
  test.setTimeout(120000);
  const b = banco();
  await b.raffica();

  const risposta = await b.naviga(TRUFFA_AVVISATA, { password: true, attesa: 100 });
  expect(risposta.level, 'con il campo password la pagina vale «sospetto»').toBe('sospetto');
  b.annunci.length = 0;
  await new Promise((r) => setTimeout(r, ATTESA_RINVII));

  const sullaTruffa = b.annunci.filter((a) => a.url === TRUFFA_AVVISATA);
  expect(
    sullaTruffa.filter((a) => a.level === 'safe'),
    'nessuno deve annunciare «sicuro» su una pagina che l\'utente sta guardando con l\'avviso davanti: '
    + `annunci ricevuti ${JSON.stringify(sullaTruffa)}`,
  ).toHaveLength(0);
});

test('caso di riscontro: senza il cammino della navigazione l\'insistenza funziona', async () => {
  test.setTimeout(120000);
  const b = banco();
  await b.raffica(24, false);
  const prima = b.giudizi.length;
  await b.naviga(TRUFFA_MUTA, { password: true, conNavigazione: false, attesa: 100 });
  expect(b.giudizi.length - prima, 'sul momento il conto della catena è vuoto: si rimanda').toBe(0);
  await new Promise((r) => setTimeout(r, ATTESA_RINVII));
  expect(
    b.giudizi.slice(prima),
    'qui il rinvio porta con sé i segnali della pagina e il giudizio arriva: è la prova che a mancare è il contesto',
  ).toContain('accesso-clienti.banca-esempio-verify.top');
});

test('caso di riscontro: fuori dalla catena della pagina ostile il controllo parte subito', async () => {
  test.setTimeout(120000);
  const b = banco();
  await b.raffica();
  const prima = b.giudizi.length;
  // Una persona che apre la stessa pagina dopo una pausa apre una catena nuova.
  await new Promise((r) => setTimeout(r, 9000));
  await b.naviga(TRUFFA_MUTA, { password: true, attesa: 300 });
  expect(b.giudizi.slice(prima)).toContain('accesso-clienti.banca-esempio-verify.top');
});
