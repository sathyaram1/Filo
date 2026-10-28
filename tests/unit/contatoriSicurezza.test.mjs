// I contatori della sicurezza (#1474): elenchi chiusi copiati dal codice, il documento che esce, gli agganci (verdetto e
// scelte della scheda, controlli di rete, segreti tolti dal cancello, tetti) e la spedizione col servizio vero, su disco,
// orologio e rete finti. Un indirizzo, un segreto vero o una categoria inventata passati alle misure non escono.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi',
  'contatoriGiornalieri', 'contatoriSicurezza', 'pagineDelicate', 'guardianoStatico', 'contenutoEsterno', 'filoContesto', 'urlExfil']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'index.js'));
require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const Misure = require(join(ROOT, 'src', 'main', 'services', 'contatoriSicurezza.js'));
const SB = require(join(ROOT, 'src', 'main', 'services', 'safebrowse', 'index.js'));
const gsb = require(join(ROOT, 'src', 'main', 'services', 'safebrowse', 'gsb.js'));
const net = require(join(ROOT, 'src', 'main', 'services', 'safebrowse', 'net.js'));
const SegretiLetti = require(join(ROOT, 'src', 'main', 'services', 'segretiLetti.js'));
const Tetto = require(join(ROOT, 'src', 'main', 'services', 'tettoAutomatiche.js'));
const { installSafebrowse } = require(join(ROOT, 'src', 'main', 'tabs', 'tabSafebrowse.js'));
const C = globalThis.SN_CONTATORI;
const S = globalThis.SN_CONTATORI_SICUREZZA;
const PD = globalThis.SN_PAGINE_DELICATE;
const Exfil = globalThis.SN_URL_EXFIL;
const { ACTIONS } = globalThis.SN_CONST;

const leggi = (f) => readFileSync(join(ROOT, f), 'utf8');
const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';
const MIN = 60 * 1000;
const ORA = 60 * MIN;
const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime();
const attendi = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

// Quello che una misura non deve mai far uscire: un dominio, un segreto vero (in ogni forma) e la sua lunghezza.
const DOMINIO = 'banca-falsa.example';
const SEGRETO = 'prova-segreto-filo-7Q2w9Zx4Lm8Pk3Rt6Yv1Bn5Hc0Jd';
const CATEGORIA = 'assicurazioni_remote';
function nienteDiSegreto(json) {
  const piatto = json.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nucleo = SEGRETO.toLowerCase().replace(/[^a-z0-9]/g, '');
  assert.ok(!json.includes(DOMINIO) && !piatto.includes(DOMINIO.replace(/[^a-z0-9]/g, '')), 'il dominio è uscito');
  assert.ok(!piatto.includes(nucleo.slice(8, 28)), 'il segreto è uscito');
  assert.ok(!piatto.includes([...nucleo].reverse().join('').slice(8, 28)), 'il segreto è uscito al contrario');
  assert.ok(!json.includes(Buffer.from(SEGRETO).toString('base64').slice(0, 20)), 'il segreto è uscito in base64');
  assert.ok(!json.includes(CATEGORIA), 'la categoria remota è uscita col suo nome');
  assert.ok(!Object.values(JSON.parse(json)).some((v) => v && typeof v === 'object'
    && Object.values(v).includes(String(SEGRETO.length))), 'la lunghezza del segreto è uscita');
}

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
    contatoriSicurezza: S,
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
  globalThis.SN_CONTATORI_SICUREZZA_MAIN = b.m;
  return b;
}
const sicurezzaDellOra = async (b) => {
  await attendi();
  const s = await b.s.letto();
  return (s.ore[C.oraDi(b.t)] || {}).sicurezza || {};
};
const spedisci = async (b) => {
  await attendi();
  b.t += ORA;
  return b.s.controlla();
};

beforeEach(() => {
  for (const c of Object.values(SB._caches)) c.m.clear();
  SB.setProviders({ gsb: null, rdap: null, ct: null, llm: null, sandbox: null });
});

// ── Gli elenchi sono copie del codice ──────────────────────────────────────

