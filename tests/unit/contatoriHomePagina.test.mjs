// I contatori della home e degli automatismi sulla pagina (#1473): elenchi chiusi copiati dal codice, il documento che
// esce, quello che resta aperto in una pagina (i «risali» di fila, il sito non trovato), le proposte con la loro risposta
// e l'intervista rifatta, col servizio vero su disco, orologio e rete finti. Un testo, un sito o un paese non escono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'messages', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi',
  'contatoriGiornalieri', 'contatoriHomePagina']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const Misure = require(join(ROOT, 'src', 'main', 'services', 'contatoriHomePagina.js'));
const { geoBlockMethods } = require(join(ROOT, 'src', 'main', 'tabs', 'tabGeoBlock.js'));
const C = globalThis.SN_CONTATORI;
const H = globalThis.SN_CONTATORI_HOME_PAGINA;
const O = globalThis.SN_ONBOARDING;

const leggi = (f) => readFileSync(join(ROOT, f), 'utf8');
const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';
const MIN = 60 * 1000;
const ORA = 60 * MIN;
const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime();
const attendi = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

const SITO = 'banca-falsa.example';
const SCRITTO = 'ricetta della nonna segreta';
const PAESE = 'jp';

function daFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, daFs(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(daFs);
  throw new Error(`tipo inatteso ${JSON.stringify(v)}`);
}

