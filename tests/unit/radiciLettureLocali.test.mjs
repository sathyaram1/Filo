// #1918: in una sessione locale chi legge dice al server COSA ha letto, e il server ne legge le radici; una
// conversazione scritta da biglietti puliti non sporca. Le regole del server stanno in filo-security (radiciLetture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { motiviDiLettura, sporca, rigaSporco, cartellaSporchi, ENV_FILE, LETTI_PER_CHIAMATA } from '../../scripts/lib/biglietto-locale.mjs';
import { radiceLettura } from '../../scripts/lib/letture-esterne.mjs';
import { lettiDi, fidatePerTimbri } from '../../scripts/domanda.mjs';

const TURNO_ROUTINE = "--- Aggiornamento dell'agente del 1/11/2026 ---\nReport del lavoro.";

function biglietto() {
  const dir = cartellaTemporanea('radici-locali-');
  const file = join(dir, 'biglietto.json');
  writeFileSync(file, JSON.stringify({ ticket: 'x'.repeat(40), fp: 'f'.repeat(64), natoIl: 1 }));
  return { dir, file, b: { path: file, fp: 'f'.repeat(64) } };
}

function server(risposta) {
  const mandati = [];
  const fetchImpl = async (_url, init) => {
    mandati.push(JSON.parse(init.body).data);
    return { ok: true, status: 200, json: async () => ({ result: Object.assign({ ok: true }, risposta) }) };
  };
  return { mandati, deps: { fetchImpl, idToken: async () => 'token-finto' } };
}

test('la conversazione: scritta da biglietti puliti non sporca; senza saperlo, il dubbio resta e decide il server', () => {
  assert.deepEqual(motiviDiLettura({ fiducia: 'fidato', notes: TURNO_ROUTINE, scrittoSporco: false }), []);
  assert.deepEqual(motiviDiLettura({ fiducia: 'fidato', notes: TURNO_ROUTINE }), ['conversazione con scritti di routine o sessioni']);
  assert.deepEqual(motiviDiLettura({ fiducia: 'fidato', notes: '', scrittoSporco: true }), ['conversazione con scritti di routine o sessioni']);
  assert.deepEqual(motiviDiLettura({ fiducia: 'non_fidato', notes: '' }), ['testo di un feedback non fidato']);
});

test('chi legge nomina cosa ha letto: al server vanno le letture e le radici, mai solo il motivo', async () => {
  const { dir, file } = biglietto();
  const s = server({ fiducia: 'non_fidato' });
  const r = await sporca('letto #1500: testo di un feedback non fidato', {
    env: { [ENV_FILE]: file }, cwd: dir, radici: ['feedback:1500'], letti: [{ tipo: 'feedback', id: 'abc' }, { tipo: 'feedback', id: 'abc' }], deps: s.deps,
  });
  assert.equal(r.sporcati, 1);
  const d = s.mandati.find((x) => x.op === 'sporca');
  assert.deepEqual(d.radici, ['feedback:1500']);
  assert.deepEqual(d.letti, [{ tipo: 'feedback', id: 'abc' }]);
  assert.equal(d.senzaCosa, undefined);
});