test('i motivi del verdetto sono quelli del motore, con le categorie di Safe Browsing e gli stati del certificato', () => {
  const motore = leggi('src/main/services/safebrowse/engine.js');
  const segnali = leggi('src/main/services/safebrowse/signals.js');
  const lista = leggi('src/main/services/safebrowse/gsb.js');
  const tra = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
  const gravi = tra(/'([a-z]+)'/g, /const SEVERITY = \[([^\]]*)\]/.exec(lista)[1]);
  const certi = tra(/'([a-z_]+)'/g, /const CERT_BAD = new Set\(\[([^\]]*)\]\)/.exec(motore)[1]);
  assert.match(motore, /'gsb_' \+ \(gsb\.category \|\| 'listed'\)/);
  assert.match(motore, /'cert_' \+ cert\.status/);
  const dalCodice = new Set([
    ...tra(/kind: '([a-z_]+)'/g, segnali), ...tra(/\['([a-z_]+)'\]/g, motore), ...gravi.map((g) => `gsb_${g}`), 'gsb_listed',
    ...certi.map((c) => `cert_${c}`),
  ]);
  dalCodice.delete('pericoloso');
  assert.deepEqual([...dalCodice].sort(), S.MOTIVI_SITO.filter((m) => m !== S.ALTRO).sort());
  assert.deepEqual([...S.CATEGORIE_GSB].sort(), [...gravi, 'listed'].sort());
  assert.deepEqual([...S.STATI_CERT].sort(), certi.sort());
  assert.deepEqual(S.FASCE_DURATA.map(([k]) => k), C.NOMI_FASCE, 'le durate nelle stesse fasce delle attese');
});

test('scelte, categorie, lavori, tipi, regole, verbi e tetti sono quelli del codice, e ognuno è contato da qualcuno', () => {
  const scheda = leggi('src/main/tabs/tabSafebrowse.js');
  const sceltaDi = /_sbScelta\(tab, scelta, dati = \{\}\) \{([\s\S]*?)\n {2}\},/.exec(scheda)[1];
  const scelte = new Set([...sceltaDi.matchAll(/scelta === '([a-z]+)'/g)].map((m) => (m[1] === 'segnala' ? 'segnala_falso_allarme' : m[1])));
  assert.deepEqual([...scelte].sort(), [...S.SCELTE].sort());

  const pagine = leggi('src/shared/pagineDelicate.js');
  const propri = [...pagine.matchAll(/return '([a-z]+)';/g)].map((m) => m[1]);
  assert.deepEqual(S.CATEGORIE_DELICATE.filter((c) => c !== S.ALTRO).sort(), [...Object.keys(PD.PREDEFINITI), ...propri].sort());

  const custoditi = leggi('src/main/services/segretiCustoditi.js');
  const tipi = new Set([...custoditi.matchAll(/'([a-z]+)'\);/g)].map((m) => m[1]));
  const uscite = leggi('src/shared/urlExfil.js');
  const chiaviDi = (nome) => [...new RegExp(`const ${nome} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\);`).exec(uscite)[1].matchAll(/^\s*([a-z]+):/gm)].map((m) => m[1]);
  assert.deepEqual([...tipi].sort(), chiaviDi('CUSTODITI').sort());
  assert.deepEqual(S.TIPI_SEGRETO.filter((t) => t !== S.ALTRO).sort(), [...tipi].sort());
  assert.deepEqual([...S.REGOLE_LETTE].sort(), chiaviDi('LETTI').sort());
  assert.match(leggi('src/main/services/verdettiUscite.js'), /regola: 'guasto'/);
  assert.deepEqual(S.VERBI.filter((v) => v !== S.ALTRO).sort(), [...Object.keys(Exfil.USCITE), ...Object.keys(Exfil.USCITE_PAGINA)].sort());

  const automatiche = [...new Set(Object.values(Tetto.GRUPPI))].map((g) => `automatiche_${g}`);
  assert.deepEqual(S.TETTI_CODICE.filter((t) => t.startsWith('automatiche_')).sort(), automatiche.sort());
  const sorgenti = ['src/main/services/handlers/ai.js', 'src/main/services/riquadriRotti.js', 'src/main/services/geoBlockClassifier.js',
    'src/main/services/safebrowse/index.js', 'src/main/services/segretiLetti.js', 'src/shared/contatoriGiornalieri.js',
    'src/main/services/schermo.js', 'src/main/tabs.js', 'src/main/services/handlers.js'].map(leggi).join('\n');
  assert.match(sorgenti, /misura\('tetto', `automatiche_\$\{fermo\.gruppo\}`\)/);
  for (const t of S.TETTI_CODICE.filter((x) => !x.startsWith('automatiche_'))) assert.ok(sorgenti.includes(`'${t}'`), `nessuno conta il tetto ${t}`);
  for (const l of S.LAVORI) assert.ok(sorgenti.includes(`'${l}'`), `nessuno conta il lavoro ${l}`);
});

