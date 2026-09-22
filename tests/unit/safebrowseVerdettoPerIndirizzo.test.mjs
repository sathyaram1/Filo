// Unit test — il verdetto del controllo profondo è dell'INDIRIZZO, il freno è
// del DOMINIO (#591, secondo giro di verifica).
//
// Il freno che impedisce alla verifica dei siti pericolosi di ripartire a ogni
// sottodominio era stato messo sul dominio registrabile insieme al verdetto.
// Su un sito normale il dominio registrabile è il sito. Sulle piattaforme dove
// ogni utente riceve un suo sotto-indirizzo (pages.dev, github.io, vercel.app,
// i blog ospitati) è la PIATTAFORMA, e da lì il verdetto di un sito valeva per
// tutti gli altri: un sito di truffa sbarrava con la pagina rossa i siti
// innocenti vicini, e il «pulito» di un sito innocente impediva del tutto il
// controllo del sito di truffa vicino.
//
// Senza la correzione i primi tre casi sono rossi.
//
// L'ultima parte difende l'altra correzione dello stesso giro: gli indirizzi
// della rete di casa (router, NAS, stampante, server di prova) non fanno
// partire né il giudizio del modello né la finestra nascosta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require_ = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = require_(join(ROOT, 'src/main/services/safebrowse/index.js'));
const engine = require_(join(ROOT, 'src/main/services/safebrowse/engine.js'));
const { installSafebrowse } = require_(join(ROOT, 'src/main/tabs/tabSafebrowse.js'));

// Una scheda finta con i metodi veri di Filo installati sopra: serve a provare
// il rinvio della verifica profonda, che vive nella scheda perché solo lei sa
// se l'utente è rimasto su quella pagina.
function schedaSu(url) {
  class FintoTabManager {
    constructor() {
      this.tabs = [{ id: 1, view: { webContents: { getURL: () => url, send() {} } } }];
    }
  }
  installSafebrowse(FintoTabManager);
  return new FintoTabManager();
}

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const DA_EMAIL = { linkOrigin: 'email', hasPassword: true };

function pulisci() {
  for (const c of Object.values(SB._caches)) c.clear();
  for (const s of Object.values(SB._inFlight)) s.clear();
}

test('la finestra nascosta di un sito non marchia i siti vicini della stessa piattaforma', async () => {
  pulisci();
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => null,
    sandbox: async () => ({ verdict: 'dangerous', finalUrl: 'https://x', redirects: [], download: 'setup.exe' }),
  });
  SB.analyze('https://paypa1-accedi.pages.dev/login', DA_EMAIL, () => {});
  await attendi(30);
  assert.equal(
    SB.checkSync('https://paypa1-accedi.pages.dev/login', DA_EMAIL).level, 'pericoloso',
    'il sito controllato deve restare pericoloso',
  );
  for (const url of [
    'https://portfolio-di-marco.pages.dev/',
    'https://documentazione-progetto.pages.dev/guida',
  ]) {
    assert.notEqual(SB.checkSync(url, {}).level, 'pericoloso', `${url} non deve ereditare il verdetto del vicino`);
  }
});

test('il giudizio del modello su un sito non mette l\'avviso sui siti vicini', async () => {
  pulisci();
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => ({ suspicious: true, reason: 'Chiede credenziali su un dominio non ufficiale.', confidence: 'high' }),
    sandbox: async () => null,
  });
  SB.analyze('https://paypa1-accedi.pages.dev/login', DA_EMAIL, () => {});
  await attendi(30);
  assert.equal(SB.checkSync('https://ricette-della-nonna.pages.dev/torte', {}).level, 'safe');
});

test('un vicino già controllato non impedisce il controllo di un sito di truffa', async () => {
  pulisci();
  const finestre = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => ({ suspicious: false, reason: null }),
    sandbox: async (url) => { finestre.push(url); return { verdict: 'clean' }; },
  });
  SB.analyze('https://ap0le-store.pages.dev/x', DA_EMAIL, () => {});
  await attendi(30);
  assert.equal(finestre.length, 1);
  SB.analyze('https://banca-intesa-accesso.pages.dev/login', DA_EMAIL, () => {});
  await attendi(30);
  assert.equal(finestre.length, 2, 'ogni sito deve avere il suo controllo, non quello del vicino');
});

