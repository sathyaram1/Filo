// I compiti delle routine (#1196): le regole pure della scheda e dello script (src/shared/compiti.js), la porta del
// main verso ownerCompiti (handlers/auth.js) e le regole Firestore che li chiudono ai client. Harness della porta come
// routineCrediti.test.mjs: handler vero, server HTTP locale.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// L'ordine del loader del main: gli ambiti prima dei compiti, che ne prendono quelli attivi.
require(join(ROOT, 'src', 'shared', 'ambiti.js'));
require(join(ROOT, 'src', 'shared', 'ricorrenti.js'));
require(join(ROOT, 'src', 'shared', 'compiti.js'));
const K = globalThis.SN_COMPITI;
const A = globalThis.SN_AMBITI;

const fase = (extra) => Object.assign({ id: 'C-3', tipo: 'fase', feedbackNum: '#1196', fase: 'verifica', stato: 'aperto', aperto: true, urgenza: 38, priorita: 2, fiducia: 'fidato', figlio: false, biglietti: [] }, extra);

test('etichetta: «#N · fase» per un compito di un feedback, «C-n · titolo» per uno scritto a mano', () => {
  assert.equal(K.etichetta(fase()), '#1196 · verifica');
  assert.equal(K.etichetta(fase({ fase: 'controllo', feedbackNum: '#7.2' })), '#7.2 · controllo cieco');
  assert.equal(K.etichetta(fase({ fase: 'primo' })), '#1196 · primo lavoro');
  assert.equal(K.etichetta({ id: 'C-12', tipo: 'manuale', titolo: '  Guarda i log  ' }), 'C-12 · Guarda i log');
  assert.equal(K.etichetta({ id: 'C-12', tipo: 'manuale', titolo: '' }), 'C-12');
  assert.equal(K.etichetta(null), '');
});

test('etichetta: l\'istanza di un ricorrente col suo nome, un\'unione coi numeri dei feedback', () => {
  assert.equal(K.etichetta({ id: 'C-12', tipo: 'ricorrente', titolo: 'Revisione delle domande', ricorrenteId: 'r1' }), 'C-12 · Revisione delle domande');
  assert.equal(K.etichetta({ id: 'C-13', tipo: 'unione', titolo: 'Unione di #12, #15', feedbackNums: ['#12', '#15'] }), 'C-13 · Unione di #12, #15');
  assert.equal(K.etichetta({ id: 'C-13', tipo: 'unione', titolo: '', feedbackNums: ['#12', '#15'] }), 'C-13 · Unione di #12, #15', 'senza titolo lo dicono i numeri');
  assert.match(K.urgenzaTesto({ tipo: 'ricorrente', urgenza: 30 }), /ricorrente/);
  assert.match(K.urgenzaTesto({ tipo: 'unione', urgenza: 20 }), /unioni/);
});

test('perché aspetta: la frase del server, o «non prima di» in ora italiana, solo per chi è in attesa', () => {
  const adesso = Date.UTC(2026, 9, 25, 10, 0);
  const domani = Date.UTC(2026, 9, 26, 5, 0); // le 06:00 a Roma, ora solare
  assert.equal(K.attesaTesto({ stato: 'aperto', aperto: true, attesa: 'aspetta l’ambiente dei riservati.' }, adesso), 'aspetta l’ambiente dei riservati');
  assert.equal(K.attesaTesto({ stato: 'aperto', aperto: true, attesa: 'l’ambito posta non è ancora attivo', nonPrimaDi: domani }, adesso), 'l’ambito posta non è ancora attivo', 'la frase del server vince');
  assert.equal(K.attesaTesto({ stato: 'aperto', aperto: true, attesa: '', nonPrimaDi: domani }, adesso), 'non prima di lun 26/10 06:00');
  assert.equal(K.attesaTesto({ stato: 'aperto', aperto: true, nonPrimaDi: adesso - 1 }, adesso), '', 'un «non prima» passato non ferma niente');
  assert.equal(K.attesaTesto({ stato: 'in_corso', aperto: true, attesa: 'x' }, adesso), '');
  assert.equal(K.attesaTesto({ stato: 'fatto', aperto: false, attesa: 'x' }, adesso), '');
  assert.equal(K.attesaTesto(null), '');
});