function banco({ risposta = 200 } = {}) {
  const disco = new Map();
  const per = {};
  const b = { t: T0, accesi: true, incognito: false, risposta, disco, per, n: 0 };
  b.s = Servizio.crea({
    contatori: C,
    contatoriHomePagina: H,
    storage: {
      getRaw: async (k, d) => (disco.has(k) ? JSON.parse(JSON.stringify(disco.get(k))) : d),
      setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
    },
    impostazioni: async () => ({ contatori: { attivi: b.accesi } }),
    inIncognito: () => b.incognito,
    runNormale: (fn) => fn(),
    finestraNormale: () => true,
    adesso: () => b.t,
    versione: () => '0.2.300',
    piattaforma: 'linux',
    esclusi: async () => [],
    casuale: () => `${'7'.repeat(18)}${String(++b.n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }),
    fetch: async (url, opt) => {
      const coll = /documents\/([a-z-]+)\?/.exec(url)[1];
      const doc = Object.fromEntries(Object.entries(JSON.parse(opt.body).fields).map(([k, v]) => [k, daFs(v)]));
      (per[coll] || (per[coll] = [])).push({ url, doc, body: opt.body });
      const st = typeof b.risposta === 'function' ? b.risposta(coll, doc) : b.risposta;
      return { ok: st >= 200 && st < 300, status: st, json: async () => ({}) };
    },
    log: () => {},
  });
  b.m = Misure.crea({ contatori: b.s });
  globalThis.SN_CONTATORI_HOME_PAGINA_MAIN = b.m;
  return b;
}
const dellOra = async (b) => {
  await attendi();
  const s = await b.s.letto();
  return (s.ore[C.oraDi(b.t)] || {}).homePagina || {};
};
const spedisci = async (b) => {
  await attendi();
  b.t += ORA;
  return b.s.controlla();
};

// ── Gli elenchi sono copie del codice ──────────────────────────────────────

test('i comandi sono quelli di SLASH_COMMANDS tranne /incognito, e ognuno è contato dal suo nome', () => {
  const s = leggi('src/pages/dashboard/dashboard-comandi.js');
  const corpo = /const SLASH_COMMANDS = \{([\s\S]*?)\n {2}\};/.exec(s)[1];
  const chiavi = [...corpo.matchAll(/^ {4}'(\/[^']+)':/gm)].map((m) => m[1]);
  assert.ok(chiavi.includes('/incognito') && chiavi.includes('/clear all'));
  assert.deepEqual(chiavi.filter((k) => k !== '/incognito').map(H.nomeComando).sort(), [...H.COMANDI].sort());
  assert.equal(H.chiaveComando('/incognito'), '', 'da quale strada parte una finestra in incognito non esce');
  assert.equal(H.chiaveComando('/clear all'), 'clear_all');
  assert.match(s, /if \(chiave !== '\/incognito'\) contaComando\(chiave\);/);
  for (const strada of H.STRADE) assert.ok(`${s}\n${leggi('src/pages/dashboard/dashboard.js')}`.includes(`contaComando('${strada}')`), strada);
});

test('fasce, tipi, passi, proposte e automatismi sono quelli del codice, e ognuno è contato da qualcuno', () => {
  assert.deepEqual(H.FASCE_TEMPO.map(([k]) => k), C.NOMI_FASCE, 'il tempo per aprire nelle fasce di oggi');
  assert.deepEqual(H.passi(), C.passiIntervista(), 'i passi dell’intervista come li conta la prima volta');
  const cerca = leggi('src/pages/dashboard/dashboard-cerca.js');
  const tipoDi = /function tipoDi\(r\) \{([\s\S]*?)\n {2}\}/.exec(cerca)[1];
  assert.deepEqual([...new Set([...tipoDi.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((t) => !['nascosta', 'pagina'].includes(t) || H.TIPI_RISULTATO.includes(t)))].sort(),
    [...H.TIPI_RISULTATO].sort());
  const dove = {
    apri_da_altro_paese: 'src/main/tabs/tabGeoBlock.js', email_account: 'src/main/propostaEmail.js',
    riquadro_rotto: 'src/main/services/riquadriRotti.js', resta_connesso: 'src/main/services/handlers/contatori.js',
    banner_cookie: 'src/main/tabs/tabCookies.js', zoom_ricordato: 'src/main/tabs.js', segnalazione_automatica: 'src/main/services/handlers.js',
    pubblicita_saltata: 'src/content/adSkip.js',
  };
  for (const t of [...H.TIPI_PROPOSTA, ...H.AUTOMATISMI]) assert.ok(leggi(dove[t]).includes(`'${t}'`), `nessuno conta ${t}`);
  for (const [t, f] of [['banner_cookie', 'src/main/services/handlers/contatori.js'], ['zoom_ricordato', 'src/main/tabs.js'],
    ['segnalazione_automatica', 'src/main/services/handlers/filo.js']]) {
    assert.match(leggi(f), new RegExp(`'disfatto', '${t}'|disfatto\\('${t}'`), `nessuno disfa ${t}`);
  }
});

test('la home manda solo nomi e numeri: mai le parole cercate, né quanto sono lunghe, né quello che segue un comando', () => {
  const cerca = leggi('src/pages/dashboard/dashboard-cerca.js');
  const campi = [...cerca.matchAll(/contaHome\('[a-z-]+', \{([^}]*)\}\)/g)].map((m) => m[1]).join(',');
  const nomi = [...campi.matchAll(/(\w+):/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(nomi)].sort(), ['ms', 'posizione', 'risultati', 'ripetuta', 'tipo']);
  assert.doesNotMatch(campi, /\bq\b|length|value|testo/);
  const comandi = leggi('src/pages/dashboard/dashboard-comandi.js');
  assert.match(comandi, /misura: 'comando-home', cosa, \.\.\.\(scelta \? \{ scelta \} : \{\}\)/);
  assert.doesNotMatch(comandi, /contaComando\(text|contaComando\(firstToken|contaComando\(`/);
});

// ── Le registrazioni e il documento ─────────────────────────────────────────

test('ogni misura: un testo, un sito, un paese o un nome inventato non escono in nessuna forma', async () => {
  const b = banco();
  assert.equal(b.m.comando('/set'), true);
  b.m.comando(`/set ${SCRITTO}`);
  b.m.comando('sito_diretto');
  b.m.comando(SITO);
  b.m.comando('/incognito');
  b.m.ricerca(0);
  b.m.ricerca(SCRITTO.length, { ripetuta: true });
  b.m.ricerca(SCRITTO);
  b.m.aperto('scheda_chiusa', 2, 1200);
  b.m.aperto(SITO, 1, 10);
  b.m.aperto('messaggio', 0, 10);
  b.m.risaliDiFila('1|risali|home', 3);
  b.m.fineInCorso('1|risali|home');
  b.m.intervistaRiaperta();
  b.m.intervistaFine('autonomia');
  b.m.intervistaFine(SCRITTO);
  b.m.proposta('email_account', 'accettata', { come: 'tastiera' });
  b.m.proposta('apri_da_altro_paese', 'accettata', { come: PAESE });
  b.m.proposta(SITO, 'ignorata');
  b.m.fatto('zoom_ricordato');
  b.m.fatto(SITO);
  b.m.disfatto('pubblicita_saltata');
  const d = await dellOra(b);
  assert.deepEqual(d.comando_home, { set: 2, sito_diretto: 1 }, 'il nome del comando, mai quello che lo segue');
  assert.deepEqual(d.ricerca_home, { 'risultati:r0': 1, 'risultati:oltre': 1, vuota_ripetuta: 1, 'aperto:scheda_chiusa:p2_3:s2': 1 });
  assert.deepEqual(d.risali, { n2_3: 1 });
  assert.deepEqual(d.intervista_rifatta, { riaperta: 1, 'fine:autonomia': 1 });
  assert.deepEqual(d.proposta_sulla_pagina, { 'email_account:accettata:tastiera': 1, 'apri_da_altro_paese:accettata': 1 });
  assert.deepEqual(d.automatismo_fatto, { zoom_ricordato: 1 });
  assert.deepEqual(d.automatismo_disfatto, {}, 'la pubblicità saltata non ha un ritorno');

  assert.equal(await spedisci(b), 'inviati');
  const [hp] = b.per[H.COLLEZIONE];
  assert.equal(H.valida(hp.doc).ok, true, H.valida(hp.doc).motivo);
  assert.equal(C.idDocumento(hp.doc), C.idDocumento(b.per[C.COLLEZIONE][0].doc), 'lo stesso id dell’ora');
  for (const lista of Object.values(b.per)) {
    for (const x of lista) {
      for (const ago of [SITO, SCRITTO, 'nonna', `"${PAESE}"`, `:${PAESE}`]) assert.ok(!x.body.includes(ago), `«${ago}» è uscito`);
    }
  }
});

test('in incognito e a contatori spenti non si conta niente, e un’ora senza questi conti non ha il suo documento', async () => {
  const b = banco();
  b.m.fatto('banner_cookie', { incognito: true });
  b.m.proposta('riquadro_rotto', 'rifiutata', { incognito: true });
  b.incognito = true;
  b.m.comando('/help');
  assert.equal(b.m.risaliDiFila('1|risali|home', 1), false, 'in incognito una serie non si tiene nemmeno aperta');
  b.incognito = false;
  b.accesi = false;
  b.m.ricerca(4);
  await attendi();
  b.accesi = true;
  await b.s.homePagina(() => true);
  assert.deepEqual(await dellOra(b), H.vuota());
  assert.equal(await spedisci(b), 'inviati');
  assert.equal(b.per[H.COLLEZIONE], undefined);
});

test('il documento rifiutato (regole non ancora pubblicate) tiene l’ora in attesa, e il giorno dopo parte', async () => {
  const b = banco({ risposta: (coll) => (coll === H.COLLEZIONE ? 403 : 200) });
  b.m.fatto('pubblicita_saltata');
  assert.equal(await spedisci(b), 'fallito');
  b.risposta = (coll) => (coll === C.COLLEZIONE ? 409 : 200);
  b.t += 24 * ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.per[H.COLLEZIONE].length, 2);
  assert.deepEqual(b.per[H.COLLEZIONE][1].doc.automatismo_fatto, { pubblicita_saltata: '1' });
});

