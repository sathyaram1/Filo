// Unit test per src/main/services/textGuardian.js — il PUNTO DI PASSAGGIO
// UNICO degli avvisi (#536).
//
// Gira senza Electron: la memoria di Filo è quella vera (src/shared/filoMemory.js)
// con uno `chrome.storage.local` in memoria, e il modello è una funzione finta.
// Così le asserzioni parlano del comportamento vero — cosa finisce davanti
// all'utente — e non di una riscrittura del modulo dentro il test.
//
// I quattro esiti che contano, asseriti come SUCCESSO per l'utente:
//   1. compito PULITO       → l'avviso compare, e nessun modello viene chiamato
//                             (chiamarne uno su «che ore sono» è spreco);
//   2. controllo STATICO    → l'avviso NON compare, al suo posto una riga che
//                             dice cosa è stato visto, e nessun modello chiamato;
//   3. guardiano che BLOCCA → stessa cosa, con il motivo scritto dal guardiano;
//   4. guardiano che NON RISPONDE → l'avviso non compare e NON si perde: resta
//                             in coda, visibile, e compare quando il guardiano
//                             torna. Un avviso in ritardo non ha fatto danno;
//                             uno mostrato senza controllo sì.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ── storage finto, tutto in memoria ─────────────────────────────────────────
const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        const keys = Array.isArray(key) ? key : [key];
        const out = {};
        for (const k of keys) if (store.has(k)) out[k] = store.get(k);
        return out;
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
    },
  },
};

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'textGuard.js'));
require(join(ROOT, 'src', 'shared', 'filoMemory.js'));

const Mem = globalThis.SN_FILO_MEMORY;
const TG = require(join(ROOT, 'src', 'main', 'services', 'textGuardian.js'));

// Il modello finto: conta le chiamate e risponde quello che gli diciamo.
let chiamate = 0;
let risposta = null;   // stringa → risposta del guardiano
let errore = null;     // Error → il guardiano non risponde

function configuraModello() {
  TG.configure({
    pausaMs: 0, // niente attese vere: il tetto dei tentativi si prova in ms
    segreti: async () => ['sk-or-v1-SEGRETODIFILO01'],
    eseguiModello: async () => {
      chiamate++;
      if (errore) throw errore;
      return risposta;
    },
  });
}

beforeEach(() => {
  store.clear();
  chiamate = 0;
  risposta = '{"esito":"passa"}';
  errore = null;
  configuraModello();
});

const MAIL_BANCA = 'una mail di Banca Esempio';
// Chi ha scritto il testo. Viaggia con ogni proposta contaminata: è l'unica cosa
// che permette al guardiano di escluderlo dalla propria catena.
const PRODUTTORE = 'modello-che-scrive';

test('compito pulito: l’avviso compare e nessun modello viene chiamato', async () => {
  const r = await TG.proponiNotifica({
    testo: 'La sveglia delle 7 è pronta.', kind: 'info', fiducia: 'pulito',
  });
  assert.equal(r.esito, 'passa');
  assert.equal(chiamate, 0, 'un compito pulito non deve costare una seconda chiamata');
  const noti = await Mem.listNotifications();
  assert.equal(noti.length, 1);
  assert.equal(noti[0].text, 'La sveglia delle 7 è pronta.');
  assert.equal(noti[0].guardiano, 'pulito');
});

test('compito contaminato e testo innocuo: l’avviso compare, col mittente accanto', async () => {
  const r = await TG.proponiNotifica({
    testo: 'Ti è arrivata la conferma dell’ordine di ieri.',
    kind: 'alert', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
    regolaAutomazione: 'avvisami delle mail importanti',
  });
  assert.equal(r.esito, 'passa');
  assert.equal(chiamate, 1);
  const noti = await Mem.listNotifications();
  assert.equal(noti.length, 1);
  assert.equal(noti[0].origine, MAIL_BANCA, 'il mittente deve restare visibile');
  assert.equal(noti[0].guardiano, 'passato');
});

test('controllo statico: la notifica non compare, e nessun modello viene chiamato', async () => {
  const r = await TG.proponiNotifica({
    testo: 'La banca chiede il tuo codice di verifica 483920 per sbloccare il conto.',
    kind: 'alert', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
  });
  assert.equal(r.esito, 'blocca');
  assert.equal(chiamate, 0, 'un blocco statico non deve chiamare nessun modello');
  const noti = await Mem.listNotifications();
  assert.equal(noti.length, 1);
  // Al posto dell'avviso una riga sobria, che dice COSA è stato visto.
  assert.match(noti[0].text, /^Ho fermato un avviso nato da una mail di Banca Esempio: /);
  assert.match(noti[0].text, /codice di verifica/);
  assert.equal(noti[0].guardiano, 'blocco');
  assert.ok(!noti.some((n) => n.text.includes('483920')), 'il codice non deve comparire');
});