test('ambiti di un compito: quelli attivi del server; senza, quelli attivi del codice', () => {
  assert.deepEqual([...K.AMBITI], A.attivi(), 'gli ambiti iniziali attivi, non più solo lavoro e server');
  const r = { ambiti: A.elenco({ notizie: { operazioni: ['feedback.apri'], nonPuo: 'altro' } }) };
  assert.deepEqual(K.ambitiAttivi(r), A.attivi({ notizie: { operazioni: ['feedback.apri'], nonPuo: 'altro' } }));
  assert.ok(K.ambitiAttivi(r).includes('notizie'), 'un ambito approvato dall’owner si sceglie');
  assert.equal(K.ambitiAttivi(r).includes('posta'), false, 'uno non ancora attivo no');
  assert.deepEqual(K.ambitiAttivi({ ambiti: [] }), [...K.AMBITI]);
  assert.deepEqual(K.ambitiAttivi(null), [...K.AMBITI]);
});

test('scelte di un compito: con l\'elenco del server vale l\'elenco; senza, il main non chiude fuori un ambito approvato', () => {
  const base = { urgenza: 30, modello: 'opus', sforzo: 'high' };
  assert.deepEqual(K.validaScelte({ ...base, ambito: 'domande' }), { ok: true, scelte: { urgenza: 30, modello: 'opus', sforzo: 'high', ambito: 'domande' } });
  assert.equal(K.validaScelte({ ...base, ambito: 'notizie' }).ok, true, 'un nome che il codice non conosce lo decide il server');
  assert.equal(K.validaScelte({ ...base, ambito: 'posta' }).ok, false, 'uno iniziale non ancora attivo no');
  assert.equal(K.validaScelte({ ...base, ambito: 'posta' }, undefined, { spenti: true }).ok, true, 'un ricorrente può aspettarlo');
  assert.equal(K.validaScelte({ ...base, ambito: 'Non Valido!' }, undefined, { spenti: true }).ok, false);
  assert.equal(K.validaScelte({ ...base, ambito: 'notizie' }, ['lavoro', 'server']).testo, 'Ambito fra lavoro, server.');
  assert.equal(K.validaScelte({ ...base, ambito: 'coda' }, ['coda']).ok, true);
  assert.equal(K.validaScelte({ ...base, urgenza: 100, ambito: 'coda' }).ok, false);
  assert.equal(K.validaNuovo({ titolo: 'x', urgenza: 5, ambito: 'domande' }).ok, true, 'un compito a mano prende ogni ambito attivo');
  assert.equal(K.validaNuovo({ titolo: 'x', urgenza: 5, ambito: 'domande' }, ['lavoro']).ok, false);
  assert.equal(K.frase('il ricorrente vuole un nome'), 'Il ricorrente vuole un nome.');
  assert.equal(K.frase('Già detto.'), 'Già detto.');
  assert.equal(K.frase(''), '');
});

test('costo: la somma delle chiamate che ne dichiarano uno; nessuna = non si sa, non zero', () => {
  assert.equal(K.costoTotale(fase({ biglietti: [{ costo: 1.2 }, { costo: null }, { costo: 0.35 }] })), 1.55);
  assert.equal(K.costoTotale(fase({ biglietti: [{ costo: null }] })), null);
  assert.equal(K.costoTotale(fase({ biglietti: [{ costo: 0 }] })), 0);
  assert.equal(K.costoTesto(1.5), '1,50 $');
  assert.equal(K.costoTesto(null), '');
  assert.equal(K.costoTesto(0.004), 'meno di 0,01 $', 'un costo vero non si scrive zero');
  assert.equal(K.costoTesto(1.5, true), 'almeno 1,50 $');
  assert.equal(K.costoParziale(fase({ biglietti: [{ costo: 1 }, { costo: null }] })), true);
  assert.equal(K.costoParziale(fase({ biglietti: [{ costo: 1 }], bigliettiTolti: 3 })), true, 'le chiamate non tenute non hanno un costo qui');
  assert.equal(K.costoParziale(fase({ biglietti: [{ costo: 1 }] })), false);
});

test('modelli e sforzi sono quelli di Automazioni: una scelta nuova arriva anche qui', () => {
  require(join(ROOT, 'src', 'shared', 'routineModelli.js'));
  const RM = globalThis.SN_ROUTINE_MODELLI;
  assert.deepEqual([...K.MODELLI], RM.SCELTE.model.map((s) => s.id));
  assert.deepEqual([...K.SFORZI], RM.SCELTE.effort.map((s) => s.id));
});