// ── Quello che resta aperto in una pagina ───────────────────────────────────

test('i «risali» di fila si contano una volta, quando la serie finisce: dalla pagina, con la scheda chiusa o con Filo', async () => {
  const b = banco();
  for (let n = 1; n <= 5; n++) b.m.risaliDiFila('7|risali|home', n);
  assert.deepEqual((await dellOra(b)).risali || {}, {}, 'a serie aperta non si conta niente');
  assert.equal(b.m.fineInCorso('7|risali|home'), true);
  assert.equal(b.m.fineInCorso('7|risali|home'), false, 'una serie finita non si conta due volte');
  b.m.risaliDiFila('8|risali|home', 1);
  b.s.chiudiInCorso('8|');
  b.m.risaliDiFila('9|risali|home', 12);
  await b.s.congeda();
  assert.deepEqual((await dellOra(b)).risali, { n4_10: 1, n1: 1, oltre: 1 });
});

test('il sito che non si trova: «Apri comunque» o lasciato, una scelta per avviso, anche se la scheda si chiude', async () => {
  const b = banco();
  const k = '3|non-risolto|home';
  assert.equal(b.m.nonRisolto(k, 'apri_lo_stesso'), false, 'senza un avviso a schermo non c’è una scelta');
  b.m.nonRisolto(k, 'in_attesa');
  assert.equal(b.m.nonRisolto(k, 'apri_lo_stesso'), true);
  assert.equal(b.m.nonRisolto(k, 'apri_lo_stesso'), false, 'il bottone di un avviso già deciso non conta più');
  b.m.nonRisolto(k, 'in_attesa');
  b.m.nonRisolto(k, 'lascia');
  b.m.nonRisolto(k, 'in_attesa');
  b.m.nonRisolto(k, 'in_attesa');
  b.s.chiudiInCorso('3|');
  await attendi();
  assert.deepEqual((await dellOra(b)).comando_home, { 'sito_non_risolto:apri_lo_stesso': 1, 'sito_non_risolto:lascia': 3 });
  assert.equal(b.m.comando('sito_non_risolto'), false, 'la scelta passa solo dall’avviso');
});