test('se il server dice che era tutto fidato la sessione non si dice sporca, e non resta il segno di sporco', async () => {
  const { dir, file, b } = biglietto();
  const s = server({ fiducia: 'fidato', pulito: true });
  const riga = await rigaSporco('letto #1500', ['conversazione con scritti di routine o sessioni'], {
    env: { [ENV_FILE]: file }, cwd: dir, letti: [{ tipo: 'feedback', id: 'abc' }], deps: s.deps,
  });
  assert.match(riga, /NON sporcato: letto #1500 viene da testo fidato/);
  const resti = existsSync(cartellaSporchi(b)) ? readdirSync(cartellaSporchi(b)) : [];
  assert.deepEqual(resti, [], 'niente annotazioni in attesa e niente segno «sporco sul server»');
});

test('una lettura che non dice cosa ha letto lo dichiara: il server le dà la radice del biglietto', async () => {
  const { dir, file } = biglietto();
  const s = server({ fiducia: 'non_fidato' });
  await sporca('ho letto una cosa', { env: { [ENV_FILE]: file }, cwd: dir, deps: s.deps });
  assert.equal(s.mandati.find((x) => x.op === 'sporca').senzaCosa, true);
});

test('il gancio sa dire la radice di una pagina, di una ricerca, di un server MCP e di un file fuori dal repo', () => {
  assert.equal(radiceLettura({ tool_name: 'WebFetch', tool_input: { url: 'https://esempio.it/a?b=1' } }), 'web:https://esempio.it/a?b=1');
  assert.equal(radiceLettura({ tool_name: 'WebFetch', tool_input: { url: 'file:///etc/passwd' } }), '');
  assert.equal(radiceLettura({ tool_name: 'WebSearch', tool_input: { query: 'prezzo pizza' } }), 'web:ricerca prezzo pizza');
  assert.equal(radiceLettura({ tool_name: 'mcp__claude-in-chrome__navigate', tool_input: {} }), 'mcp:claude-in-chrome');
  assert.equal(radiceLettura({ tool_name: 'Read', tool_input: { file_path: '/altrove/nota.txt' } }, { cwd: '/' }), 'file:/altrove/nota.txt');
  assert.equal(radiceLettura({ tool_name: 'Artifact', tool_input: { action: 'read' } }), '');
});

test('le domande lette si nominano col loro numero; un id che non è una domanda non passa', () => {
  assert.deepEqual(lettiDi(['D-12', '?', 'D-x', 'D-3']), [{ tipo: 'domanda', id: 'D-12' }, { tipo: 'domanda', id: 'D-3' }]);
});

// Ogni strada che stampa testo nomina al server cosa ha stampato: se una smettesse, la sessione prenderebbe la radice
// del solo biglietto, e il timbro sul testo vero non la ripulirebbe più.
function spia() {
  const sporcate = [];
  return { sporcate, sporca: async (cosa, motivi, opts = {}) => { sporcate.push({ cosa, letti: opts.letti }); return 'sporcato'; } };
}
const D_NF = { id: 'D-2', numero: 2, titolo: 'Nata da un utente', priorita: 'importante', stato: 'aperta', fiducia: 'non_fidato', opzioni: [], conversazione: [] };
const D_F = { id: 'D-1', numero: 1, titolo: 'Fidata', priorita: 'importante', stato: 'aperta', fiducia: 'fidato', opzioni: [], conversazione: [] };

test('elenco, stampa e registro delle domande nominano al server le sole non fidate che stampano', async () => {
  const { esegui } = await import('../../scripts/domanda.mjs');
  const base = { biglietto: async () => '', bigliettoLocale: async () => '', scrivi: () => {}, errore: () => {} };
  const casi = [
    [['elenco'], { domande: [D_F, D_NF] }],
    [['mostra', 'D-2'], { domanda: D_NF }],
    [['registro', 'pizza'], { voci: [{ id: 'D-1', titolo: 't', principio: 'p', fiducia: 'fidato' }, { id: 'D-2', titolo: 't', principio: 'p', fiducia: 'non_fidato' }] }],
  ];
  for (const [argv, risposta] of casi) {
    const s = spia();
    assert.equal(await esegui(argv, Object.assign({}, base, { chiama: async () => Object.assign({ ok: true }, risposta), sporca: s.sporca })), 0, argv[0]);
    assert.deepEqual(s.sporcate.map((x) => x.letti), [[{ tipo: 'domanda', id: 'D-2' }]], argv[0]);
  }
});

test('l’elenco dei compiti nomina al server i soli compiti non fidati', async () => {
  const { esegui } = await import('../../scripts/compito.mjs');
  const s = spia();
  const elenco = { ok: true, aperti: [
    { id: 'C-8', tipo: 'manuale', titolo: 'pulito', fiducia: 'fidato', stato: 'aperto', aperto: true, urgenza: 30, biglietti: [] },
    { id: 'C-9', tipo: 'manuale', titolo: 'esterno', fiducia: 'non_fidato', stato: 'aperto', aperto: true, urgenza: 30, biglietti: [] },
  ], storico: [] };
  assert.equal(await esegui(['elenco'], { chiama: async () => elenco, bigliettoLocale: async () => 's', sporca: s.sporca, scrivi: () => {}, errore: () => {} }), 0);
  assert.deepEqual(s.sporcate.map((x) => x.letti), [[{ tipo: 'compito', id: 'C-9' }]]);
});

test('il gancio annota la radice della pagina letta accanto al biglietto, non solo il motivo', async () => {
  const { gancio } = await import('../../scripts/lib/letture-esterne.mjs');
  const { dir, file, b } = biglietto();
  const avviati = [];
  const r = gancio({ input: { tool_name: 'WebFetch', tool_input: { url: 'https://esempio.it/listino' }, cwd: dir }, env: { [ENV_FILE]: file }, avvia: (p) => avviati.push(p) });
  assert.equal(r.esito, 'annotato', JSON.stringify(r));
  const voci = readdirSync(cartellaSporchi(b)).map((n) => JSON.parse(readFileSync(join(cartellaSporchi(b), n), 'utf8')));
  assert.deepEqual(voci.flatMap((v) => v.radici || []), ['web:https://esempio.it/listino']);
});

test('mille domande lette in una volta partono a pezzi sotto il tetto del server, e pulito vale solo se lo sono tutti', async () => {
  const { file } = biglietto();
  const { mandati, deps } = server({ fiducia: 'fidato', pulito: true });
  const letti = Array.from({ length: 1000 }, (_, i) => ({ tipo: 'domanda', id: `D-${i + 1}` }));
  const r = await sporca('elenco delle domande', { env: { [ENV_FILE]: file }, deps, letti });
  assert.equal(mandati.length, Math.ceil(1000 / LETTI_PER_CHIAMATA));
  assert.ok(mandati.every((m) => m.letti.length <= LETTI_PER_CHIAMATA));
  assert.equal(mandati.flatMap((m) => m.letti).length, 1000);
  assert.equal(r.puliti, 1);
  assert.deepEqual(r.errori, []);
});

test('le domande fidate per timbri si nominano anche loro: il timbro tolto dopo raggiunge la sessione che le ha lette', () => {
  const domande = [
    { id: 'D-1', fiducia: 'fidato', radici: ['legacy'] },
    { id: 'D-2', fiducia: 'fidato', radici: [] },
    { id: 'D-3', fiducia: 'fidato', radici: ['feedback:40'], fidataDallOwner: { il: 1 } },
    { id: 'D-4', fiducia: 'non_fidato', radici: ['feedback:41'] },
  ];
  assert.deepEqual(fidatePerTimbri(domande), ['D-1']);
});