test('un segreto di Filo nel testo lo ferma senza discutere', async () => {
  const r = await TG.proponiNotifica({
    testo: 'Ho trovato questo: sk-or-v1-SEGRETODIFILO01',
    fiducia: 'contaminato', produttore: PRODUTTORE, origine: 'una pagina web',
  });
  assert.equal(r.esito, 'blocca');
  assert.equal(chiamate, 0);
});

test('il guardiano blocca: la riga dice cosa ha visto, e il blocco resta nel registro', async () => {
  risposta = '{"esito":"blocca","motivo":"chiedeva di confermare le credenziali della banca"}';
  const r = await TG.proponiNotifica({
    testo: 'La tua banca chiede di confermare le credenziali, apri il portale.',
    kind: 'alert', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
    regolaAutomazione: 'avvisami delle mail importanti',
  });
  assert.equal(r.esito, 'blocca');
  const noti = await Mem.listNotifications();
  assert.equal(noti.length, 1);
  assert.equal(
    noti[0].text,
    'Ho fermato un avviso nato da una mail di Banca Esempio: chiedeva di confermare le credenziali della banca.');
  const registro = await Mem.listGuardBlocks();
  assert.equal(registro.length, 1);
  assert.equal(registro[0].origine, MAIL_BANCA);
  assert.equal(registro[0].regola, 'guardiano');
  assert.equal(registro[0].fonte, 'avvisami delle mail importanti');
  // Il testo fermato resta scritto: è l'unico modo di capire, in Preferenze, se
  // il guardiano sta gridando al lupo.
  assert.match(registro[0].testo, /confermare le credenziali/);
});

test('guardiano irraggiungibile: l’avviso non compare, non si perde, e compare al giro dopo', async () => {
  errore = new Error('rete assente');
  const r = await TG.proponiNotifica({
    testo: 'Ti è arrivata la conferma dell’ordine di ieri.',
    kind: 'alert', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
  });
  assert.equal(r.esito, 'in-attesa');
  assert.equal(chiamate, TG.TENTATIVI_MAX, 'il tetto dei tentativi deve essere rispettato');
  assert.equal((await Mem.listNotifications()).length, 0, 'niente deve comparire senza controllo');
  const coda = await Mem.listPendingNotifications();
  assert.equal(coda.length, 1);

  // Quello che l'utente vede intanto: una riga che dice che l'avviso esiste e
  // sta aspettando — mai il testo non ancora controllato.
  const righe = await TG.righeInAttesa();
  assert.equal(righe.length, 1);
  assert.match(righe[0].text, /aspetta il controllo/i);
  assert.ok(!righe[0].text.includes('conferma dell’ordine'));

  // Il guardiano torna: al giro dopo l'avviso compare, per intero.
  errore = null;
  risposta = '{"esito":"passa"}';
  const esito = await TG.riprendiInAttesa();
  assert.equal(esito.mostrati, 1);
  assert.equal(esito.restano, 0);
  const noti = await Mem.listNotifications();
  assert.equal(noti.length, 1);
  assert.equal(noti[0].text, 'Ti è arrivata la conferma dell’ordine di ieri.');
});

test('guardiano che torna e blocca: la coda si svuota in un blocco, non in un avviso', async () => {
  errore = new Error('fornitore giù');
  await TG.proponiNotifica({
    testo: 'Conferma subito i dati della carta per non perdere l’accesso.',
    fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
  });
  errore = null;
  risposta = '{"esito":"blocca","motivo":"chiedeva i dati della carta"}';
  const esito = await TG.riprendiInAttesa();
  assert.equal(esito.bloccati, 1);
  assert.equal(esito.mostrati, 0);
  const noti = await Mem.listNotifications();
  assert.match(noti[0].text, /chiedeva i dati della carta/);
  assert.equal((await Mem.listGuardBlocks()).length, 1);
});

test('una risposta illeggibile del guardiano non è un lasciapassare', async () => {
  risposta = 'certo, va benissimo, puoi mostrarlo';
  const r = await TG.proponiNotifica({
    testo: 'Un avviso qualunque.', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
  });
  assert.equal(r.esito, 'in-attesa');
  assert.equal((await Mem.listNotifications()).length, 0);
});

