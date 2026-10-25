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
require(join(ROOT, 'src', 'shared', 'compiti.js'));
const K = globalThis.SN_COMPITI;

const fase = (extra) => Object.assign({ id: 'C-3', tipo: 'fase', feedbackNum: '#1196', fase: 'verifica', stato: 'aperto', aperto: true, urgenza: 38, priorita: 2, fiducia: 'fidato', figlio: false, biglietti: [] }, extra);

test('etichetta: «#N · fase» per un compito di un feedback, «C-n · titolo» per uno scritto a mano', () => {
  assert.equal(K.etichetta(fase()), '#1196 · verifica');
  assert.equal(K.etichetta(fase({ fase: 'controllo', feedbackNum: '#7.2' })), '#7.2 · controllo cieco');
  assert.equal(K.etichetta(fase({ fase: 'primo' })), '#1196 · primo lavoro');
  assert.equal(K.etichetta({ id: 'C-12', tipo: 'manuale', titolo: '  Guarda i log  ' }), 'C-12 · Guarda i log');
  assert.equal(K.etichetta({ id: 'C-12', tipo: 'manuale', titolo: '' }), 'C-12');
  assert.equal(K.etichetta(null), '');
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
      isSignedIn: () => true, isAdmin: () => true, getIdToken: async () => 'token-di-prova',
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

test('elenco: va a ownerCompiti con la pagina chiesta e torna con aperti, storico e «altri»', async () => {
  rispondi = () => ({ status: 200, body: { result: { ok: true, aperti: [fase()], storico: [], altri: true, adesso: 5 } } });
  const r = await chiama({ type: MSG.COMPITI_ELENCO, storico: 100, prima: 1234 });
  assert.deepEqual(ricevute.map((x) => [x.path, x.data]), [['/ownerCompiti', { op: 'elenco', storico: 100, prima: 1234 }]]);
  assert.deepEqual([r.ok, r.aperti.length, r.storico.length, r.altri, r.adesso], [true, 1, 0, true, 5]);
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

test('le porte dei compiti rispondono solo alle pagine di Filo', async () => {
  for (const msg of [{ type: MSG.COMPITI_ELENCO }, { type: MSG.COMPITO_CREA, compito: { titolo: 'x', urgenza: 5 } }, { type: MSG.COMPITO_ANNULLA, id: 'C-1' }]) {
    const r = await chiama(msg, 'https://esempio.it/', {});
    assert.equal(r.ok, false, msg.type);
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