// ── Le proposte ─────────────────────────────────────────────────────────────

test('una proposta ha una risposta sola; ridisegnata non raddoppia, una nuova al suo posto lascia la vecchia ignorata', async () => {
  const b = banco();
  const segno = {};
  b.m.propostaMostrata(segno, 'apri_da_altro_paese', { chiave: 'https://a.example/1' });
  b.m.propostaMostrata(segno, 'apri_da_altro_paese', { chiave: 'https://a.example/1' });
  b.m.propostaMostrata(segno, 'apri_da_altro_paese', { chiave: 'https://a.example/2' });
  b.m.propostaRisposta(segno, 'apri_da_altro_paese', 'rifiutata');
  assert.equal(b.m.propostaRisposta(segno, 'apri_da_altro_paese', 'accettata'), false, 'già risposta');
  b.m.propostaMostrata(segno, 'email_account', { incognito: true });
  b.m.proposteVia(segno);
  b.m.propostaMostrata(segno, 'email_account');
  b.m.propostaRisposta(segno, 'email_account', 'accettata', { come: 'menu' });
  assert.deepEqual((await dellOra(b)).proposta_sulla_pagina, {
    'apri_da_altro_paese:ignorata': 1, 'apri_da_altro_paese:rifiutata': 1, 'email_account:accettata:menu': 1,
  });
});

function schede() {
  const tm = Object.create(geoBlockMethods);
  const tab = { id: 4, url: `https://${SITO}/video`, view: { webContents: { send() {} } }, geoBlock: { url: `https://${SITO}/video`, host: SITO } };
  Object.assign(tm, { tabs: [tab], incognito: false, win: {}, proxy: [], setTabProxy: async (id, paese) => { tm.proxy.push(paese); return { ok: true }; } });
  return { tm, tab };
}