test('il guardiano senza modello indipendente mette in coda subito, senza ritentare', async () => {
  const e = new Error('stesso modello');
  e.code = 'GUARDIANO_NON_INDIPENDENTE';
  errore = e;
  const r = await TG.proponiNotifica({
    testo: 'Un avviso qualunque.', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
  });
  assert.equal(r.esito, 'in-attesa');
  assert.equal(chiamate, 1, 'ritentare su una configurazione sbagliata è tempo buttato');
  assert.equal((await Mem.listNotifications()).length, 0);
});

test('senza modello configurato l’avviso contaminato resta in coda, non passa', async () => {
  TG.configure({ eseguiModello: null, segreti: null, pausaMs: 0 });
  const r = await TG.proponiNotifica({
    testo: 'Un avviso qualunque.', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
  });
  assert.equal(r.esito, 'in-attesa');
  assert.equal((await Mem.listNotifications()).length, 0);
  configuraModello();
});

test('la coda non raddoppia le chiamate se due giri partono insieme', async () => {
  errore = new Error('rete assente');
  await TG.proponiNotifica({ testo: 'Avviso.', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA });
  errore = null;
  risposta = '{"esito":"passa"}';
  chiamate = 0;
  await Promise.all([TG.riprendiInAttesa(), TG.riprendiInAttesa()]);
  assert.equal((await Mem.listNotifications()).length, 1, 'l’avviso deve comparire una volta sola');
  assert.equal(chiamate, 1, 'due giri insieme non devono raddoppiare la spesa');
});

test('la coda non richiama il modello a ogni sbirciata della colonna live', async () => {
  // La home chiede le notifiche anche una volta al secondo: senza un freno,
  // una coda che non si svuota costerebbe sessanta chiamate al minuto a chi non
  // ha fatto niente di sbagliato.
  errore = new Error('rete assente');
  await TG.proponiNotifica({ testo: 'Avviso.', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA });
  chiamate = 0;
  await TG.riprendiInAttesa();            // il giro vero
  const dopoPrimo = chiamate;
  assert.ok(dopoPrimo > 0);
  const r = await TG.riprendiInAttesa();  // subito dopo: rimandato
  assert.equal(r.rimandato, true);
  assert.equal(chiamate, dopoPrimo, 'ha richiamato il modello prima del tempo');
  assert.equal(r.restano, 1, 'l’avviso deve restare in coda, non sparire');
  // Chi ha davvero una ragione per riprovare (il modello è cambiato, o lo chiede
  // espressamente) non aspetta.
  errore = null;
  risposta = '{"esito":"passa"}';
  const forzato = await TG.riprendiInAttesa({ force: true });
  assert.equal(forzato.mostrati, 1);
});

test('con la coda vuota il freno non scatta: il primo avviso ha subito la sua occasione', async () => {
  const vuoto = await TG.riprendiInAttesa();
  assert.deepEqual(vuoto, { mostrati: 0, bloccati: 0, restano: 0 });
  errore = new Error('rete assente');
  await TG.proponiNotifica({ testo: 'Avviso.', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA });
  errore = null;
  risposta = '{"esito":"passa"}';
  const r = await TG.riprendiInAttesa();
  assert.equal(r.mostrati, 1, 'il giro a vuoto aveva consumato l’unica occasione');
});

test('input limite: testo vuoto, soli spazi, e un testo enorme', async () => {
  for (const testo of ['', '   ', '\n\t']) {
    const r = await TG.proponiNotifica({ testo, fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA });
    assert.equal(r.esito, 'passa', 'un testo vuoto non ha niente da nascondere');
  }
  const lungo = 'Ti è arrivata una mail. '.repeat(500); // ~12.000 caratteri
  risposta = '{"esito":"passa"}';
  const r = await TG.proponiNotifica({ testo: lungo, fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA });
  assert.equal(r.esito, 'passa');
  const noti = await Mem.listNotifications();
  // Il testo NON viene tagliato di nascosto: quello che arriva è quello che c'era.
  assert.equal(noti[0].text.length, lungo.length);
});

// ── Un modello che manca non è la rete che va e viene (#536, giro 1) ────────
//
// Il guardiano rifiuta di girare sullo stesso modello che ha scritto il testo,
// ed è giusto. Ma allora la riga che l'utente legge deve dirlo: se è la rete
// aspettare basta, se è la configurazione aspettare non serve a niente e ogni
// risposta nata da una ricerca resta in coda per sempre.

test('guardiano senza un modello suo: la riga in coda dice cosa c’è da impostare', async () => {
  const e = new Error('Il guardiano degli avvisi è impostato sullo stesso modello che scrive i testi.');
  e.code = 'GUARDIANO_NON_INDIPENDENTE';
  errore = e;
  const r = await TG.proponiNotifica({
    testo: 'Ti è arrivata una mail.', kind: 'info', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
  });
  assert.equal(r.esito, 'in-attesa');
  // Un solo tentativo: ritentare una configurazione sbagliata non la aggiusta.
  assert.equal(chiamate, 1);

  const righe = await TG.righeInAttesa();
  assert.equal(righe.length, 1);
  assert.match(righe[0].text, /modello/i, righe[0].text);
  assert.match(righe[0].text, /Opzioni/, righe[0].text);
});