test('durate, modello e urgenza detti per l\'owner', () => {
  assert.equal(K.durataTesto(40e3), '40 s');
  assert.equal(K.durataTesto(12 * 60e3), '12 min');
  assert.equal(K.durataTesto(185 * 60e3), '3 h 05');
  assert.equal(K.durataTesto(-1), '');
  assert.equal(K.modelloTesto('opus', 'high'), 'opus · high');
  assert.match(K.modelloTesto('', ''), /agente/);
  assert.equal(K.urgenzaTesto(fase({ figlio: true, fiducia: 'non_fidato' })), 'Urgenza 38: priorità 2, verifica, non fidato, figlio di un altro feedback');
  assert.match(K.urgenzaTesto({ tipo: 'manuale', urgenza: 45 }), /chi l'ha creato/);
});

test('dividi: in corso a parte, gli aperti restano nell\'ordine del server', () => {
  const d = K.dividi({ aperti: [fase({ id: 'a' }), fase({ id: 'b', stato: 'in_corso' }), fase({ id: 'c' })], storico: [fase({ id: 'z', stato: 'fatto' })] });
  assert.deepEqual([d.inAttesa.map((c) => c.id), d.inCorso.map((c) => c.id), d.storico.map((c) => c.id)], [['a', 'c'], ['b'], ['z']]);
  assert.deepEqual(K.dividi(null), { inAttesa: [], inCorso: [], storico: [] });
});

test('un compito scritto a mano: le stesse regole del server, rifiutate col numero', () => {
  assert.deepEqual(K.validaNuovo({ titolo: ' Esplora ', istruzioni: ' x ', urgenza: '45', modello: 'sonnet', sforzo: '' }),
    { ok: true, compito: { titolo: 'Esplora', istruzioni: 'x', urgenza: 45, modello: 'sonnet', sforzo: '', ambito: 'lavoro' } });
  assert.match(K.validaNuovo({ titolo: '   ', urgenza: 5 }).testo, /titolo/);
  assert.match(K.validaNuovo({ titolo: 'x'.repeat(301), urgenza: 5 }).testo, /301.*300/);
  assert.match(K.validaNuovo({ titolo: 'x', istruzioni: 'y'.repeat(40001), urgenza: 5 }).testo, /40001.*40000/);
  for (const u of ['', '4.5', 'tanto', 100, -1, null]) assert.equal(K.validaNuovo({ titolo: 'x', urgenza: u }).ok, false, String(u));
  assert.equal(K.validaNuovo({ titolo: 'x', urgenza: 0 }).ok, true);
  assert.equal(K.validaNuovo({ titolo: 'x', urgenza: 5, modello: 'gpt-5' }).ok, false);
  assert.equal(K.validaNuovo({ titolo: 'x', urgenza: 5, sforzo: 'altissimo' }).ok, false);
  assert.equal(K.validaNuovo({ titolo: 'x', urgenza: 5, ambito: 'posta' }).ok, false);
  assert.equal(K.validaNuovo({ titolo: '<img src=x onerror=alert(1)>', urgenza: 5 }).ok, true, 'il testo è testo: chi lo mostra usa textContent');
});

test('le regole Firestore chiudono compiti e indice a ogni client, owner compreso', () => {
  const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  for (const p of ['/compiti/{id}', '/compiti-indice/{id}']) {
    const i = RULES.indexOf(`match ${p} {`);
    assert.ok(i >= 0, `manca il blocco ${p}`);
    const apre = i + `match ${p} {`.length;
    const corpo = RULES.slice(apre, RULES.indexOf('}', apre)).replace(/\/\/[^\n]*/g, '').trim();
    assert.equal(corpo, 'allow read, write: if false;', p);
  }
  assert.equal([...RULES.matchAll(/match\s+\/compiti\//g)].length, 1, 'un solo blocco apre i compiti');
});

// ── La porta del main ────────────────────────────────────────────────────────

let server;
let rispondi = () => ({ status: 200, body: { result: { ok: true } } });
let ricevute = [];
let handlers;
let MSG;
let admin = true;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      ricevute.push({ path: req.url, data });
      const r = rispondi(data);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FILO_FUNCTIONS_BASE = `http://127.0.0.1:${server.address().port}`;
  const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      isSignedIn: () => true, isAdmin: () => admin, getIdToken: async () => 'token-di-prova',
      getProfile: () => ({ email: 'owner@esempio' }), getUid: async () => 'uid-owner', getAccessToken: async () => '',
      onChange: () => () => {},
    },
  };
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  MSG = globalThis.SN_MSG.MSG;
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {} });
});

