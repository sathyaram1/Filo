// I contatori del servizio (#1472): elenchi chiusi copiati dal codice, il documento che esce, gli agganci (cancello,
// ripiego della chiave, avviso dei crediti, segnalazioni automatiche, coda dei feedback) e la spedizione col servizio vero,
// su disco, orologio e rete finti. Una chiave, un codice d'invito o il messaggio del router passati a ogni misura non escono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi',
  'contatoriGiornalieri', 'contatoriSicurezza', 'contatoriServizio', 'wallet', 'chatErrors', 'creditiAvviso', 'autoFeedback', 'codaAdattiva']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'index.js'));
require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const Misure = require(join(ROOT, 'src', 'main', 'services', 'contatoriServizio.js'));
const Attesa = require(join(ROOT, 'src', 'main', 'services', 'autoFeedbackAttesa.js'));
const { FRASI } = require(join(ROOT, 'src', 'main', 'auth', 'esitoAccesso.js'));
const C = globalThis.SN_CONTATORI;
const R = globalThis.SN_CONTATORI_SERVIZIO;
const W = globalThis.SN_WALLET;
const CA = globalThis.SN_CREDITI_AVVISO;
const { ACTIONS } = globalThis.SN_CONST;

const leggi = (f) => readFileSync(join(ROOT, f), 'utf8');
const tra = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';
const ORA = 60 * 60 * 1000;
const T0 = new Date(2026, 9, 28, 9, 0, 0).getTime();
const attendi = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

// Quello che una misura non deve mai far uscire: una chiave, un codice d'invito, il messaggio d'errore del router.
const CHIAVE = 'sk-or-v1-9f8e7d6c5b4a39281706f5e4d3c2b1a0ffeeddccbbaa9988';
const INVITO = 'QZ7K-M4PX';
const ROUTER = 'No allowed providers are available for the selected model (provider_name: Contoso)';
const MALI = [CHIAVE, INVITO, ROUTER, `${CHIAVE}@example.com`];
function niente(json, cosa = '') {
  const piatto = json.toLowerCase().replace(/[^a-z0-9]/g, '');
  assert.ok(!piatto.includes('9f8e7d6c5b4a3928'), `${cosa}: la chiave è uscita`);
  assert.ok(!piatto.includes('qz7km4px') && !json.includes('QZ7K'), `${cosa}: il codice d'invito è uscito`);
  assert.ok(!/allowed providers|contoso/i.test(json), `${cosa}: il messaggio del router è uscito`);
  assert.ok(!json.includes('@'), `${cosa}: un'email è uscita`);
}

function daFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, daFs(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(daFs);
  throw new Error(`tipo inatteso ${JSON.stringify(v)}`);
}

function banco({ impostazioni = {}, saldo = 42, spesa = 0.5, coda = { voci: 0, piuVecchiaMs: null } } = {}) {
  const disco = new Map();
  const per = {};
  const b = { t: T0, accesi: true, incognito: false, disco, per, n: 0 };
  b.s = Servizio.crea({
    contatori: C,
    contatoriServizio: R,
    storage: {
      getRaw: async (k, d) => (disco.has(k) ? JSON.parse(JSON.stringify(disco.get(k))) : d),
      setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
    },
    impostazioni: async () => ({ contatori: { attivi: b.accesi }, ...impostazioni }),
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
      return { ok: true, status: 200, json: async () => ({}) };
    },
    log: () => {},
  });
  b.m = Misure.crea({
    contatori: b.s, adesso: () => b.t,
    portafoglio: () => (saldo == null ? null : { state: { server: { balance: { credits: saldo } } } }),
    spesaDelMese: async () => spesa,
    coda: () => coda,
  });
  globalThis.SN_CONTATORI_SERVIZIO_MAIN = b.m;
  return b;
}
const delServizio = async (b) => {
  await attendi();
  const s = await b.s.letto();
  return (s.ore[C.oraDi(b.t)] || {}).servizio || {};
};
// Lo stato dell'interruttore entra in ogni ora: le prove sui conti lo tolgono.
const senzaStato = (m) => Object.fromEntries(Object.entries(m || {}).filter(([k]) => !k.startsWith('stato|')));
const spedisci = async (b) => {
  await attendi();
  b.t += ORA;
  return b.s.controlla();
};

// ── Gli elenchi sono copie del codice ──────────────────────────────────────