test('una spruzzata di sottodomini non moltiplica le chiamate: il conto è di chi possiede il sito', async () => {
  pulisci();
  let giudizi = 0;
  let finestre = 0;
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => { giudizi++; return { suspicious: false, reason: null }; },
    sandbox: async () => { finestre++; return { verdict: 'clean' }; },
  });
  // Uno alla volta, aspettando ogni volta: è il modo in cui una spruzzata
  // arriva davvero, una navigazione dopo l'altra, e l'unico freno che resta è
  // il conto del dominio.
  for (let i = 0; i < 40; i++) {
    SB.analyze(`http://paypa1-accedi-${i}.esempio-spruzzata-591.tk/login`, DA_EMAIL, () => {});
    await attendi(2);
  }
  assert.equal(giudizi, SB.DEEP_MAX_PER_OWNER, 'quaranta sottodomini, non quaranta giudizi');
  assert.equal(finestre, SB.DEEP_MAX_PER_OWNER, 'quaranta sottodomini, non quaranta finestre');
});

test('gli indirizzi della rete di casa non fanno partire il controllo profondo', async () => {
  pulisci();
  const giudizi = [];
  const finestre = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async (meta) => { giudizi.push(meta && meta.host); return null; },
    sandbox: async (url) => { finestre.push(url); return null; },
  });
  for (const url of [
    'http://127.0.0.1:8080/admin',
    'http://10.0.0.5/setup',
    'http://192.168.1.1/',
    'http://172.20.3.4/stampante',
    'http://169.254.10.1/',
    'http://mio-nas.local/',
    'http://localhost:3000/',
  ]) SB.analyze(url, {}, () => {});
  await attendi(60);
  assert.deepEqual(giudizi, [], 'nessun giudizio del modello per la rete di casa');
  assert.deepEqual(finestre, [], 'nessuna finestra nascosta sulla rete di casa');
});

test('riconoscere un indirizzo della rete di casa: casi limite', () => {
  const privati = ['127.0.0.1', '10.255.255.254', '192.168.0.1', '172.16.0.1', '172.31.255.255',
    '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', 'nas.local', 'stampante.lan'];
  const pubblici = ['93.184.216.34', '172.32.0.1', '172.15.0.1', '100.63.0.1', '8.8.8.8',
    '2001:db8::1', 'esempio.it', 'localhost.esempio.it', 'pages.dev'];
  for (const h of privati) assert.equal(engine.isHostPrivato(h), true, `${h} è della rete di casa`);
  for (const h of pubblici) assert.equal(engine.isHostPrivato(h), false, `${h} NON è della rete di casa`);
});

// ─── Il conto è di CHI POSSIEDE il sito (#591, terzo giro) ───────────────────
//
// Il freno restava sul dominio registrabile, e su una piattaforma di hosting
// quello è la piattaforma: quattro sotto-indirizzi di chi attacca esaurivano il
// conto e da lì in poi, per un'ora, nessun altro sito ospitato lì riceveva né
// il giudizio del modello né la finestra nascosta. Compreso quello di truffa:
// è la stessa strada del giro prima, allargata da un vicino a quattro.
//
// Il conto è passato al proprietario del sito. Accanto c'è un tetto
// complessivo, che copre le piattaforme che l'elenco non conosce ancora:
// senza, dare a ogni sotto-indirizzo il suo conto rimetterebbe in piedi la
// spruzzata di sottodomini.

test('chi possiede il sito: su una piattaforma di hosting ogni sotto-indirizzo è suo', () => {
  assert.equal(SB.proprietario('paypa1-accedi.pages.dev'), 'paypa1-accedi.pages.dev');
  assert.equal(SB.proprietario('portfolio-di-marco.pages.dev'), 'portfolio-di-marco.pages.dev');
  assert.equal(SB.proprietario('www.tizio.github.io'), 'tizio.github.io');
  // Su un dominio normale resta il dominio: la spruzzata di sottodomini non
  // deve diventare una spruzzata di proprietari.
  assert.equal(SB.proprietario('n42.paypa1-accedi.truffa-esempio.com'), 'truffa-esempio.com');
  assert.equal(SB.proprietario('truffa-esempio.com'), 'truffa-esempio.com');
});