after(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  await new Promise((r) => server.close(r));
});

function chiama(msg, origine = 'filo://manage/manage.html', mittente = { isShell: true }) {
  const h = handlers.get(msg.type);
  assert.ok(h, `il main non registra ${msg.type}`);
  ricevute = [];
  return h(msg, mittente, origine);
}

test('elenco: va a ownerCompiti con la pagina chiesta e torna con aperti, storico, «altri» e ambiti', async () => {
  const ambiti = A.elenco();
  rispondi = () => ({ status: 200, body: { result: { ok: true, aperti: [fase()], storico: [], altri: true, adesso: 5, ambiti } } });
  const r = await chiama({ type: MSG.COMPITI_ELENCO, storico: 100, prima: 1234 });
  assert.deepEqual(ricevute.map((x) => [x.path, x.data]), [['/ownerCompiti', { op: 'elenco', storico: 100, prima: 1234 }]]);
  assert.deepEqual([r.ok, r.aperti.length, r.storico.length, r.altri, r.adesso], [true, 1, 0, true, 5]);
  assert.deepEqual(r.ambiti, ambiti);
});

test('crea: il main rifiuta prima del server quello che il server rifiuterebbe; il resto passa ripulito', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, id: 'C-9', numero: 9 } } });
  const no = await chiama({ type: MSG.COMPITO_CREA, compito: { titolo: '', urgenza: 5 } });
  assert.equal(no.ok, false);
  assert.equal(ricevute.length, 0, 'niente chiamata per un compito storto');
  const r = await chiama({ type: MSG.COMPITO_CREA, compito: { titolo: ' Esplora ', urgenza: '30', modello: 'haiku', extra: 'x' } });
  assert.deepEqual(r, { ok: true, id: 'C-9' });
  assert.deepEqual(ricevute[0].data, { op: 'crea', compito: { titolo: 'Esplora', istruzioni: '', urgenza: 30, modello: 'haiku', sforzo: '', ambito: 'lavoro' } });
  assert.equal('sessione' in ricevute[0].data, false, 'dalla finestra scrive l’owner');
});

test('annulla e gli errori del server detti per l\'owner', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, id: 'C-3' } } });
  assert.deepEqual(await chiama({ type: MSG.COMPITO_ANNULLA, id: 'C-3' }), { ok: true, id: 'C-3' });
  assert.equal((await chiama({ type: MSG.COMPITO_ANNULLA, id: 'tutti' })).ok, false);
  rispondi = () => ({ status: 400, body: { error: { status: 'FAILED_PRECONDITION', message: 'C-3 ha un agente al lavoro: finisce il suo tentativo' } } });
  assert.deepEqual(await chiama({ type: MSG.COMPITO_ANNULLA, id: 'C-3' }), { ok: false, error: 'C-3 ha un agente al lavoro: finisce il suo tentativo' });
  rispondi = () => ({ status: 404, body: {} });
  assert.match((await chiama({ type: MSG.COMPITI_ELENCO })).error, /non sono ancora pubblicati/);
});

const RICORRENTE = { nome: ' Revisione delle domande ', testo: ' Leggi le domande. ', giorni: [3, 1, 1], ora: '06:00', ambito: 'domande', urgenza: '30', modello: 'opus', sforzo: 'high', attivo: true, domandaFineTurno: '', extra: 'x' };
const PULITO = { nome: 'Revisione delle domande', testo: 'Leggi le domande.', giorni: [1, 3], ora: '06:00', ambito: 'domande', urgenza: 30, modello: 'opus', sforzo: 'high', attivo: true, domandaFineTurno: '' };

test('ricorrenti: l\'elenco va a ownerCompiti e torna coi ricorrenti, gli ambiti e l\'ora del server', async () => {
  const ambiti = A.elenco();
  rispondi = () => ({ status: 200, body: { result: { ok: true, adesso: 7, ricorrenti: [{ id: 'r1', nome: 'x' }], ambiti } } });
  const r = await chiama({ type: MSG.RICORRENTI_ELENCO });
  assert.deepEqual(ricevute.map((x) => [x.path, x.data]), [['/ownerCompiti', { op: 'ricorrenti' }]]);
  assert.deepEqual(r, { ok: true, adesso: 7, ricorrenti: [{ id: 'r1', nome: 'x' }], ambiti });
  rispondi = () => ({ status: 200, body: { result: { ok: true } } });
  assert.deepEqual(await chiama({ type: MSG.RICORRENTI_ELENCO }), { ok: true, adesso: 0, ricorrenti: [], ambiti: [] }, 'una risposta monca non diventa un errore della pagina');
});