test('i motivi della politica, del «nessun host» e delle chiamate mai partite sono quelli del codice', () => {
  const politica = leggi('src/shared/politicaModelli.js');
  const corpoViolazione = /function servedPolicyViolation\([^)]*\) \{([\s\S]*?)\n {2}\}/.exec(politica)[1];
  assert.deepEqual(tra(/return '([a-z-]+)'/g, corpoViolazione).map((x) => x.replace(/-/g, '_')).sort(), [...R.MOTIVI_VIOLAZIONE].sort());

  const router = leggi('src/main/services/providers/openrouter.js');
  const verdetto = /async function hostVerdict\([^)]*\) \{([\s\S]*?)\n {2}\}/.exec(router)[1];
  const motivi = new Set([...tra(/err\.reason = '([a-z]+)'/g, router),
    ...tra(/reason: ([^,]+),/g, verdetto).flatMap((x) => tra(/'([a-z]+)'/g, x))]);
  assert.deepEqual([...motivi].sort(), [...R.MOTIVI_HOST].sort(), 'i motivi del «nessun host ammesso»');
  const giornalieri = leggi('src/shared/contatoriGiornalieri.js');
  const senzaHost = tra(/'([A-Z_]+)'/g, /const SENZA_HOST = new Set\(\[([^\]]*)\]\)/.exec(giornalieri)[1]);
  assert.deepEqual(senzaHost.filter((c) => c !== 'NO_ALLOWED_HOST').map((c) => c.toLowerCase()).sort(), [...R.CODICI_HOST].sort());
  const maiPartite = tra(/'([A-Z_]+)'/g, /const MAI_PARTITE = new Set\(\[([^\]]*)\]\)/.exec(giornalieri)[1]);
  assert.deepEqual(maiPartite.map((c) => c.toLowerCase()).sort(), [...R.MOTIVI_MAI_PARTITA].sort());

  const cancello = leggi('src/main/services/modelGate.js');
  const decisione = /function esitoDecisione\([^)]*\) \{([\s\S]*?)\n {2}\}/.exec(cancello)[1];
  assert.deepEqual([...new Set(tra(/'([a-z]+)'/g, decisione).filter((x) => x !== 'function'))].sort(),
    [...R.DECISIONI].sort(), 'le decisioni del classificatore');

  const portafoglio = leggi('src/main/services/handlers/wallet.js');
  const fonti = /async function keySourceOf\([^)]*\) \{([\s\S]*?)\n {2}\}/.exec(portafoglio)[1];
  assert.deepEqual([...new Set(tra(/'(own|personal|factory)'/g, fonti))].sort(), R.FONTI.filter((f) => f !== 'none').sort());
  for (let s = 100; s < 600; s++) assert.equal(W.isKeyRefusalStatus(s), R.STATUS_CHIAVE.includes(String(s)), `status ${s}`);
});