test('i siti-esca di un vicino non spengono il controllo di una truffa', async () => {
  pulisci();
  const profonde = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async (meta) => { profonde.push('giudizio:' + meta.host); return { suspicious: false }; },
    sandbox: async (url) => { profonde.push('finestra:' + url); return { verdict: 'clean' }; },
  });
  // Chi attacca si prende sotto-indirizzi gratuiti sulla stessa piattaforma e
  // li fa visitare: bastano quattro navigazioni di seguito.
  for (let i = 1; i <= SB.DEEP_MAX_PER_OWNER; i++) {
    SB.analyze(`http://accesso-sicuro-${i}.pages.dev/login`, DA_EMAIL, () => {});
    await attendi(5);
  }
  profonde.length = 0;
  // La truffa vera, su un altro sotto-indirizzo della stessa piattaforma.
  SB.analyze('http://paypa1-verifica-conto.pages.dev/login', DA_EMAIL, () => {});
  await attendi(20);
  assert.notDeepEqual(profonde, [], 'il conto dei vicini non è il suo: il controllo deve partire');
});

test('il conto comune strozza comunque una spruzzata su tanti proprietari', async () => {
  pulisci();
  let giudizi = 0;
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => { giudizi++; return { suspicious: false }; },
    sandbox: null,
  });
  // Piattaforma di hosting: ogni sotto-indirizzo è un proprietario diverso,
  // quindi il conto per proprietario non lo ferma. Lo strozza il conto comune,
  // che nella sua finestra di pochi secondi ne lascia passare DEEP_MAX_RAFFICA.
  for (let i = 0; i < SB.DEEP_MAX_RAFFICA + 40; i++) {
    SB.analyze(`http://paypa1-accedi-${i}.pages.dev/login`, DA_EMAIL, () => {});
    await attendi(1);
  }
  assert.ok(giudizi <= SB.DEEP_MAX_RAFFICA,
    `una spruzzata non deve fare un giudizio per indirizzo: ne ho contati ${giudizi}`);
  assert.ok(giudizi >= SB.DEEP_MAX_PER_OWNER,
    'il conto comune deve essere largo, non spegnere tutto al primo giro');
});

// #591, quarto giro. Il conto comune era un fondo da sessanta: chi lo spendeva
// lo spendeva per tutti, e il sito di truffa che arrivava dopo restava senza
// controllo per mezz'ora. Adesso è una raffica che si riapre in pochi secondi,
// e la verifica rinunciata per colpa di quel conto viene RIMANDATA, non persa:
// la pagina su cui l'utente è rimasto riceve il suo controllo poco dopo.
test('dopo una raffica il sito di un altro riceve comunque il suo controllo', async () => {
  pulisci();
  const profonde = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async (meta) => { profonde.push('giudizio:' + meta.host); return { suspicious: false }; },
    sandbox: null,
  });
  // La pagina ostile si porta da sola su un indirizzo dopo l'altro: la scheda
  // le lascia tutte, quindi nessuna di loro torna in fila.
  for (let i = 0; i < SB.DEEP_MAX_RAFFICA + 20; i++) {
    SB.analyze(`http://accesso-sicuro-${i}.pages.dev/login`, DA_EMAIL, () => {});
    await attendi(1);
  }
  // La truffa vera, su un dominio che con le esche non c'entra niente, ed è
  // dove l'utente resta.
  profonde.length = 0;
  const truffa = 'http://paypa1-verifica-conto.esempio-591-raffica.tk/login';
  const tm = schedaSu(truffa);
  tm.safebrowseGet(1, truffa, { hasPassword: true });
  await attendi(SB.RAFFICA_MS + 900);
  assert.notDeepEqual(profonde, [],
    'il conto speso da chi attacca non è quello della truffa: il controllo deve arrivare');
});