test('apri da un altro paese: sì, no, e la pagina che cambia senza risposta; mai il sito né il paese', async () => {
  const b = banco();
  const { tm, tab } = schede();
  tm._geoBroadcastPropose(tab, tab.url, PAESE, 'Giappone');
  await tm.geoProposeAccept(4, PAESE);
  assert.deepEqual(tm.proxy, [PAESE]);
  tm._geoBroadcastPropose(tab, tab.url, PAESE, 'Giappone');
  tm.geoProposeDismiss(4, tab.url);
  tm.geoProposeDismiss(4, tab.url);
  tm._geoBroadcastPropose(tab, tab.url, PAESE, 'Giappone');
  b.m.proposteVia(tab._proposte);
  await tm.geoProposeAccept(4, PAESE);
  assert.deepEqual((await dellOra(b)).proposta_sulla_pagina, {
    'apri_da_altro_paese:accettata': 1, 'apri_da_altro_paese:rifiutata': 1, 'apri_da_altro_paese:ignorata': 1,
  }, 'un sì senza proposta a schermo (dalla chat, dal menu) non è una risposta');
  assert.match(leggi('src/main/tabs.js'), /wc\.on\('did-navigate', \(_e, url, httpResponseCode\) => \{\n\s+const urlPrima = tab\.url;\n[^\n]*\n\s+ContatoriHomePagina\.misura\('proposteVia', tab\._proposte\);/);
  const t = leggi('src/main/tabs.js');
  assert.equal((t.match(/ContatoriHomePagina\.misura\('proposteVia', tab\._proposte\);/g) || []).length, 3, 'la pagina che cambia e le due strade che tolgono una scheda');
  assert.ok(!JSON.stringify(await b.s.letto()).includes(SITO));
});

// ── L'intervista rifatta ────────────────────────────────────────────────────

test('rifatta dalle Preferenze resta «da capo» anche ripresa o dimenticata a metà; la prima volta no', () => {
  const prima = O.close(O.emptyState());
  assert.equal(prima.daCapo, undefined);
  const rifatta = O.restart(prima, '2026-10-28T09:00:00.000Z');
  assert.equal(rifatta.daCapo, true);
  assert.equal(O.normalize(rifatta).daCapo, true);
  assert.equal(O.riprendi(O.close(rifatta)).daCapo, true);
  assert.equal(O.dimentica(rifatta).daCapo, true);
  const ripresa = O.riprendi(O.close(O.appendTurn(O.emptyState(), { role: 'filo', text: O.WELCOME_MESSAGE })));
  assert.equal(ripresa.rifatta, true);
  assert.equal(ripresa.daCapo, undefined, '«Riprendiamola» della prima volta resta la prima volta');
});

test('l’intervista rifatta lasciata a metà conta il passo dove si ferma, una volta, anche dopo un giorno di fermo', async () => {
  const b = banco();
  await b.s.intervistaToccata('autonomia', false, { daCapo: true, inizio: 'r1' });
  assert.equal(b.s.intervistaAbbandonata('autonomia', { daCapo: true }), true);
  await b.s.intervistaToccata('', true);
  // Lasciata aperta un giorno: il giro la conta ferma lì; chiusa dopo non conta di nuovo.
  await b.s.intervistaToccata('estetica', false, { daCapo: true, inizio: 'r2' });
  b.t += 25 * ORA;
  await b.s.controlla();
  await attendi();
  assert.equal(b.s.intervistaAbbandonata('estetica', { daCapo: true }), false);
  // Una rifatta nuova non eredita il «già contato» di quella di prima.
  await b.s.intervistaToccata('profilo', false, { daCapo: true, inizio: 'r3' });
  assert.equal(b.s.intervistaAbbandonata('profilo', { daCapo: true }), true);
  await attendi();
  const s = await b.s.letto();
  const somma = {};
  for (const ora of Object.values(s.ore)) {
    for (const [k, n] of Object.entries((ora.homePagina || {}).intervista_rifatta || {})) somma[k] = (somma[k] || 0) + n;
    assert.deepEqual(ora.intervista || {}, {}, 'la rifatta non entra nei contatori della prima volta');
  }
  const inviati = (b.per[H.COLLEZIONE] || []).map((x) => x.doc.intervista_rifatta);
  for (const d of inviati) for (const [k, n] of Object.entries(d)) somma[k] = (somma[k] || 0) + Number(n);
  assert.deepEqual(somma, { 'fine:autonomia': 1, 'fine:estetica': 1, 'fine:profilo': 1 });
});