test('crediti, inviti, accesso e segnalazioni: gli elenchi sono quelli del codice', () => {
  const avviso = leggi('src/shared/creditiAvviso.js');
  assert.deepEqual([...new Set(tra(/motivi\.push\('([a-z]+)'\)/g, avviso))].sort(), [...R.MOTIVI_AVVISO].sort());
  assert.deepEqual(CA.automatiche().map((a) => a.id), [...R.AUTOMATICHE]);
  const rimedi = tra(/out\.push\(\{ id: '([a-z]+)'/g, avviso);
  assert.deepEqual(['modello', 'automatiche', ...rimedi.filter((r) => r !== 'attesa')].sort(), [...R.RIMEDI].sort(),
    'i rimedi da un clic: «attesa» è solo un testo');
  assert.match(avviso, /id: 'attesa'.*soloTesto: true/);

  assert.deepEqual([...Object.keys(W.REDEEM_MESSAGES), 'no_identity', R.ALTRO].sort(), [...R.ESITI_INVITO].sort());
  assert.match(leggi('src/main/services/handlers/wallet.js'), /status: 'no_identity'/);

  assert.deepEqual(['ok', ...Object.keys(FRASI).map((k) => k.replace(/-/g, '_'))].sort(), [...R.ESITI_ACCESSO].sort());
  const rifiuti = tra(/return '([a-z_]+)'/g, leggi('src/main/auth/rifiutoGoogle.js'));
  assert.match(leggi('src/main/auth/accessoInScheda.js'), /'rete' : null/);
  assert.deepEqual(['rete', ...rifiuti, 'senza_scheda'].sort(), [...R.MOTIVI_BROWSER].sort());

  const af = leggi('src/shared/autoFeedback.js');
  assert.deepEqual([...new Set(tra(/kind: '([a-z-]+)'/g, af))].sort(), [...R.TIPI_F4].sort());
});

test('ogni voce degli elenchi che nascono qui la conta qualcuno', () => {
  const identita = leggi('src/main/auth/anon-auth.js');
  assert.deepEqual([...new Set(tra(/contaGuasto\('([a-z_]+)'\)/g, identita))].sort(), [...R.EVENTI_IDENTITA].sort());
  const g = leggi('src/main/auth/google-auth.js');
  assert.match(g, /contaAccesso\('browser', motivo\)/);
  assert.match(g, /contaAccesso\('browser', 'senza_scheda'\)/);
  for (const e of R.ESITI_RINNOVO) assert.match(g, new RegExp(`contaAccesso\\('rinnovo', '${e}'\\)`));
  const handlers = leggi('src/main/services/handlers.js');
  const attesa = leggi('src/main/services/autoFeedbackAttesa.js');
  for (const e of ['sostituita', 'spenta']) assert.match(handlers, new RegExp(`esito\\('${e}'\\)`));
  for (const e of ['inviata', 'in_coda', 'fallita', 'annullata']) assert.ok(attesa.includes(`'${e}'`), e);
  const coda = leggi('src/main/services/feedbackOutbox.js');
  assert.deepEqual([...new Set(tra(/conta\('rinuncia', '([a-z]+)'/g, coda))].sort(), [...R.MOTIVI_RINUNCIA].sort());
  assert.deepEqual([...new Set(tra(/attendiAccesso\(it, [^,]+, '([a-z]+)'\)/g, coda))].sort(), [...R.ATTESE_ACCESSO].sort());
  const or = leggi('src/main/services/providers/openrouter.js');
  assert.deepEqual([...new Set(tra(/contaRipiego\(([^)]*)\)/g, or).flatMap((x) => tra(/'([a-z_]+)'/g, x)))].sort(), [...R.ESITI_RIPIEGO_CHIAVE].sort());
  assert.match(or, /contaRipiego\(refused\.status, res\.ok \? 'riuscito' : 'fallito'\)/);
  assert.match(handlers, /Object\.defineProperty\(out, 'pesiAperti'/, 'la catena porta i modelli cambiati dall’interruttore');
  assert.match(handlers, /misura\('bloccoPesi', kind\)/);
  assert.deepEqual(R.FASCE_SPESA.map(([, x]) => x), [0, 0.1, 1, 5, 20, Infinity]);
  assert.deepEqual(R.FASCE_SALDO.map(([, x]) => x), [0, 1, 10, 50, 100, 500, Infinity]);
  assert.match(R.FORMA_MODELLO, /^\[a-z0-9\]/);
  assert.equal(C.MODELLO_RE.source, `^${R.FORMA_MODELLO.replace(/\(\[\/\]/, '(?:\\/').replace(/\(\[:\]/, '(?::')}$`,
    'la forma del modello è MODELLO_RE');
  assert.equal(C.HOST_RE.source, `^${R.FORMA_HOST}$`, 'la forma dell’host è HOST_RE');
});

// ── Ogni misura: una chiave, un codice d'invito e il messaggio del router non escono ─────────────────

test('ogni misura ripulisce quello che riceve: niente chiave, codice, messaggio del router o email', () => {
  for (const x of MALI) {
    const ora = {};
    R.registraViolazione(ora, { funzione: x, modello: x, host: x, motivo: 'excluded', fonte: x });
    R.registraViolazione(ora, { funzione: 'filo-chat', modello: 'a/b', host: 'DeepInfra', motivo: x, fonte: 'own' });
    R.registraServitaIgnota(ora, x, x);
    R.registraNessunHost(ora, x, x, R.motivoNessunHost({ code: 'NO_ALLOWED_HOST', reason: x, message: ROUTER }));
    R.registraNessunHost(ora, x, x, x);
    R.registraPesi(ora, x, 'tolto'); R.registraPesi(ora, 'filo-chat', x);
    R.registraZdr(ora, x, 'partita'); R.registraZdr(ora, 'filo-chat', x);
    R.registraMaiPartita(ora, x, R.motivoMaiPartita({ code: 'NO_API_KEY', message: x })); R.registraMaiPartita(ora, 'tts', x);
    R.registraRipiego(ora, x, 'spezzato'); R.registraRipiego(ora, 'tts', x);
    R.registraFonte(ora, x, x);
    R.registraRipiegoChiave(ora, x, 'riuscito'); R.registraRipiegoChiave(ora, 401, x);
    R.registraAvviso(ora, 'rimedio', x); R.registraAvviso(ora, x, 'modello');
    R.registraSaldo(ora, { saldo: x, spesaEur: x, limiteEur: x });
    R.registraInvito(ora, x);
    R.registraIdentita(ora, x);
    R.registraAccesso(ora, 'esito', x); R.registraAccesso(ora, x, 'ok');
    R.registraF4(ora, 'complaint', x, 'inviata'); R.registraF4(ora, x, 'new-tab', 'inviata');
    R.registraProposta(ora, x);
    R.registraCoda(ora, { voci: x, etaMs: x }); R.registraRinuncia(ora, x); R.registraAttesaAccesso(ora, x);
    const doc = R.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-28T10', app: '0.2.300', os: 'linux', dati: ora });
    assert.equal(R.valida(doc).ok, true, R.valida(doc).motivo);
    niente(JSON.stringify(doc), x);
    assert.equal(doc.invito.altro, '1', 'un codice d’invito esce «altro»');
    assert.equal(doc.politica_violata[`altro|altro|altro|excluded|none`], '1', 'funzione, modello, host e fonte sconosciuti escono «altro»');
  }
});

test('le misure aperte si fermano al tetto delle voci: il resto va in «altro», contato fra i tetti toccati', () => {
  const ora = {};
  for (let i = 0; i < R.TETTO_VOCI + 7; i++) R.registraServitaIgnota(ora, 'filo-chat', `fornitore/modello-${i}`);
  const m = R.dati(ora).servita_ignota;
  assert.equal(Object.keys(m).filter((k) => k !== 'altro|altro').length, R.TETTO_VOCI);
  assert.equal(m['altro|altro'], 7);
  assert.equal(ora.sicurezza.tetto_toccato.contatori_combinazioni, 7);
  R.registraServitaIgnota(ora, 'filo-chat', 'fornitore/modello-3');
  assert.equal(m['filo-chat|fornitore/modello-3'], 2, 'una voce che c’era già continua a contare');
});

test('le istantanee dell’ora: saldo e spesa in fasce, la coda, l’ultima vista vince', () => {
  const ora = {};
  R.registraSaldo(ora, { saldo: 0, spesaEur: 0, limiteEur: 0 });
  R.registraSaldo(ora, { saldo: 120, spesaEur: 0.05, limiteEur: 5 });
  assert.deepEqual(R.dati(ora).saldo_spesa, { 'saldo|c500': 1, 'spesa|e0_1|limite_si': 1 });
  R.registraSaldo(ora, { saldo: -3, spesaEur: 25, limiteEur: null });
  assert.deepEqual(R.dati(ora).saldo_spesa, { 'saldo|c0': 1, 'spesa|oltre|limite_no': 1 });
  R.registraCoda(ora, { voci: 3, etaMs: 7 * ORA });
  R.registraCoda(ora, { voci: 0, etaMs: null });
  R.registraRinuncia(ora, 'scaduta');
  assert.deepEqual(R.dati(ora).coda_feedback, { 'voci|n0': 1, 'rinuncia|scaduta': 1 });
  R.registraStatoPesi(ora, true);
  R.registraStatoPesi(ora, false);
  assert.deepEqual(R.dati(ora).pesi_aperti, { 'stato|acceso': 1, 'stato|spento': 1 }, 'cambiato nell’ora: tutti e due');
});

// ── La spedizione, col servizio vero ─────────────────────────────────────

test('un’ora con le misure del servizio parte nel suo documento, con l’istantanea; spenti o in incognito no', async () => {
  const b = banco({ impostazioni: { openWeightsOnly: true, monthlyLimitEur: 5 }, saldo: 7, spesa: 2.5, coda: { voci: 1, piuVecchiaMs: 2 * ORA } });
  b.m.invito(INVITO);
  b.m.invito('ok');
  await attendi();
  b.m.identita('identity_lost');
  const d = await delServizio(b);
  assert.deepEqual(d.invito, { altro: 1, ok: 1 });
  assert.equal(d.pesi_aperti['stato|acceso'], 1);
  assert.deepEqual(d.saldo_spesa, { 'saldo|c10': 1, 'spesa|e5|limite_si': 1 }, 'la spesa letta dopo la prima scrittura entra alla seconda');
  assert.deepEqual(d.coda_feedback, { 'voci|n1': 1, 'eta|h6': 1 });
  assert.equal(await spedisci(b), 'inviati');
  const doc = b.per[R.COLLEZIONE][0].doc;
  assert.equal(R.valida(doc).ok, true);
  assert.equal(b.per[R.COLLEZIONE][0].url.includes(`documentId=${C.idDocumento(doc)}`), true, 'lo stesso id dell’ora');
  assert.equal(doc.identita.identity_lost, '1');
  niente(JSON.stringify(b.per), 'spedito');

  b.incognito = true;
  b.m.invito('ok');
  b.m.f4('complaint', 'new-tab', 'inviata');
  assert.deepEqual((await delServizio(b)).invito || {}, {}, 'in incognito non si conta');
  b.incognito = false;
  b.m.f4('complaint', 'new-tab', 'inviata', { incognito: true });
  assert.deepEqual((await delServizio(b)).f4 || {}, {}, 'la segnalazione nata in incognito non si conta, da qualunque strada arrivi l’esito');
  b.accesi = false;
  b.m.invito('ok');
  await attendi();
  assert.equal(await spedisci(b), 'spenti');
  assert.equal(b.per[R.COLLEZIONE].length, 1, 'spenti non esce niente');
});

// ── Gli agganci ───────────────────────────────────────────────────────────

function cancello(b, provider, extra = {}) {
  const prima = globalThis.SN_PROVIDERS;
  globalThis.SN_PROVIDERS = { ...prima, ...provider };
  const G = globalThis.SN_MODEL_GATE.create({
    getSettings: async () => ({}),
    buildChain: () => [{ provider: 'openrouter', model: 'deepseek/v4' }],
    modelFor: () => 'x',
    costs: { isOverLimit: async () => false, record: async () => 0 },
    contatore: () => b.s,
    auditDelaysMs: [1, 1, 1],
    ...extra,
  });
  return { G, ripristina: () => { globalThis.SN_PROVIDERS = prima; } };
}

test('il cancello: chi paga, la ritenzione zero, chi ha servito, il «nessun host» col motivo', async () => {
  const b = banco();
  const errHost = Object.assign(new Error(ROUTER), { code: 'NO_ALLOWED_HOST', reason: 'zdrmixed', model: 'qwen/q3', provider: 'openrouter' });
  const errRouter = Object.assign(new Error(`OpenRouter 404: ${ROUTER}`), { status: 404, code: 'NO_PROVIDER_ALLOWED', keySource: 'personal', provider: 'openrouter' });
  const { G, ripristina } = cancello(b, {
    completeWithFallback: async ({ attempts, onTentativoFallito }) => {
      onTentativoFallito(errHost, { modello: 'qwen/q3', host: '', provider: 'openrouter' });
      onTentativoFallito(errRouter, { modello: 'mistral/m', host: '', provider: 'openrouter' });
      return { text: 'ok', provider: attempts[0].provider, model: attempts[0].model, tentativo: 3, usage: { keySource: 'factory' } };
    },
  });
  try {
    await G.complete({ action: ACTIONS.FILO_CHAT, messages: [{ role: 'user', content: CHIAVE }] });
  } finally { ripristina(); }
  const d = await delServizio(b);
  assert.deepEqual(d.chiave_fonte, { 'filo-chat|factory': 1 });
  assert.deepEqual(d.servita_ignota, { 'filo-chat|deepseek/v4': 1 }, 'la risposta di testo non diceva chi l’ha servita');
  assert.deepEqual(d.nessun_host, { 'filo-chat|qwen/q3|zdrmixed': 1, 'filo-chat|mistral/m|no_provider_allowed': 1 });
  assert.deepEqual(d.zdr, { 'filo-chat|rifiutata': 1, 'filo-chat|partita': 2 }, 'il rifiuto del router era partito, quello degli host no');
  niente(JSON.stringify(d));
});

test('il cancello: una chiamata mai partita si conta una volta sola, anche se la vede anche chi l’ha chiesta', async () => {
  const b = banco();
  const err = Object.assign(new Error(`Manca il modello ${CHIAVE}`), { code: 'NO_OPEN_WEIGHTS_MODEL', droppedRefs: ['claude', 'gpt'] });
  const { G, ripristina } = cancello(b, {}, { buildChain: () => { throw err; } });
  try {
    await assert.rejects(G.complete({ action: ACTIONS.EXPLAIN, messages: [] }), (e) => e === err);
  } finally { ripristina(); }
  Misure.misura('maiPartita', ACTIONS.EXPLAIN, err);
  const limite = Object.assign(new Error('limite'), { code: 'LIMIT_REACHED' });
  Misure.misura('maiPartita', ACTIONS.TRANSCRIBE_AUDIO, limite);
  Misure.misura('maiPartita', ACTIONS.TRANSCRIBE_AUDIO, Object.assign(new Error('rete'), { code: 'ECONNRESET' }));
  const d = await delServizio(b);
  assert.deepEqual(d.mai_partita, { 'explain|no_open_weights_model': 1, 'transcribe-audio|limit_reached': 1 });
  assert.deepEqual(senzaStato(d.pesi_aperti), { 'explain|tolto': 2 });
});

test('il cancello: voce e dettatura chiedono dopo chi ha servito; a tentativi finiti senza risposta è ignota', async () => {
  const b = banco();
  const finto = {
    synthesizeSpeech: async () => ({ audioBase64: 'x', generationId: 'gen-1', keySource: 'own', usage: null }),
    lookupServedBy: async () => null,
  };
  const prima = globalThis.SN_PROVIDERS;
  globalThis.SN_PROVIDERS = { ...prima, getProvider: () => finto };
  try {
    const G = globalThis.SN_MODEL_GATE.create({
      getSettings: async () => ({}), buildChain: () => [], modelFor: () => 'x',
      costs: { isOverLimit: async () => false, record: async () => 0 }, contatore: () => b.s, auditDelaysMs: [1, 1, 1],
    });
    await G.call({ action: ACTIONS.TTS, attempt: { provider: 'openrouter', model: 'openai/tts-x' }, method: 'synthesizeSpeech', args: { text: 'ciao' } });
    assert.deepEqual((await delServizio(b)).servita_ignota || {}, {}, 'prima dei controlli a posteriori non si sa ancora');
    await new Promise((r) => setTimeout(r, 40));
  } finally { globalThis.SN_PROVIDERS = prima; }
  const d = await delServizio(b);
  assert.deepEqual(d.servita_ignota, { 'tts|openai/tts-x': 1 });
  assert.deepEqual(d.chiave_fonte, { 'tts|own': 1 });
  assert.deepEqual(d.zdr || {}, {}, 'la chiave propria non ha la ritenzione zero');
});

test('il cancello: i tentativi rotti e già pagati, e le decisioni del classificatore', async () => {
  const b = banco();
  const { G, ripristina } = cancello(b, {
    streamCompleteWithFallback: async () => ({ text: 'ok', model: 'a/b', servedBy: 'DeepInfra', usage: { keySource: 'personal' },
      brokenAttempts: [{ provider: 'nessuno', model: 'a/b' }, { provider: 'nessuno', model: 'a/c' }] }),
  });
  try {
    await G.stream({ action: ACTIONS.FILO_CHAT, messages: [] });
  } finally { ripristina(); }
  // Il classificatore: una richiesta risposta, poi un 400 che si scarta; un'altra catena con un 400 prima di ogni risposta.
  const finto = {
    decisions: async ({ questions }) => {
      if (questions === 'storta') throw Object.assign(new Error(ROUTER), { status: 400 });
      return { answers: { a: true }, model: 'a/b', servedBy: 'DeepInfra', usage: { keySource: 'factory' } };
    },
  };
  const prima = globalThis.SN_PROVIDERS;
  globalThis.SN_PROVIDERS = { ...prima, getProvider: () => finto };
  try {
    const G2 = globalThis.SN_MODEL_GATE.create({
      getSettings: async () => ({}), buildChain: () => [{ provider: 'openrouter', model: 'a/b' }], modelFor: () => 'x',
      costs: { isOverLimit: async () => false, record: async () => 0 }, contatore: () => b.s,
    });
    await G2.decideAll({ action: ACTIONS.FILO_TAB_TRIAGE, requests: [{ state: 's', questions: 'q' }, { state: 's', questions: 'storta' }], parallel: 1 });
    await G2.decideAll({ action: ACTIONS.FILO_TAB_TRIAGE, requests: [{ state: 's', questions: 'storta' }], parallel: 1 }).catch(() => null);
  } finally { globalThis.SN_PROVIDERS = prima; }
  const d = await delServizio(b);
  assert.equal(d.ripiego['filo-chat|spezzato'], 2);
  assert.equal(d.ripiego['tab-triage|scarta'], 1, 'risposto una volta, il 400 è di quella richiesta');
  assert.equal(d.ripiego['tab-triage|fatale'], 1, 'prima di ogni risposta il 400 ferma la catena');
  assert.deepEqual(d.chiave_fonte, { 'filo-chat|personal': 1, 'tab-triage|factory': 1 });
  assert.deepEqual(d.servita_ignota || {}, {});
  assert.deepEqual(d.zdr, { 'filo-chat|partita': 1, 'tab-triage|partita': 1 });
});

test('il ripiego dalla chiave propria ai crediti: riuscito, fallito o non ammesso, per status', async () => {
  const b = banco();
  const OWN = 'sk-or-v1-own-chiave-di-prova';
  const PERSONAL = 'sk-or-v1-personal-chiave-di-prova';
  const P = globalThis.SN_PROVIDER_OPENROUTER;
  let statusFor = {};
  const primaFetch = globalThis.fetch;
  const primaW = globalThis.SN_WALLET_MAIN;
  const K = globalThis.SN_CONST;
  const primaAmmesso = K.creditsAllowModelLetto;
  globalThis.SN_WALLET_MAIN = {
    alternativeKeyFor: async (k) => (k === OWN ? { key: PERSONAL, source: 'personal' } : null),
    keySourceOf: async (k) => (k === OWN ? 'own' : k === PERSONAL ? 'personal' : ''),
    noteOwnKeyRefusal: async () => {},
  };
  K.creditsAllowModelLetto = () => true;
  globalThis.fetch = async (url, init) => {
    const key = String(init.headers.Authorization || '').replace('Bearer ', '');
    const status = statusFor[key] ?? 200;
    const body = status === 200
      ? JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, provider: 'Fake' })
      : JSON.stringify({ error: { message: ROUTER } });
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    statusFor = { [OWN]: 401 };
    await P.complete({ apiKey: OWN, model: 'm', messages: [] });
    statusFor = { [OWN]: 402, [PERSONAL]: 402 };
    await assert.rejects(P.complete({ apiKey: OWN, model: 'm', messages: [] }));
    K.creditsAllowModelLetto = () => false;
    statusFor = { [OWN]: 403 };
    await assert.rejects(P.complete({ apiKey: OWN, model: 'anthropic/claude-x', messages: [] }), (e) => e.code === 'NO_ALLOWED_HOST');
    K.creditsAllowModelLetto = () => true;
    statusFor = { [OWN]: 500 };
    await assert.rejects(P.complete({ apiKey: OWN, model: 'm', messages: [] }));
  } finally {
    globalThis.fetch = primaFetch;
    globalThis.SN_WALLET_MAIN = primaW;
    K.creditsAllowModelLetto = primaAmmesso;
  }
  const d = await delServizio(b);
  assert.deepEqual(d.chiave_ripiego, { '401|riuscito': 1, '402|fallito': 1, '403|non_ammesso': 1 }, 'un 500 non è un rifiuto della chiave');
});

test('le segnalazioni automatiche: com’è finita, dall’avviso, da «Annulla» o dalla rete', async () => {
  const esiti = [];
  const esito = (e) => esiti.push(e);
  const prova = async (spedisci, annullaPrima = false) => {
    const bi = Attesa.trattieni(spedisci, null, { esito });
    if (annullaPrima) return Attesa.annulla(bi);
    Attesa.parti(bi);
    await attendi();
    return null;
  };
  await prova(async () => ({ id: 'fb1' }));
  await prova(async () => ({ queued: true }));
  await prova(async () => { throw new Error(ROUTER); });
  assert.deepEqual(await prova(async () => ({ id: 'fb2' }), true), { ok: true });
  await attendi();
  assert.deepEqual(esiti, ['inviata', 'in_coda', 'fallita', 'annullata']);
  const b = banco();
  b.m.f4('capability-gap', '', 'sostituita');
  b.m.f4('complaint', 'translate-page', 'spenta');
  b.m.f4('capability-uncommandable', 'nessuna-capacita-cosi', 'inviata');
  b.m.proposta('mostrata');
  const d = await delServizio(b);
  assert.deepEqual(d.f4, { 'capability-gap|nessuno|sostituita': 1, 'complaint|translate-page|spenta': 1, 'capability-uncommandable|altro|inviata': 1 });
  assert.deepEqual(d.f4_proposta, { mostrata: 1 });
});

test('la coda dei feedback: troppe voci, lo stato in numeri, le attese d’accesso una volta per voce e motivo', async () => {
  const b = banco();
  const primaConst = globalThis.SN_CONST;
  const primaStorage = globalThis.SN_STORAGE;
  const primaFb = globalThis.SN_FEEDBACK;
  const store = new Map();
  globalThis.SN_CONST = { ...primaConst, STORAGE_KEYS: { ...primaConst.STORAGE_KEYS, FEEDBACK_OUTBOX: 'feedbackOutbox' } };
  globalThis.SN_STORAGE = { getRaw: async (k, d) => (store.has(k) ? store.get(k) : d), setRaw: async (k, v) => { store.set(k, v); } };
  globalThis.SN_FEEDBACK = { fallbackName: () => 'x', submit: async () => { throw new Error('rete'); } };
  try {
    require(join(ROOT, 'src', 'main', 'services', 'feedbackOutbox.js'));
    const OB = globalThis.SN_FEEDBACK_OUTBOX;
    OB._reset();
    OB._setAuto(false);
    OB.init({ backoffMin: 999999, tokenOwner: async () => '' });
    for (let i = 0; i < 52; i++) await OB.enqueue({ text: `${CHIAVE} ${i}`, submissionId: `s${i}` }, { dallOwner: i === 51 });
    const st = OB.stato();
    assert.equal(st.voci, 50);
    assert.ok(st.piuVecchiaMs >= 0 && st.piuVecchiaMs < 60000);
    assert.deepEqual(Object.keys(st).sort(), ['piuVecchiaMs', 'voci'], 'solo numeri');
    await OB.flush();
    await OB.flush();
    OB._reset();
  } finally {
    globalThis.SN_CONST = primaConst;
    globalThis.SN_STORAGE = primaStorage;
    globalThis.SN_FEEDBACK = primaFb;
  }
  const d = await delServizio(b);
  assert.equal(d.coda_feedback['rinuncia|troppe'], 2);
  assert.equal(d.coda_feedback['attesa_accesso|assente'], 1, 'due giri, una voce: una attesa');
  niente(JSON.stringify(d));
});

test('pesi aperti: la stessa catena conta una volta; le prove bloccate per tipo', async () => {
  const b = banco();
  const catena = [{ provider: 'openrouter', model: 'qwen/q' }];
  Object.defineProperty(catena, 'pesiAperti', { value: { sostituiti: 1, tolti: 2 }, enumerable: false });
  b.m.catena(ACTIONS.FILO_CHAT, catena);
  b.m.catena(ACTIONS.FILO_CHAT, catena);
  b.m.catena(ACTIONS.FILO_CHAT, [{ provider: 'openrouter', model: 'qwen/q' }]);
  b.m.bloccoPesi('model');
  b.m.bloccoPesi('provider');
  b.m.bloccoPesi('altro');
  const d = await delServizio(b);
  assert.deepEqual(senzaStato(d.pesi_aperti), { 'filo-chat|sostituito': 1, 'filo-chat|tolto': 2, 'provider-test|blocco_model': 1, 'provider-test|blocco_provider': 1 });
});

test('quello che arriva prima del servizio (l’identità all’avvio) aspetta ed entra quando c’è', async () => {
  const prima = globalThis.SN_CONTATORI_SERVIZIO_MAIN;
  delete globalThis.SN_CONTATORI_SERVIZIO_MAIN;
  Misure.misura('identita', 'illeggibile_da_parte');
  const b = banco();
  Misure.avvia(b.m);
  const d = await delServizio(b);
  assert.equal(d.identita.illeggibile_da_parte, 1);
  void prima;
});

test('la fine di una risposta interrotta a metà da un errore del fornitore si conta per nome (#1464)', () => {
  const ora = C.oraVuota();
  C.registraChiamata(ora, 'filo-chat', { modello: 'a/b', ingresso: 100, uscita: 30, fine: 'error' });
  C.registraChiamata(ora, 'filo-chat', { modello: 'a/b', ingresso: 100, uscita: 30, fine: 'boh' });
  assert.deepEqual(ora.uscita['filo-chat'], { 'a/b|o256|error': 1, 'a/b|o256|altro': 1 });
});