// ── Le registrazioni e il documento ─────────────────────────────────────────

test('ogni misura: un indirizzo, un segreto vero e una categoria remota inventata non escono in nessuna forma', async () => {
  const b = banco();
  const doc = { url: `https://${DOMINIO}/login` };
  b.m.verdetto(doc, {
    level: 'pericoloso', reasons: ['weak_typo', `https://${DOMINIO}/login`, SEGRETO],
    norm: { host: DOMINIO, registrable: DOMINIO }, message: { title: DOMINIO, body: SEGRETO },
  });
  assert.equal(b.m.controllo('gsb', `https://${DOMINIO}`, 1200), true, 'il controllo è dell’elenco');
  b.m.controllo('rdap', 'ok', 45000);
  b.m.controllo(DOMINIO, 'ok', 10);
  b.m.scelta('procedi', 'pericoloso', 'dopo');
  b.m.scelta(SEGRETO, 'pericoloso', 'dopo');
  b.m.paginaDelicata(CATEGORIA, 'riquadri');
  b.m.paginaDelicata(DOMINIO, 'schermo');
  b.m.paginaDelicata('banche', SEGRETO);
  b.m.segretiTolti(ACTIONS.FILO_CHAT, ['portafoglio', SEGRETO]);
  b.m.uscitaFermata({ blocca: true, regola: 'custodito', tipo: 'portafoglio', frase: `non ho aperto l'indirizzo: ${SEGRETO}` },
    { type: 'NAVIGA', url: `https://${DOMINIO}/?k=${SEGRETO}` });
  b.m.uscitaFermata({ blocca: true, regola: SEGRETO, tipo: DOMINIO }, { type: `https://${DOMINIO}` });
  b.m.tetto('geo_budget');
  b.m.tetto(DOMINIO);
  const d = await sicurezzaDellOra(b);
  assert.deepEqual(d.sito_verdetto, { pericoloso: 1, 'pericoloso:weak_typo': 1, 'pericoloso:altro': 1 });
  assert.deepEqual(d.sito_approfondito, { 'rdap:ok:oltre': 1 }, 'un esito fuori elenco non conta');
  assert.deepEqual(d.avviso_scelta, { 'procedi:pericoloso:dopo': 1 });
  assert.deepEqual(d.pagina_delicata, { 'altro:riquadri': 1, 'altro:schermo': 1 }, 'la categoria remota esce «altro»');
  assert.deepEqual(d.segreto_oscurato, { 'portafoglio:filo-chat': 1, 'altro:filo-chat': 1 });
  assert.deepEqual(d.uscita_fermata, { 'custodito:portafoglio:NAVIGA': 1, 'altro:altro': 1 });
  assert.deepEqual(d.tetto_toccato, { geo_budget: 1 });

  assert.equal(await spedisci(b), 'inviati');
  const [sic] = b.per[S.COLLEZIONE];
  assert.equal(S.valida(sic.doc).ok, true, S.valida(sic.doc).motivo);
  assert.equal(C.idDocumento(sic.doc), C.idDocumento(b.per[C.COLLEZIONE][0].doc), 'lo stesso id dell’ora');
  for (const lista of Object.values(b.per)) for (const x of lista) nienteDiSegreto(x.body);
});