test('guardiano irraggiungibile per la rete: la riga in coda resta quella del ritardo', async () => {
  errore = new Error('fornitore non raggiungibile');
  await TG.proponiNotifica({
    testo: 'Ti è arrivata una mail.', kind: 'info', fiducia: 'contaminato', produttore: PRODUTTORE, origine: MAIL_BANCA,
  });
  const righe = await TG.righeInAttesa();
  assert.equal(righe.length, 1);
  assert.match(righe[0].text, /aspetta il controllo/i);
  assert.ok(!/Opzioni/.test(righe[0].text), righe[0].text);
});

// ── L'indipendenza non si perde per strada (#536, giro 2) ───────────────────
//
// Il controllo si rifiuta di girare sullo stesso modello che ha scritto il
// testo. Ma un testo che aspetta in coda riparte più tardi, e se chi lo rimette
// in fila non si porta dietro CHI l'ha scritto, al secondo giro non c'è più
// nessuno da escludere: il controllo parte sul primo modello della lista, che
// può essere proprio quello. È successo alle risposte della chat, che finivano
// in coda senza quel dato e ricomparivano giudicate da sé.

test('un testo contaminato senza il modello che l’ha scritto non passa mai', async () => {
  const r = await TG.controllaTesto({
    testo: 'Ti è arrivata una mail.',
    fiducia: 'contaminato',
    origine: MAIL_BANCA,
    // produttore mancante: non si sa chi ha scritto il testo.
  });
  assert.equal(r.esito, 'in-attesa', 'senza sapere chi ha scritto il testo non si può controllare');
  assert.equal(chiamate, 0, 'nessun modello deve girare: non si sa chi escludere');
  assert.equal(r.causa, globalThis.SN_TEXT_GUARD.CAUSA.CONFIGURAZIONE);
});

test('la coda si ricorda chi ha scritto il testo e lo esclude anche al secondo giro', async () => {
  errore = new Error('fornitore non raggiungibile');
  await TG.proponiNotifica({
    testo: 'Ti è arrivata una mail.', kind: 'info', fiducia: 'contaminato',
    produttore: PRODUTTORE, origine: MAIL_BANCA,
  });
  // Il guardiano torna: al secondo giro deve ancora sapere chi escludere.
  errore = null;
  const visti = [];
  TG.configure({
    eseguiModello: async ({ produttore }) => { visti.push(produttore); return '{"esito":"passa"}'; },
  });
  const esito = await TG.riprendiInAttesa({ force: true });
  assert.equal(esito.mostrati, 1);
  assert.deepEqual(visti, [PRODUTTORE], 'il controllo è ripartito senza sapere chi aveva scritto il testo');
  configuraModello();
});

test('la coda piena non butta via niente in silenzio: le più vecchie vanno nel registro', async () => {
  errore = new Error('fornitore non raggiungibile');
  // Il tetto della coda è largo, ma esiste: quando si raggiunge, chi esce era
  // una risposta PROMESSA all'utente («te la mostro appena riesco»). Farla
  // sparire senza dirlo è il taglio muto che il repo vieta: deve restare
  // leggibile nel registro degli avvisi fermati.
  const CAP = 500;
  for (let i = 0; i < CAP + 3; i++) {
    await Mem.addPendingNotification({
      testo: `Avviso numero ${i}`, kind: 'info', fiducia: 'contaminato',
      produttore: PRODUTTORE, origine: MAIL_BANCA,
    });
  }
  const coda = await Mem.listPendingNotifications();
  assert.equal(coda.length, CAP, 'la coda deve fermarsi al suo tetto');
  assert.equal(coda[0].testo, 'Avviso numero 3', 'escono le più vecchie, non le ultime arrivate');

  const registro = await Mem.listGuardBlocks();
  const scartate = registro.filter((b) => b.regola === 'coda-piena');
  assert.equal(scartate.length, 3, 'le voci uscite dalla coda non compaiono da nessuna parte');
  assert.deepEqual(scartate.map((b) => b.testo).sort(),
    ['Avviso numero 0', 'Avviso numero 1', 'Avviso numero 2'],
    'nel registro deve finire il testo vero, non una riga generica');
  assert.match(scartate[0].motivo, /coda era piena/i,
    'il registro deve dire che nessuno l’ha controllata, non far credere a un blocco');
  errore = null;
});