test('la pagina che l\'utente ha lasciato non fa tornare in fila la sua verifica', async () => {
  pulisci();
  const profonde = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async (meta) => { profonde.push('giudizio:' + meta.host); return { suspicious: false }; },
    sandbox: null,
  });
  for (let i = 0; i < SB.DEEP_MAX_RAFFICA + 5; i++) {
    SB.analyze(`http://accesso-sicuro-b${i}.pages.dev/login`, DA_EMAIL, () => {});
    await attendi(1);
  }
  const lasciata = 'http://paypa1-esca.esempio-591-lasciata.tk/login';
  // La scheda è già altrove quando la verifica rimandata scade.
  const tm = schedaSu('https://altro-sito-qualunque.it/');
  tm.safebrowseGet(1, lasciata, { hasPassword: true });
  profonde.length = 0;
  await attendi(SB.RAFFICA_MS + 900);
  assert.deepEqual(profonde.filter((p) => p.includes('esempio-591-lasciata')), [],
    'una pagina che la scheda ha lasciato non deve rubare il posto a quella dove l\'utente è');
});

// #591, ottavo giro — la domanda all'elenco dei siti di truffa è su UN
// indirizzo, quindi la risposta non può valere per tutto il sito: sui servizi
// dove i file sono di persone diverse faceva due danni opposti.
test('la risposta dell\'elenco dei siti di truffa è dell\'indirizzo, non di tutto il sito', async () => {
  const PULITO = 'https://drive.condiviso.com/file/relazione';
  const ELENCATO = 'https://drive.condiviso.com/file/accesso-paypal-verifica';
  const gsb = async (u) => (u === ELENCATO
    ? { listed: true, category: 'phishing', threatType: 'SOCIAL_ENGINEERING' }
    : { listed: false });

  pulisci();
  const chieste = [];
  SB.setProviders({ gsb: async (u) => { chieste.push(u); return gsb(u); }, rdap: null, ct: null, llm: null, sandbox: null });
  SB.analyze(PULITO, {}, () => {});
  await attendi(20);
  SB.analyze(ELENCATO, {}, () => {});
  await attendi(20);
  assert.equal(chieste.includes(ELENCATO), true, 'il file di truffa va chiesto: la risposta di un altro file non è la sua');
  assert.equal(SB.checkSync(ELENCATO, {}).level, 'pericoloso');

  pulisci();
  SB.setProviders({ gsb, rdap: null, ct: null, llm: null, sandbox: null });
  SB.analyze(ELENCATO, {}, () => {});
  await attendi(20);
  SB.analyze(PULITO, {}, () => {});
  await attendi(20);
  assert.notEqual(SB.checkSync(PULITO, {}).level, 'pericoloso',
    'il file di un\'altra persona, sullo stesso sito, non si prende la pagina rossa dell\'altro');
});

// #591, ottavo giro — la scheda rimasta sulla pagina la riottiene: il conto
// della catena lo può aver svuotato la pagina ostile che ti ha portato qui.
test('la scheda rimasta sulla truffa ottiene il controllo anche a catena svuotata', async () => {
  pulisci();
  const profonde = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async (meta) => { profonde.push(meta.host); return { suspicious: false }; },
    sandbox: null,
  });
  const truffa = 'http://paypa1-verifica.esempio-591-catena.tk/login';
  const tm = schedaSu(truffa);
  // La pagina ostile si porta da sola su indirizzi suoi, dentro questa scheda.
  for (let i = 0; i < SB.DEEP_MAX_PER_CATENA + 1; i++) {
    tm.safebrowseGet(1, `http://paypa1-esca-${i}.pages.dev/login`, { hasPassword: true });
    await attendi(5);
  }
  profonde.length = 0;
  tm.safebrowseGet(1, truffa, { hasPassword: true });
  await attendi(30);
  assert.deepEqual(profonde, [], 'a catena vuota la verifica non parte subito');
  await attendi(6200);
  assert.notDeepEqual(profonde, [],
    'la scheda è rimasta qui: il controllo della truffa non si perde per una raffica altrui');
});

// #591, nono giro — i segnali che solo la pagina conosce (il campo password, il
// campo della carta) arrivano DOPO la navigazione, e su una pagina di accesso
// mai vista sono l'unico motivo per cui si chiede al modello. Il rinvio lo
// programma il cammino della navigazione, che di quei segnali non sa niente:
// senza la correzione l'insistenza ripresentava la pagina com'era prima che
// esistesse, quindi il controllo non partiva e l'avviso già mostrato veniva
// cancellato da un verdetto più povero.
function schedaCheAscolta(dove) {
  const detti = [];
  class FintoTabManager {
    constructor() {
      this.tabs = [{
        id: 1,
        view: { webContents: { getURL: () => dove.url, send: (_c, m) => detti.push(m.level) } },
      }];
    }
  }
  installSafebrowse(FintoTabManager);
  const tm = new FintoTabManager();
  return { tm, detti, tab: tm.tabs[0] };
}