test('ricorrenti: il salvataggio rifiuta prima del server quello che il server rifiuterebbe; il resto passa ripulito', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, id: 'r9' } } });
  for (const [storto, attesa] of [
    [{ ...RICORRENTE, nome: '  ' }, /^Il ricorrente vuole un nome\.$/],
    [{ ...RICORRENTE, testo: 'x'.repeat(40001) }, /40001.*40000/],
    [{ ...RICORRENTE, giorni: [] }, /almeno un giorno/],
    [{ ...RICORRENTE, ora: '6:00' }, /06:30/],
    [{ ...RICORRENTE, urgenza: 100 }, /da 0 a 99/],
    [{ ...RICORRENTE, modello: 'gpt-5' }, /Modello fra/],
    [{ ...RICORRENTE, ambito: 'Non Valido!' }, /non è fra quelli/],
    [{ ...RICORRENTE, id: '../tutti' }, /identificativo/],
    [null, /oggetto/],
  ]) {
    const r = await chiama({ type: MSG.RICORRENTE_SALVA, ricorrente: storto });
    assert.equal(r.ok, false, JSON.stringify(storto).slice(0, 80));
    assert.match(r.error, attesa);
    assert.equal(ricevute.length, 0, 'niente chiamata per un ricorrente storto');
  }
  assert.deepEqual(await chiama({ type: MSG.RICORRENTE_SALVA, ricorrente: RICORRENTE }), { ok: true, id: 'r9' });
  assert.deepEqual(ricevute[0].data, { op: 'ricorrente_salva', ricorrente: PULITO }, 'un ricorrente nuovo va senza id');
  rispondi = () => ({ status: 200, body: { result: { ok: true } } });
  assert.deepEqual(await chiama({ type: MSG.RICORRENTE_SALVA, ricorrente: { ...RICORRENTE, id: 'r1', ambito: 'posta', attivo: false } }), { ok: true, id: 'r1' });
  assert.deepEqual(ricevute[0].data, { op: 'ricorrente_salva', ricorrente: { ...PULITO, id: 'r1', ambito: 'posta', attivo: false } }, 'un ambito non ancora attivo vale: il ricorrente lo aspetta');
});

test('ricorrenti: togli e avvia portano l\'id; gli errori del server arrivano con la sua frase', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true } } });
  assert.deepEqual(await chiama({ type: MSG.RICORRENTE_TOGLI, id: 'r1' }), { ok: true, id: 'r1' });
  assert.deepEqual(ricevute[0].data, { op: 'ricorrente_togli', id: 'r1' });
  rispondi = () => ({ status: 200, body: { result: { ok: true, compitoId: 'C-14' } } });
  assert.deepEqual(await chiama({ type: MSG.RICORRENTE_AVVIA, id: 'r1' }), { ok: true, id: 'r1', compitoId: 'C-14' });
  assert.deepEqual(ricevute[0].data, { op: 'ricorrente_avvia', id: 'r1' });
  for (const t of [MSG.RICORRENTE_TOGLI, MSG.RICORRENTE_AVVIA]) {
    assert.equal((await chiama({ type: t, id: '' })).ok, false, t);
    assert.equal((await chiama({ type: t, id: 'a/b' })).ok, false, t);
    assert.equal(ricevute.length, 0);
  }
  rispondi = () => ({ status: 400, body: { error: { status: 'FAILED_PRECONDITION', message: 'r1 ha già un’istanza al lavoro', details: { reason: 'in_corso' } } } });
  assert.deepEqual(await chiama({ type: MSG.RICORRENTE_AVVIA, id: 'r1' }), { ok: false, error: 'r1 ha già un’istanza al lavoro' });
  rispondi = () => ({ status: 200, body: { result: { ok: false, errore: 'ricorrente_inesistente', dettaglio: 'il ricorrente r1 non c’è più' } } });
  assert.deepEqual(await chiama({ type: MSG.RICORRENTE_TOGLI, id: 'r1' }), { ok: false, error: 'il ricorrente r1 non c’è più' });
  // Un server più vecchio dell'app non conosce le op dei ricorrenti: lo si dice, non «op fra elenco, crea, annulla».
  rispondi = () => ({ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'op fra elenco, crea, annulla', details: { reason: 'op_sconosciuta' } } } });
  assert.match((await chiama({ type: MSG.RICORRENTI_ELENCO })).error, /ricorrenti non sono ancora sul server/);
  assert.match((await chiama({ type: MSG.RICORRENTE_SALVA, ricorrente: RICORRENTE })).error, /ricorrenti non sono ancora sul server/);
  rispondi = () => ({ status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'Riservato al proprietario.' } } });
  assert.match((await chiama({ type: MSG.RICORRENTI_ELENCO })).error, /serve quello del proprietario/);
});