test('un verdetto per pagina: l’ultimo prende il posto di quello di prima nella stessa ora, e dopo l’ora non si ripete', async () => {
  const b = banco();
  const doc = { url: 'https://negozio.example.it/' };
  b.m.verdetto(doc, { level: 'safe', reasons: ['clean'] });
  await attendi();
  b.m.verdetto(doc, { level: 'sospetto', reasons: ['young_domain', 'sensitive_input'] });
  b.m.verdetto(doc, { level: 'pericoloso', reasons: ['gsb_phishing'] });
  b.m.verdetto({ url: 'https://altro.example.it/' }, { level: 'safe', reasons: ['clean'] });
  let d = await sicurezzaDellOra(b);
  assert.deepEqual(d.sito_verdetto, { pericoloso: 1, 'pericoloso:gsb_phishing': 1, safe: 1, 'safe:clean': 1 });
  b.t += ORA;
  b.m.verdetto(doc, { level: 'safe', reasons: ['clean'] });
  d = await sicurezzaDellOra(b);
  assert.deepEqual(d.sito_verdetto || {}, {}, 'la pagina resta contata nell’ora in cui era');
});

test('in incognito e a contatori spenti non si conta niente, e un’ora senza sicurezza non ha il suo documento', async () => {
  const b = banco();
  b.m.tetto('geo_budget', { incognito: true });
  b.m.scelta('copia', 'sospetto', 'dopo', { incognito: true });
  b.incognito = true;
  b.m.segretiTolti(ACTIONS.FILO_CHAT, ['chiave']);
  b.incognito = false;
  b.accesi = false;
  b.m.paginaDelicata('posta', 'riquadri');
  await attendi();
  b.accesi = true;
  await b.s.finestra(() => true);
  assert.deepEqual(await sicurezzaDellOra(b), {});
  assert.equal(await spedisci(b), 'inviati');
  assert.equal(b.per[S.COLLEZIONE], undefined);
});

test('il documento della sicurezza rifiutato (regole non ancora pubblicate) tiene l’ora in attesa, e il giorno dopo parte', async () => {
  const b = banco({ risposta: (coll) => (coll === S.COLLEZIONE ? 403 : 200) });
  b.m.tetto('segreti_saturo');
  assert.equal(await spedisci(b), 'fallito');
  b.risposta = (coll) => (coll === C.COLLEZIONE ? 409 : 200);
  b.t += 24 * ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.per[S.COLLEZIONE].length, 2);
  assert.deepEqual(b.per[S.COLLEZIONE][1].doc.tetto_toccato, { segreti_saturo: '1' });
});

// ── Gli agganci ────────────────────────────────────────────────────────────

function scheda() {
  class Schede {}
  installSafebrowse(Schede);
  const schede = new Schede();
  let adesso = `https://${DOMINIO}/login`;
  const wc = { getURL: () => adesso, isDestroyed: () => false, send() {} };
  const tab = { id: 1, view: { webContents: wc }, isInternal: false };
  schede.tabs = [tab];
  schede.activeId = 2;
  schede.layout = () => {};
  schede.openTab = () => 99;
  schede.goBack = () => {};
  schede.puoTornare = () => false;
  return { schede, tab, vai: (u) => { adesso = u; } };
}