async function rafficaOstile(tm, tab) {
  for (let i = 0; i < SB.LOOKUP_MAX_PER_CATENA + 1; i++) {
    const u = `http://paypa1-esca-g9-${i}.pages.dev/login`;
    tm._sbOnNavigate(tab, u);
    tm.safebrowseGet(1, u, { hasPassword: true });
    await attendi(5);
  }
}

test('l\'insistenza porta con sé i segnali che la pagina ha mandato dopo', async () => {
  pulisci();
  const profonde = [];
  SB.setProviders({
    gsb: async () => ({ listed: false }), rdap: null, ct: null,
    llm: async (meta) => { profonde.push(meta.host); return { suspicious: false }; },
    sandbox: null,
  });
  const truffa = 'https://accesso-clienti.banca-g9-nono.tk/login';
  const dove = { url: '' };
  const { tm, tab } = schedaCheAscolta(dove);
  await rafficaOstile(tm, tab);
  profonde.length = 0;

  dove.url = truffa;
  tm._sbOnNavigate(tab, truffa);              // la scheda chiede per prima, e non sa niente della pagina
  tm.safebrowseGet(1, truffa, { hasPassword: true }); // la pagina manda i suoi segnali un istante dopo
  await attendi(30);
  assert.deepEqual(profonde, [], 'a catena vuota la verifica non parte subito');
  await attendi(6200);
  assert.notDeepEqual(profonde, [],
    'il campo password è l\'unico motivo per chiedere al modello: il rinvio deve portarselo dietro');
});

test('l\'insistenza non ritira l\'avviso già mostrato', async () => {
  pulisci();
  SB.setProviders({ gsb: async () => ({ listed: false }), rdap: null, ct: null, llm: null, sandbox: null });
  const truffa = 'http://banca-g9-nono.verifica-g9.tk/login'; // in chiaro: col campo password vale «sospetto»
  const dove = { url: '' };
  const { tm, tab, detti } = schedaCheAscolta(dove);
  await rafficaOstile(tm, tab);

  dove.url = truffa;
  tm._sbOnNavigate(tab, truffa);
  const risposta = tm.safebrowseGet(1, truffa, { hasPassword: true });
  assert.equal(risposta.level, 'sospetto', 'col campo password la pagina è sospetta');
  detti.length = 0;
  await attendi(6200);
  assert.equal(detti.includes('safe'), false,
    'chi insiste non può annunciare «sicuro» su una pagina che ha già fatto comparire l\'avviso');
});

test('l\'esito della finestra nascosta è dell\'indirizzo, non di tutto il sito', async () => {
  const PULITO = 'http://condiviso-g9.esempio-g9-nono.tk/file/relazione';
  const TRUFFA = 'http://condiviso-g9.esempio-g9-nono.tk/file/accesso-clienti';

  pulisci();
  const aperte = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null, llm: null,
    sandbox: async (u) => { aperte.push(u); return { verdict: 'clean' }; },
  });
  SB.analyze(PULITO, { hasPassword: true }, () => {});
  await attendi(20);
  SB.analyze(TRUFFA, { hasPassword: true }, () => {});
  await attendi(20);
  assert.equal(aperte.includes(TRUFFA), true,
    'la finestra nascosta apre l\'indirizzo intero e ne segue i salti: l\'esito di un altro file non è il suo');

  pulisci();
  SB.setProviders({
    gsb: null, rdap: null, ct: null, llm: null,
    sandbox: async (u) => ({ verdict: u === TRUFFA ? 'dangerous' : 'clean' }),
  });
  SB.analyze(TRUFFA, { hasPassword: true }, () => {});
  await attendi(20);
  assert.notEqual(SB.checkSync(PULITO, { hasPassword: true }).level, 'pericoloso',
    'il file di un\'altra persona, sullo stesso sito, non si prende la pagina rossa dell\'altro');
});