test('le porte dei compiti e dei ricorrenti rispondono solo alle pagine di Filo, e solo all\'owner', async () => {
  const porte = [{ type: MSG.COMPITI_ELENCO }, { type: MSG.COMPITO_CREA, compito: { titolo: 'x', urgenza: 5 } }, { type: MSG.COMPITO_ANNULLA, id: 'C-1' },
    { type: MSG.RICORRENTI_ELENCO }, { type: MSG.RICORRENTE_SALVA, ricorrente: RICORRENTE }, { type: MSG.RICORRENTE_TOGLI, id: 'r1' }, { type: MSG.RICORRENTE_AVVIA, id: 'r1' }];
  for (const msg of porte) {
    const r = await chiama(msg, 'https://esempio.it/', {});
    assert.equal(r.ok, false, msg.type);
  }
  assert.equal(ricevute.length, 0);
  admin = false;
  try {
    for (const msg of porte) assert.equal((await chiama(msg)).code, 'not_admin', msg.type);
  } finally {
    admin = true;
  }
  assert.equal(ricevute.length, 0);
});

// ── Lo script della sessione locale ──────────────────────────────────────────

test('compito.mjs: la sessione si dichiara col suo biglietto, rifiuta prima di chiamare, e si sporca leggendo titoli non fidati', async () => {
  const { esegui, leggiArgomenti } = await import('../../scripts/compito.mjs');
  assert.deepEqual(leggiArgomenti(['crea', '--titolo', 'Esplora', '--urgenza=30', '--ambito', 'server']), { cmd: 'crea', compito: { urgenza: '30', titolo: 'Esplora', ambito: 'server' } });
  assert.ok(leggiArgomenti(['crea']).errore, 'senza titolo');
  assert.ok(leggiArgomenti(['annulla', 'D-3']).errore);
  const chiamate = [];
  const out = [];
  const io = (risposta, biglietto = 'segreto') => ({
    chiama: async (d) => { chiamate.push(d); return risposta; },
    bigliettoLocale: async () => biglietto,
    sporca: async (cosa, motivi) => `SPORCA ${cosa}: ${motivi.join(';')}`,
    stdin: async () => 'dallo stdin',
    scrivi: (s) => out.push(s), errore: (s) => out.push(`E:${s}`),
  });
  assert.equal(await esegui(['crea', '--titolo', 'Esplora', '--istruzioni', '-', '--modello', 'haiku'], io({ ok: true, id: 'C-4', fiducia: 'fidato' })), 0);
  assert.deepEqual(chiamate.pop(), { op: 'crea', compito: { titolo: 'Esplora', istruzioni: 'dallo stdin', urgenza: 45, modello: 'haiku', sforzo: '', ambito: 'lavoro' }, sessione: true, biglietto: 'segreto' });
  assert.match(out.pop(), /C-4 creato \(fidato\)/);
  assert.equal(await esegui(['crea', '--titolo', 'x', '--urgenza', '500'], io({})), 1);
  assert.equal(chiamate.length, 0, 'un’urgenza fuori scala non parte');
  assert.equal(await esegui(['annulla', 'C-4'], io({ ok: true }, '')), 0);
  assert.deepEqual(chiamate.pop(), { op: 'annulla', id: 'C-4', sessione: true }, 'anche senza biglietto la sessione non scrive come owner');
  const elenco = { aperti: [fase(), { id: 'C-9', tipo: 'manuale', titolo: 'testo\u001b[31m esterno', fiducia: 'non_fidato', stato: 'aperto', aperto: true, urgenza: 30, biglietti: [] }], storico: [] };
  assert.equal(await esegui(['elenco'], io(elenco)), 0);
  assert.ok(out.some((s) => s.startsWith('E:SPORCA elenco dei compiti') && s.includes('C-9')), out.join('\n'));
  const stampa = out[out.length - 1];
  assert.match(stampa, /#1196 · verifica/);
  assert.doesNotMatch(stampa, /\u001b/, 'i caratteri di controllo si vedono, non agiscono');
});