test('la scheda conta il verdetto della sua pagina (non quello confermato) e le scelte che fanno qualcosa', async () => {
  const b = banco();
  const { schede, tab } = scheda();
  tab._sbDoc = { url: `https://${DOMINIO}/login`, indizi: {} };
  const v = { level: 'pericoloso', reasons: ['strict_impersonation'], norm: { registrable: DOMINIO }, message: { title: 't', body: 'b' } };
  schede._sbMostra(tab, tab._sbDoc.url, schede._sbDellaScheda(tab, tab._sbDoc.url, v));
  tab.sbAvviso = { level: 'pericoloso', url: tab._sbDoc.url, message: v.message };
  schede._sbScelta(tab, 'procedi', { testo: 'non confermo' });
  schede._sbScelta(tab, 'continua');
  schede._sbScelta(tab, 'segnala');
  schede._sbScelta(tab, 'procedi', { testo: ' Confermo ' });
  assert.equal(tab.sbAvviso, null, 'la conferma ha tolto l’avviso');
  // Confermato, il verdetto rifatto si mostra «safe» ma per i contatori resta quello del sito.
  schede._sbMostra(tab, tab._sbDoc.url, schede._sbDellaScheda(tab, tab._sbDoc.url, v));
  assert.equal(tab.sbLevel, 'safe');
  tab.sbAvviso = { level: 'sospetto', url: 'https://altro.example/x', message: null, prima: { apri() {}, n: 1 } };
  schede._sbScelta(tab, 'continua');
  const d = await sicurezzaDellOra(b);
  assert.deepEqual(d.sito_verdetto, { pericoloso: 1, 'pericoloso:strict_impersonation': 1 });
  assert.deepEqual(d.avviso_scelta, {
    'segnala_falso_allarme:pericoloso:dopo': 1, 'procedi:pericoloso:dopo': 1, 'continua:sospetto:prima_di_aprire': 1,
  });
  schede.incognito = true;
  tab.sbAvviso = { level: 'sospetto', url: 'https://altro.example/x', message: null };
  schede._sbScelta(tab, 'copia');
  assert.equal((await sicurezzaDellOra(b)).avviso_scelta['copia:sospetto:dopo'], undefined, 'una finestra in incognito non conta');
});

test('i controlli di rete: esito e durata in fasce, uno spento una volta l’ora per pagina, e se hanno cambiato il verdetto', async () => {
  const b = banco();
  SB.setProviders({
    gsb: async (_u, _n, info) => { info.esito = 'transitorio'; return null; },
    rdap: async () => net.TRANSIENT,
    llm: null, ct: null, sandbox: null,
  });
  const url = 'http://pagamenti-rapidi.example.net/accesso';
  for (let i = 0; i < 2; i++) {
    SB.analyze(url, { hasPassword: true }, () => {});
    await SB._settled();
  }
  const d = await sicurezzaDellOra(b);
  assert.equal(d.sito_approfondito['gsb:transitorio:ms500'], 2);
  assert.ok(d.sito_approfondito['rdap:transitorio:ms500'] >= 1);
  assert.equal(d.sito_approfondito['llm:non_configurato'], 1, 'spento: una volta per pagina');
  assert.equal(d.sito_approfondito['ct:non_configurato'], 1);
  assert.equal(d.sito_approfondito['cambiato:no'], 2);

  SB.setProviders({ gsb: async () => ({ listed: true, category: 'phishing' }), rdap: null });
  SB.analyze('https://altro-sito.example.org/', {}, () => {});
  await SB._settled();
  const e = await sicurezzaDellOra(b);
  assert.equal(e.sito_approfondito['gsb:ok:ms500'], 1);
  assert.equal(e.sito_approfondito['cambiato:si'], 1, 'la lista nera ha cambiato il verdetto');

  SB.setProviders({ gsb: null });
  SB.analyze('https://senza-chiave.example.org/', {}, () => {});
  await SB._settled();
  assert.equal((await sicurezzaDellOra(b)).sito_approfondito['gsb:non_configurato'], 1, 'senza chiave Safe Browsing è spento');
  const json = JSON.stringify(await b.s.letto());
  assert.ok(!json.includes('pagamenti-rapidi') && !json.includes('altro-sito'), 'nessun indirizzo nel disco dei contatori');
});

test('Safe Browsing dice perché non ha un verdetto: senza chiave, rete o servizio sovraccarico, rifiuto, risposta', async () => {
  const esito = async (search) => {
    const info = {};
    const v = await gsb.createLookup({ search }).check('https://example.com/a', info);
    return [v === null ? null : 'verdetto', info.esito];
  };
  assert.deepEqual(await esito(async () => null), [null, 'non_configurato']);
  assert.deepEqual(await esito(async () => ({ ok: false, status: 0 })), [null, 'transitorio']);
  assert.deepEqual(await esito(async () => ({ ok: false, status: 503 })), [null, 'transitorio']);
  assert.deepEqual(await esito(async () => ({ ok: false, status: 403 })), [null, 'fallito']);
  assert.deepEqual(await esito(async () => ({ ok: true, matches: [], cacheMs: 1000 })), ['verdetto', 'ok']);
});

test('il freno per sito avvisa una volta per pausa, e di nuovo quando la chiave torna piena dopo aver ripassato', () => {
  const freno = SB.createOwnerBudget({ perHour: 2 });
  let toccato = 0;
  const conta = () => { toccato++; };
  for (let i = 0; i < 5; i++) freno.spend('sito', conta);
  assert.equal(toccato, 1);
  freno.m.set('sito', []);
  freno.spend('sito', conta);
  freno.spend('sito', conta);
  freno.spend('sito', conta);
  assert.equal(toccato, 2);
});

test('il cancello dice quali tipi di segreto ha tolto da una richiesta, e niente quando non toglie niente', async () => {
  const tolti = [];
  const prima = globalThis.SN_PROVIDERS;
  globalThis.SN_PROVIDERS = { ...prima, completeWithFallback: async ({ attempts }) => ({ text: 'ok', provider: attempts[0].provider, model: attempts[0].model, usage: {} }) };
  try {
    const gate = globalThis.SN_MODEL_GATE.create({
      getSettings: async () => ({}),
      buildChain: () => [{ provider: 'openrouter', apiKey: 'k', model: 'anthropic/claude-haiku' }],
      modelFor: () => 'haiku',
      costs: { isOverLimit: async () => false, record: async () => 0 },
      segreti: async () => [{ valore: SEGRETO, tipo: 'chiave' }, { valore: 'portafoglio-0123456789abcdef', tipo: 'portafoglio' }],
      segretiTolti: (action, tipi) => tolti.push([action, tipi]),
    });
    await gate.complete({ action: ACTIONS.FILO_CHAT, messages: [{ role: 'user', content: 'ciao' }] });
    assert.deepEqual(tolti, []);
    await gate.complete({ action: ACTIONS.FILO_CHAT, messages: [{ role: 'user', content: `la chiave è ${SEGRETO}` }] });
    assert.deepEqual(tolti, [[ACTIONS.FILO_CHAT, ['chiave']]]);
  } finally { globalThis.SN_PROVIDERS = prima; }
  const b = banco();
  b.m.segretiTolti(tolti[0][0], tolti[0][1]);
  assert.deepEqual((await sicurezzaDellOra(b)).segreto_oscurato, { 'chiave:filo-chat': 1 });
});

test('la porta delle uscite dice il tipo del segreto custodito; i tetti toccati arrivano dai loro posti', async () => {
  const v = Exfil.valutaUscita({ type: 'NAVIGA', url: `https://x.example/?q=${SEGRETO}` }, { segreti: [{ valore: SEGRETO, tipo: 'portafoglio' }] });
  assert.equal(v.blocca, true);
  assert.equal(v.regola, 'custodito');
  assert.equal(v.tipo, 'portafoglio');

  const b = banco();
  const reg = SegretiLetti.registro(2, { saturo: () => b.m.tetto('segreti_saturo') });
  reg.aggiungiTutti([{ valore: '111111', regola: 'codice' }]);
  reg.aggiungiTutti([{ valore: '222222', regola: 'codice' }, { valore: '333333', regola: 'codice' }]);
  const pieno = [{ valore: '444444', regola: 'codice' }];
  Object.defineProperty(pieno, 'saturo', { value: true });
  reg.aggiungiTutti(pieno);
  // Le combinazioni del correttore oltre il tetto vanno in «altro», e il tetto si conta.
  await b.s.finestra((ora) => {
    for (let i = 0; i < C.TETTO_COMBINAZIONI + 3; i++) C.registraProposta(ora, 'ortografia', `fornitore/modello-${i}`, 'mostrata');
    return true;
  });
  const d = await sicurezzaDellOra(b);
  assert.equal(d.tetto_toccato.segreti_saturo, 2);
  assert.ok(d.tetto_toccato.contatori_combinazioni >= 1);
});
