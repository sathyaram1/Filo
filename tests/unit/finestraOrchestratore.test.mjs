// La finestra dell'orchestratore nei rapporti di fine sessione (scripts/session-report.mjs): ogni suo turno sta in
// UN rapporto, dall'ultimo rapporto arrivato al server alla consegna in corso (#1116, #1170). Transcript sintetici
// con la forma vera: un worker è un sotto-agente in <sessione>/subagents/, il suo rilascio una chiamata Bash.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const {
  generaRapporto, rapportoChiusura, riassuntoChiusura, finestraOrchestratore, eRilascio, consegnaRapporto, rapportoArrivato,
  analizzaRighe, cartelleTranscript, trovaTranscript, slugProgetto,
} = await import('../../scripts/session-report.mjs');

const H = (s) => `2026-10-07T${s}.000Z`;
const ms = (s) => Date.parse(H(s));
const riga = (sessionId, id, ts, { cw = 0, cr = 0, out = 10, tools = null, model = 'claude-opus-5-5' } = {}) => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId,
  message: { id, model, usage: { input_tokens: 0, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out }, content: tools || [{ type: 'text', text: id }] },
});
const orch = (id, ts, o = {}) => riga('orch', id, ts, o);
const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
const agente = (id) => ({ type: 'tool_use', id, name: 'Agent', input: { subagent_type: 'routine-worker', prompt: 'p' } });
const esito = (id, ts, testo, { sessionId = 'orch', errore = false } = {}) => JSON.stringify({
  type: 'user', timestamp: ts, sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: errore, content: testo }] },
});
const RILASCIO = 'node "/tmp/filo-strumenti/scripts/routine-channel.mjs" release tkt --role resolver';
const RILASCIO_ORCH = 'node "/tmp/filo-strumenti/scripts/routine-channel.mjs" release tkt --role orchestrator';
const RISPOSTA = 'node "/tmp/filo-strumenti/scripts/routine-channel.mjs" risposta "<parola-d-ordine>" c9 <<\'FINE\'\nniente\nFINE';
const OK = 'ramo \'worker/x\' spedito su origin\nOK: biglietto rilasciato.';
const lanciato = (id, ts, agentId = 'x') => esito(id, ts, [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${agentId}` }]);
const notifica = (ts, id, agentId = 'x', nota = '') => {
  const s = `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n<summary>Agent "w" finished</summary>${nota}\n<result>FATTO</result>\n</task-notification>`;
  return [JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: ts, content: s }), JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: s } })];
};
// La consegna del worker (SubagentHandback) com'è arrivata in un thread principale vero il 18/10/2026.
const consegna = (ts, agentId) => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: `Another Claude session sent a message: <agent-message from="${agentId}">\n[Subagent hand-back] The text below is the final report of a subagent.\n  FATTO\n</agent-message>` } });
/** Un worker che lavora e rilascia; `esitoRilascio` null = il comando sta ancora girando (il rapporto nasce lì). */
const lavoro = (w, inizio, rilascio, { esitoRilascio = OK, comando = RILASCIO } = {}) => [
  riga(w, `${w}-a`, inizio, { cw: 25000 }),
  riga(w, `${w}-r`, rilascio, { cr: 25000, tools: [bash(`rel-${w}`, comando)] }),
  ...(esitoRilascio === null ? [] : [esito(`rel-${w}`, rilascio.replace(/\.000Z$/, '.900Z'), esitoRilascio, { sessionId: w })]),
];
const ids = (f) => f.righe.map((l) => JSON.parse(l)).filter((e) => e.type === 'assistant').map((e) => e.message.id);

function scena(principale, lavori = {}) {
  const base = cartellaTemporanea('filo-finestra-orch-');
  const sub = join(base, 'orch', 'subagents');
  mkdirSync(sub, { recursive: true });
  const main = join(base, 'orch.jsonl');
  writeFileSync(main, principale.join('\n') + '\n');
  const file = {};
  for (const [w, righe] of Object.entries(lavori)) {
    file[w] = join(sub, `agent-${w}.jsonl`);
    writeFileSync(file[w], righe.join('\n') + '\n');
    writeFileSync(join(sub, `agent-${w}.meta.json`), JSON.stringify({ agentType: 'routine-worker', spawnDepth: 1 }));
  }
  return { base, main, file };
}

// Il thread principale di un giro: due worker, un rilascio fatto dall'orchestratore per il secondo, morto, e il terzo
// lanciato. I worker 1 e 2 non hanno transcript qui: i loro rilasci arrivano come `confini`.
const PRINCIPALE = [
  orch('o1', H('09:00:00'), { cw: 30000 }),
  orch('o2', H('09:01:00'), { cr: 30000, tools: [agente('ag1')] }),
  esito('ag1', H('09:30:00'), 'fatto'),
  orch('o3', H('09:30:10'), { cr: 31000, cw: 2000 }),
  orch('o4', H('09:31:00'), { cr: 33000, tools: [agente('ag2')] }),
  esito('ag2', H('11:00:00'), 'fatto'),
  orch('o5', H('11:00:30'), { cw: 34000, tools: [bash('b1', RILASCIO_ORCH)] }),
  esito('b1', H('11:01:00'), OK),
  orch('o6', H('11:02:00'), { cr: 34000, cw: 1000 }),
  orch('o7', H('11:03:00'), { cr: 35000, tools: [agente('ag3')] }),
];

test('la finestra va dall\'ultimo rapporto arrivato alla consegna in corso, non dalla fine del worker', () => {
  assert.deepEqual(ids(finestraOrchestratore(PRINCIPALE)), ['o6', 'o7'], 'dopo il rilascio dell\'orchestratore');
  assert.equal(finestraOrchestratore(PRINCIPALE).attesaPrimaS, 90, 'da o5 a o6');
  assert.deepEqual(ids(finestraOrchestratore(PRINCIPALE.slice(0, 2))), ['o1', 'o2'], 'primo worker: dall\'inizio della sessione');
  // Il worker 1 ha rilasciato alle 09:29, il worker 2 rilascerebbe alle 10:59: il suo rapporto ha o3 e o4.
  const secondo = finestraOrchestratore(PRINCIPALE.slice(0, 6), { confini: [ms('09:29:00')], fine: ms('10:59:00') });
  assert.deepEqual(ids(secondo), ['o3', 'o4']);
  assert.equal(secondo.attesaPrimaS, 1750, 'o3 riscalda dopo 29 minuti');
  assert.equal(secondo.continua, true);
  // Un rilascio del worker 1 dopo la fine della chiamata (la notifica arriva prima della consegna) non cambia niente.
  assert.deepEqual(ids(finestraOrchestratore(PRINCIPALE.slice(0, 6), { confini: [ms('09:30:05')] })), ['o3', 'o4']);
});

test('un rilascio che non ha portato il rapporto al server non è un confine: i suoi turni passano al rapporto dopo', () => {
  const conEsito = (testo) => PRINCIPALE.map((l) => (l.includes('"tool_use_id":"b1"') ? esito('b1', H('11:01:00'), testo) : l));
  const confini = [ms('09:29:00')];
  for (const testo of ['rilascio non riuscito (dead_ticket)', 'Il ramo \'x\' NON è arrivato su origin: rete\nNon ho rilasciato niente: sistema il push', `il server non ha capito il rapporto (report_malformed): rilasciato SENZA rapporto.\n${OK}`]) {
    assert.deepEqual(ids(finestraOrchestratore(conEsito(testo), { confini })), ['o3', 'o4', 'o5', 'o6', 'o7'], testo);
  }
  // Senza esito (il comando è morto a metà) e con --senza-rapporto, lo stesso.
  assert.deepEqual(ids(finestraOrchestratore(PRINCIPALE.filter((l) => !l.includes('"tool_use_id":"b1"')), { confini })), ['o3', 'o4', 'o5', 'o6', 'o7']);
  const senza = PRINCIPALE.map((l) => l.replace('--role orchestrator', '--role orchestrator --senza-rapporto'));
  assert.deepEqual(ids(finestraOrchestratore(senza, { confini })), ['o3', 'o4', 'o5', 'o6', 'o7']);
  // Il rapporto ridotto (senza l'elenco degli strumenti) è arrivato: confine.
  assert.deepEqual(ids(finestraOrchestratore(conEsito(`rapporto troppo grande (70000 byte, massimo 65536): allegato senza l'elenco degli strumenti e le note.\n${OK}`), { confini })), ['o6', 'o7']);
});

test('le consegne di un rapporto si riconoscono comunque sia scritto il comando, e solo dall\'esito del canale', () => {
  for (const c of [
    'node "/tmp/filo tools/scripts/routine-channel.mjs" release abc --role orchestrator',
    "FILO_ROUTINE=1 node '/tmp/t/scripts/routine-channel.mjs' release abc --role orchestrator",
    'cd /repo && node C:\\filo\\scripts\\routine-channel.mjs release abc',
  ]) {
    assert.ok(eRilascio(c), c);
    assert.equal(consegnaRapporto(c), 'rilascio', c);
  }
  assert.equal(consegnaRapporto(RISPOSTA), 'chiusura');
  assert.equal(consegnaRapporto('node scripts/routine-channel.mjs risposta --biglietto tkt <<\'FINE\'\nniente\nFINE'), '', 'quella del worker non porta il rapporto dell\'orchestratore');
  assert.equal(consegnaRapporto('node scripts/routine-channel.mjs risposta --biglietto=tkt'), '');
  assert.equal(consegnaRapporto('node scripts/routine-channel.mjs risposta "<p>" c9 <<\'FINE\'\nil flag --biglietto mi ha confuso\nFINE'), 'chiusura', 'il testo dell\'heredoc non è del comando');
  assert.equal(consegnaRapporto('node scripts/routine-channel.mjs risposta "<p>" c9 <<FINE\nniente --biglietto\nFINE'), 'chiusura');
  assert.equal(consegnaRapporto('node scripts/routine-channel.mjs risposta --biglietto tkt << \'FINE\'\nniente\nFINE'), '');
  assert.equal(consegnaRapporto('node scripts/routine-channel.mjs release abc --senza-rapporto'), '');
  for (const c of ['node scripts/routine-channel.mjs ticket x --json', 'node scripts/routine-channel.mjs domanda "<p>"', 'grep -n "routine-channel.mjs release" x.md', 'node scripts/routine-channel.mjs.bak release abc']) {
    assert.equal(eRilascio(c), false, c);
    assert.equal(consegnaRapporto(c), '', c);
  }
  assert.equal(rapportoArrivato('rilascio', OK), true);
  assert.equal(rapportoArrivato('rilascio', 'OK: biglietto rilasciato, guasto dichiarato.'), true);
  assert.equal(rapportoArrivato('rilascio', 'rilascio non riuscito (dead_ticket)'), false);
  assert.equal(rapportoArrivato('chiusura', 'chiusura dell\'orchestratore: $0.0100 (3 turni)\nOK: risposta registrata.'), true);
  assert.equal(rapportoArrivato('chiusura', 'il server non ha preso il rapporto della chiusura (report_too_big): risposta mandata SENZA rapporto.\nOK: risposta registrata.'), false);
  assert.equal(rapportoArrivato('chiusura', 'risposta non arrivata (http_503): chiudi comunque'), false);
  assert.equal(rapportoArrivato('chiusura', OK), false);
});

test('il rapporto del worker porta a parte i turni dell\'orchestratore dall\'ultimo rapporto arrivato al suo rilascio', async () => {
  // Il worker 3: un comando lungo fa scadere la sua cache a 5 minuti, il terzo turno riscrive quasi tutto.
  const w3 = [
    riga('w3', 'a1', H('11:03:10'), { cw: 40000 }), riga('w3', 'a2', H('11:04:00'), { cw: 1000, cr: 40000 }),
    riga('w3', 'a3', H('11:20:00'), { cw: 38000, cr: 3000, tools: [bash('rel-w3', RILASCIO)] }),
  ];
  // Mentre il worker rilascia il thread principale riceve una riga di servizio: dopo la consegna, è del rapporto dopo.
  const s = scena(PRINCIPALE.concat(orch('o8', H('11:20:30'), { cr: 36000 })), { w3 });
  try {
    const rep = await generaRapporto({ transcript: s.file.w3, role: 'verifier' });
    assert.equal(rep.sessionId, 'w3');
    assert.equal(rep.rewarmTurns, 1, 'a3 scrive 38.000 e ne legge 3.000');
    assert.equal(rep.costUsd, Math.round(((40000 * 5 + 1000 * 5 + 40000 * 0.2 + 38000 * 5 + 3000 * 0.2 + 30 * 20) / 1e6) * 10000) / 10000, 'costUsd resta quello del worker');
    const o = rep.orchestrator;
    assert.equal(o.turns, 2, 'o6 e o7: né quelli del rapporto di o5, né o8 scritto dopo la consegna');
    assert.deepEqual(o.tokens, { input: 0, cacheRead: 69000, cacheWrite: 1000, output: 20 });
    assert.equal(o.costUsd, Math.round(((69000 * 0.2 + 1000 * 5 + 20 * 20) / 1e6) * 10000) / 10000);
    assert.equal(o.attesaPrimaS, 90);
    assert.equal(o.maxContextTokens, 35000);
    assert.ok(!('notes' in o), 'le note dell\'orchestratore stanno in quelle del rapporto');
  } finally { togliCartella(s.base); }
});

test('orchestratore su Haiku 5.5: prezzato col suo listino, dal rilascio del worker di prima', async () => {
  const H55 = 'claude-haiku-5-5';
  const s = scena([
    orch('h1', H('09:00:00'), { cw: 30000, model: H55 }),
    orch('h2', H('09:01:00'), { cr: 30000, model: H55, tools: [agente('ag1')] }),
    esito('ag1', H('09:30:00'), 'fatto'),
    orch('h3', H('09:30:10'), { cr: 120000, cw: 2000, model: H55 }),
    orch('h4', H('09:31:00'), { cr: 40000, model: H55, tools: [agente('ag2')] }),
  ], {
    w1: lavoro('w1', H('09:01:10'), H('09:29:00')),
    w4: [riga('w4', 'w4a', H('09:32:00'), { cw: 110000, model: H55 }), riga('w4', 'w4b', H('09:33:00'), { cr: 150000, model: 'claude-sonnet-5-5', tools: [bash('rel-w4', RILASCIO)] })],
  });
  try {
    const rep = await generaRapporto({ transcript: s.file.w4, role: 'resolver' });
    const o = rep.orchestrator;
    assert.equal(o.turns, 2, 'h3 e h4');
    // h3 passa la soglia (122.000): 120.000·0,05 + 2000·0,625 + 10·2,50 = 7275; h4 no: 40.000·0,01 + 10·0,50 = 405.
    assert.equal(o.costUsd, 0.0077);
    assert.deepEqual(o.oltreSoglia, { 'claude-haiku-5-5': 1 });
    assert.ok(!rep.notes.some((n) => /sconosciuto/.test(n)), JSON.stringify(rep.notes));
  } finally { togliCartella(s.base); }
});

// Worker in sottofondo (il default di Claude Code): la chiamata riceve subito «Async agent launched», la fine arriva
// come notifica; il worker 1 rilascia alle 11:30.
const SOTTOFONDO = [
  orch('s1', H('10:00:00'), { cw: 30000 }),
  orch('s2', H('10:00:50'), { cr: 30000, tools: [agente('bg1')] }),
  lanciato('bg1', H('10:00:53'), 'w1'),
  orch('s3', H('10:01:00'), { cr: 30500 }),
  ...notifica(H('11:31:05'), 'bg1', 'w1'),
  orch('s4', H('11:31:10'), { cw: 32000 }),
  orch('s5', H('11:31:20'), { cr: 32000 }),
  orch('s6', H('11:31:50'), { cr: 32500, tools: [agente('bg2')] }),
  lanciato('bg2', H('11:31:53'), 'w2'),
  orch('s7', H('11:32:00'), { cr: 33000 }),
];
const W1 = lavoro('w1', H('10:01:10'), H('11:30:00'));
const W2 = lavoro('w2', H('11:32:10'), H('12:00:00'), { esitoRilascio: null });

test('#1170.1 un rilascio arrivato con l\'esito fuori vista (in un file, filtrato, in sottofondo) è un confine: i suoi turni non tornano nel rapporto dopo', async () => {
  for (const [comando, uscita] of [
    [`${RILASCIO} > /tmp/rilascio.log 2>&1; echo "exit=$?"`, 'exit=0'],
    [`${RILASCIO} 2>&1 | head -1`, "ramo 'worker/x' spedito su origin"],
    [RILASCIO, 'Command running in background with ID: b1. Output is being written to: /tmp/x.output'],
  ]) {
    const s = scena(SOTTOFONDO, { w1: lavoro('w1', H('10:01:10'), H('11:30:00'), { comando, esitoRilascio: uscita }), w2: W2 });
    try {
      assert.equal((await generaRapporto({ transcript: s.file.w2, role: 'verifier' })).orchestrator.turns, 4, `${comando} → ${uscita}: s4–s7, non s1–s3`);
    } finally { togliCartella(s.base); }
  }
  // Un fallimento che si vede resta fuori: codice d'uscita stampato o segnato, righe del canale.
  for (const [testo, errore] of [['exit=3', false], ['EXIT=1', false], ['Exit code 3\nguasto: canale', true], ['', true], ['NESSUN BIGLIETTO: …', false], ['Uso: …', false]]) {
    assert.equal(rapportoArrivato('rilascio', testo, { errore }), false, testo);
  }
  assert.equal(rapportoArrivato('rilascio', 'exit=0'), true);
  assert.equal(rapportoArrivato('chiusura', 'exit 0'), true);
  assert.equal(rapportoArrivato('chiusura', 'Nessuna risposta su stdin — non ho mandato niente.'), false);
  assert.equal(rapportoArrivato('rilascio', `${OK}\nexit=0`, { errore: false }), true);
});

test('worker in sottofondo: il turno d\'attesa dopo il lancio è del worker lanciato, il resto del rapporto dopo', async () => {
  const primo = scena(SOTTOFONDO.slice(0, 4), { w1: lavoro('w1', H('10:01:10'), H('11:30:00'), { esitoRilascio: null }) });
  const s = scena(SOTTOFONDO, { w1: W1, w2: W2 });
  try {
    assert.equal((await generaRapporto({ transcript: primo.file.w1, role: 'verifier' })).orchestrator.turns, 3, 's1, s2, s3');
    const o = (await generaRapporto({ transcript: s.file.w2, role: 'verifier' })).orchestrator;
    assert.equal(o.turns, 4, 's4, s5, s6, s7');
    assert.equal(o.rewarmTurns, 1, 's4 riscrive la cache');
    assert.equal(o.attesaPrimaS, 5410, 'da s3 a s4: un\'ora e mezza ferma, la cache a un\'ora è scaduta');
  } finally { togliCartella(primo.base); togliCartella(s.base); }
});

test('#1170 la consegna del worker arrivata prima della notifica: i turni in mezzo stanno nel rapporto dopo', async () => {
  const P = SOTTOFONDO.slice(0, 4).concat(
    consegna(H('11:30:40'), 'w1'),
    orch('s4', H('11:30:45'), { cw: 32000, tools: [bash('lp', 'node "/tmp/filo-strumenti/scripts/dispatch.mjs" --linea-principale')] }),
    orch('s5', H('11:31:00'), { cr: 32000, tools: [bash('tk', 'node "/tmp/filo-strumenti/scripts/routine-channel.mjs" ticket "<p>" --json')] }),
    ...notifica(H('11:31:05'), 'bg1', 'w1'),
    SOTTOFONDO.slice(8),
  );
  const s = scena(P, { w1: W1, w2: W2 });
  try {
    const o = (await generaRapporto({ transcript: s.file.w2, role: 'verifier' })).orchestrator;
    assert.equal(o.turns, 4, 's4 e s5 prima della notifica, s6 e s7 dopo');
    assert.equal(o.rewarmTurns, 1);
  } finally { togliCartella(s.base); }
});

test('#1170 un lancio fallito e riprovato: i turni prima del lancio fallito stanno nel rapporto del worker che parte', async () => {
  const P = SOTTOFONDO.slice(0, 8).concat(
    orch('s6', H('11:31:50'), { cr: 32500, tools: [agente('bg2')] }),
    esito('bg2', H('11:31:51'), 'PreToolUse:Agent hook error: lancio senza --ticket', { errore: true }),
    orch('s6b', H('11:32:05'), { cr: 33000, tools: [agente('bg3')] }),
    lanciato('bg3', H('11:32:08'), 'w2'),
    orch('s7', H('11:32:20'), { cr: 33500 }),
  );
  const s = scena(P, { w1: W1, w2: W2 });
  try {
    const o = (await generaRapporto({ transcript: s.file.w2, role: 'verifier' })).orchestrator;
    assert.equal(o.turns, 5, 's4, s5, s6 (il lancio fallito), s6b, s7');
    assert.equal(o.rewarmTurns, 1, 's4, che riscalda la cache, non si perde');
  } finally { togliCartella(s.base); }
});

// La notifica provvisoria: un worker in sottofondo che si ferma ad aspettare un suo comando (forma vista il 10/10).
const T0 = Date.parse('2026-10-01T08:00:00Z');
const M = (min) => new Date(T0 + Math.round(min * 60000)).toISOString();
const PROVVISORIA = '\n<note>This agent stopped with background work of its own still running. It may resume on its own when that work completes or reports; the result below may be interim.</note>';
const FINO_A_100 = [
  orch('m1', M(0), { cr: 0, cw: 30000 }),
  orch('m2', M(1), { cr: 30000, tools: [agente('t_w0')] }),
  lanciato('t_w0', M(1.01), 'w0'),
  orch('m3', M(1.02), { cr: 30000 }),
  ...notifica(M(10), 't_w0', 'w0'),
  orch('m4', M(80), { cr: 0, cw: 200000 }),
  orch('m5', M(81), { cr: 200000 }), orch('m6', M(82), { cr: 200000 }),
  orch('m7', M(83), { cr: 200000, tools: [agente('t_w1')] }),
  lanciato('t_w1', M(83.01), 'w1'),
  orch('m8', M(83.02), { cr: 200000 }),
  ...notifica(M(100), 't_w1', 'w1', PROVVISORIA),
  orch('m9', M(100.1), { cr: 200000 }),
];

test('#1170 la notifica provvisoria non è la fine del worker: i due rapporti si dividono i turni senza perderne né ripeterne', async () => {
  const w0 = lavoro('w0', M(1.05), M(9));
  const w1 = [riga('w1', 'w1a', M(83.1), { cw: 25000 }), riga('w1', 'w1b', M(99), { cr: 25000 }), riga('w1', 'w1c', M(119), { cr: 25000 }), riga('w1', 'w1r', M(120), { cr: 25000, tools: [bash('rel-w1', RILASCIO)] })];
  const uno = scena(FINO_A_100, { w0, w1 });
  const due = scena(FINO_A_100.concat(
    ...notifica(M(121), 't_w1', 'w1'),
    orch('m10', M(121.2), { cr: 200000 }),
    orch('m11', M(122), { cr: 200000, tools: [agente('t_w2')] }),
    lanciato('t_w2', M(122.01), 'w2'),
    orch('m12', M(122.02), { cr: 200000 }),
  ), { w0, w1: w1.concat(esito('rel-w1', M(120.1), OK, { sessionId: 'w1' })), w2: [riga('w2', 'w2a', M(122.1), { cw: 25000 }), riga('w2', 'w2r', M(140), { cr: 25000, tools: [bash('rel-w2', RILASCIO)] })] });
  try {
    const o1 = (await generaRapporto({ transcript: uno.file.w1, role: 'verifier' })).orchestrator;
    assert.equal(o1.turns, 6, 'm4–m9: col turno che riscalda la cache e quello sulla notifica provvisoria');
    assert.equal(o1.rewarmTurns, 1);
    assert.equal(o1.attesaPrimaS, Math.round((80 - 1.02) * 60));
    const o2 = (await generaRapporto({ transcript: due.file.w2, role: 'verifier' })).orchestrator;
    assert.equal(o2.turns, 3, 'm10, m11, m12: m9 è già nel rapporto del worker uno');
    assert.equal(o2.attesaPrimaS, Math.round((121.2 - 100.1) * 60));
  } finally { togliCartella(uno.base); togliCartella(due.base); }
});

test('una richiesta fallita («<synthetic>») non accorcia l\'attesa: la cache l\'ha toccata solo il turno vero', () => {
  const sintetico = JSON.stringify({ type: 'assistant', timestamp: H('11:31:08'), sessionId: 'orch', message: { id: 'syn', model: '<synthetic>', usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: 'API Error' }] } });
  const righe = SOTTOFONDO.slice(0, 6).concat(sintetico, orch('s4', H('12:20:00'), { cw: 32000 }));
  assert.equal(finestraOrchestratore(righe, { confini: [ms('11:30:00')] }).attesaPrimaS, 8340, 'da s3 alle 10:01 a s4 alle 12:20');
});

test('il turno che rilascia e chiama anche altro, su più righe, resta tutto nella finestra di prima', () => {
  const o5 = (ts, tool) => orch('o5', ts, { cw: 34000, tools: [tool] });
  const righe = PRINCIPALE.slice(0, 6).concat(
    o5(H('11:00:30'), bash('b1', RILASCIO_ORCH)),
    o5(H('11:00:31'), bash('b2', 'node scripts/dispatch.mjs --linea-principale')),
    esito('b1', H('11:01:00'), OK), esito('b2', H('11:01:01'), 'ok'),
    PRINCIPALE[8], PRINCIPALE[9],
  );
  const f = finestraOrchestratore(righe);
  assert.deepEqual(ids(f), ['o6', 'o7']);
  assert.equal(f.attesaPrimaS, 89, 'dall\'ultima riga di o5 a o6');
  // E il rapporto che consegna o5 lo prende intero, anche la riga scritta dopo la chiamata.
  const suo = finestraOrchestratore(righe.slice(0, 8), { fine: ms('11:00:30') });
  assert.equal(suo.righe.filter((l) => l.includes('"id":"o5"')).length, 2);
});

test('worker morto: il rilascio dell\'orchestratore conta dall\'ultimo rapporto arrivato, coi sotto-agenti dal biglietto', async () => {
  const P = SOTTOFONDO.slice(0, 6).concat(
    orch('s4', H('11:31:10'), { cw: 32000 }),
    orch('s5', H('11:31:30'), { cr: 32000, tools: [bash('tk', 'node scripts/routine-channel.mjs ticket x --json')] }),
    esito('tk', H('11:31:31'), '{"ticket":"tkt-due","role":"verifier"}'),
    orch('s6', H('11:31:50'), { cr: 32500, tools: [agente('bg2')] }),
    lanciato('bg2', H('11:31:53'), 'w2'),
    orch('s7', H('11:32:00'), { cr: 33000 }),
    ...notifica(H('11:40:00'), 'bg2', 'w2'),
    orch('s8', H('11:40:05'), { cr: 33000, tools: [bash('rel', 'node scripts/routine-channel.mjs release tkt-due --role orchestrator')] }),
  );
  // Il worker 2 muore dopo due turni, senza rilasciare.
  const s = scena(P, { w1: W1, w2: [riga('w2', 'w2a', H('11:32:10'), { cw: 25000 }), riga('w2', 'w2b', H('11:35:00'), { cr: 25000 })] });
  try {
    const rep = await generaRapporto({ transcript: s.main, role: 'orchestrator', ticket: 'tkt-due', since: H('10:01:05') });
    assert.equal(rep.turns, 7, 's4–s8 dell\'orchestratore e i due del worker morto; niente del worker 1, già nel suo rilascio');
    assert.equal(rep.rewarmTurns, 1, 's4 dopo l\'attesa');
    assert.equal(rep.subagentRuns, 2);
    // Senza il momento del biglietto i sotto-agenti partono dall'ultimo rapporto arrivato, con la nota.
    const senza = await generaRapporto({ transcript: s.main, role: 'orchestrator', ticket: 'altro', since: '' });
    assert.equal(senza.turns, 7);
    assert.ok(senza.notes.some((n) => /momento del biglietto non trovato/.test(n)), senza.notes.join(' | '));
    // Un ruolo che non è l'orchestratore resta dal biglietto.
    assert.equal((await generaRapporto({ transcript: s.main, role: 'verifier', since: H('11:31:30') })).turns, 4 + 2);
  } finally { togliCartella(s.base); }
});

// La chiusura: dopo l'ultimo worker l'orchestratore riscrive la cache, chiede un biglietto che non c'è, chiede la
// domanda e risponde. Nessun rilascio porta quei turni: li porta la risposta.
const CHIUSURA = SOTTOFONDO.concat(
  ...notifica(H('12:00:30'), 'bg2', 'w2'),
  orch('c1', H('13:10:05'), { cw: 34000 }),
  orch('c2', H('13:10:30'), { cr: 34000, tools: [bash('tk', 'node "/tmp/filo-strumenti/scripts/routine-channel.mjs" ticket "<p>" --json')] }),
  esito('tk', H('13:10:32'), 'niente da fare (idle)'),
  orch('c3', H('13:11:00'), { cr: 34200, tools: [bash('dm', 'node "/tmp/filo-strumenti/scripts/routine-channel.mjs" domanda "<p>"')] }),
  esito('dm', H('13:11:02'), 'C\'è qualcosa…'),
  orch('c4', H('13:11:30'), { cr: 34500, tools: [bash('rs', RISPOSTA)] }),
);
const W2_FATTO = lavoro('w2', H('11:32:10'), H('12:00:00'));

test('chiusura: il rapporto della risposta porta i turni dell\'orchestratore dopo l\'ultimo rilascio arrivato', async () => {
  const s = scena(CHIUSURA, { w1: W1, w2: W2_FATTO });
  try {
    const r = await rapportoChiusura({ transcript: s.main });
    assert.equal(r.role, 'orchestrator');
    assert.equal(r.closing, true);
    assert.equal(r.sessionId, 'orch');
    assert.equal(r.turns, 4, 'c1–c4: la cache riscritta, il biglietto che non c\'è, la domanda e la risposta');
    assert.equal(r.rewarmTurns, 1);
    assert.equal(r.attesaPrimaS, 5885, 'da s7 alle 11:32 a c1 alle 13:10');
    assert.equal(r.costUsd, Math.round(((34000 * 5 + (34000 + 34200 + 34500) * 0.2 + 40 * 20) / 1e6) * 10000) / 10000);
    assert.match(riassuntoChiusura(r), /^chiusura dell'orchestratore: \$0\.1913 \(4 turni, contesto 34500, 1 da riscaldare, fermo 5885s\)$/);
    // Anche partendo dal transcript di un worker (il più recente), il thread è quello principale.
    assert.equal((await rapportoChiusura({ transcript: s.file.w2 })).turns, 4);
    // Il turno dopo la risposta non lo porta nessun comando: resta fuori, e il rapporto non cambia.
    const dopo = scena(CHIUSURA.concat(esito('rs', H('13:11:33'), 'OK: risposta registrata.'), orch('c5', H('13:11:40'), { cr: 34800 })), { w1: W1, w2: W2_FATTO });
    try { assert.equal((await rapportoChiusura({ transcript: dopo.main })).turns, 4); } finally { togliCartella(dopo.base); }
  } finally { togliCartella(s.base); }
});

test('chiusura: un\'accensione senza worker manda tutta la sessione; se l\'ultimo rilascio non è arrivato, anche i suoi turni', async () => {
  const sola = scena([
    orch('p1', H('09:00:00'), { cw: 30000 }),
    orch('p2', H('09:00:20'), { cr: 30000, tools: [bash('tk', 'node scripts/routine-channel.mjs ticket "<p>" --json')] }),
    esito('tk', H('09:00:22'), 'niente da fare (idle)'),
    orch('p3', H('09:00:40'), { cr: 30200, tools: [bash('rs', RISPOSTA)] }),
  ]);
  const rifiutato = scena(CHIUSURA, { w1: W1, w2: lavoro('w2', H('11:32:10'), H('12:00:00'), { esitoRilascio: 'rilascio non riuscito (dead_ticket)' }) });
  try {
    const r = await rapportoChiusura({ transcript: sola.main });
    assert.equal(r.turns, 3);
    assert.equal(r.attesaPrimaS, 0);
    assert.equal(r.rewarmTurns, 0, 'il primo turno della sessione non è una cache scaduta');
    assert.equal((await rapportoChiusura({ transcript: rifiutato.main })).turns, 8, 's4–s7 del worker 2, mai arrivati, e c1–c4');
    const nessuno = await rapportoChiusura({ transcript: join(sola.base, 'non-c-e.jsonl') });
    assert.equal(nessuno.closing, true);
    assert.match(nessuno.notes[0], /assente/);
    assert.match(riassuntoChiusura(nessuno), /nessun rapporto/);
  } finally { togliCartella(sola.base); togliCartella(rifiutato.base); }
});

test('#1170 una sessione intera: ogni turno dell\'orchestratore sta in un rapporto solo, tranne quello dopo la risposta', async () => {
  // Ogni riga col suo momento e il suo file; un rapporto si calcola coi file com'erano quando è nato.
  const ev = [];
  const P = (min, l) => ev.push({ min, f: 'orch', l });
  const W = (w, min, l) => ev.push({ min, f: w, l });
  const t = (id, min, o) => P(min, orch(id, M(min), o));
  t('x1', 0, { cw: 30000 }); t('x2', 0.1, { cr: 30000 }); t('x3', 0.2, { cr: 30000, tools: [agente('a1')] });
  P(0.25, lanciato('a1', M(0.25), 'A1')); t('x4', 0.3, { cr: 30100 });
  W('A1', 0.3, riga('A1', 'A1a', M(0.3), { cw: 25000 })); W('A1', 30, riga('A1', 'A1r', M(30), { cr: 25000, tools: [bash('rel-A1', RILASCIO)] }));
  W('A1', 30.2, esito('rel-A1', M(30.2), OK, { sessionId: 'A1' }));
  // (a) la consegna prima della notifica, (b) un lancio fallito e riprovato.
  P(30.5, consegna(M(30.5), 'A1')); t('x5', 30.6, { cw: 31000 }); t('x6', 31, { cr: 31000 });
  for (const l of notifica(M(31.2), 'a1', 'A1')) P(31.2, l);
  t('x7', 31.5, { cr: 31100, tools: [agente('a2')] }); P(31.6, esito('a2', M(31.6), 'hook error', { errore: true }));
  t('x8', 32, { cr: 31200, tools: [agente('a3')] }); P(32.1, lanciato('a3', M(32.1), 'A3')); t('x9', 32.2, { cr: 31300 });
  // (c) la notifica provvisoria.
  W('A3', 32.3, riga('A3', 'A3a', M(32.3), { cw: 25000 }));
  for (const l of notifica(M(50), 'a3', 'A3', PROVVISORIA)) P(50, l);
  t('x10', 50.1, { cr: 31400 });
  W('A3', 70, riga('A3', 'A3r', M(70), { cr: 25000, tools: [bash('rel-A3', RILASCIO)] })); W('A3', 70.2, esito('rel-A3', M(70.2), OK, { sessionId: 'A3' }));
  for (const l of notifica(M(71), 'a3', 'A3')) P(71, l);
  t('x11', 71.2, { cr: 31500 }); t('x12', 72, { cr: 31600, tools: [bash('tk4', 'node scripts/routine-channel.mjs ticket "<p>" --json')] });
  P(72.1, esito('tk4', M(72.1), '{"ticket":"tkt-4","role":"verifier"}'));
  t('x13', 72.5, { cr: 31700, tools: [agente('a4')] }); P(72.55, lanciato('a4', M(72.55), 'A4')); t('x14', 72.6, { cr: 31800 });
  // Il worker 4 muore; un'ora dopo l'orchestratore riscalda e rilascia per lui, poi chiude.
  W('A4', 72.7, riga('A4', 'A4a', M(72.7), { cw: 25000 })); W('A4', 80, riga('A4', 'A4b', M(80), { cr: 25000 }));
  for (const l of notifica(M(90), 'a4', 'A4')) P(90, l);
  t('x15', 150, { cw: 32000 }); t('x16', 150.5, { cr: 32000, tools: [bash('rel-o', 'node scripts/routine-channel.mjs release tkt-4 --role orchestrator')] });
  P(151, esito('rel-o', M(151), OK));
  t('x17', 152, { cr: 32100 }); t('x18', 153, { cr: 32200 }); t('x19', 154, { cr: 32300, tools: [bash('rs', RISPOSTA)] });
  P(154.2, esito('rs', M(154.2), 'OK: risposta registrata.')); t('x20', 154.5, { cr: 32400 });

  const base = cartellaTemporanea('filo-sessione-intera-');
  const sub = join(base, 'orch', 'subagents');
  mkdirSync(sub, { recursive: true });
  const file = (f) => (f === 'orch' ? join(base, 'orch.jsonl') : join(sub, `agent-${f}.jsonl`));
  const fino = (min) => {
    for (const f of ['orch', 'A1', 'A3', 'A4']) writeFileSync(file(f), ev.filter((e) => e.f === f && e.min <= min).map((e) => `${e.l}\n`).join(''));
  };
  try {
    fino(30);
    const r1 = (await generaRapporto({ transcript: file('A1'), role: 'resolver' })).orchestrator;
    fino(70);
    const r2 = (await generaRapporto({ transcript: file('A3'), role: 'resolver' })).orchestrator;
    fino(150.5);
    const r3 = await generaRapporto({ transcript: file('orch'), role: 'orchestrator', ticket: 'tkt-4' });
    fino(154);
    const r4 = await rapportoChiusura({ transcript: file('orch') });
    fino(1000);
    assert.deepEqual([r1.turns, r2.turns, r3.turns - 2, r4.turns], [4, 6, 6, 3], 'x1–x4 | x5–x10 | x11–x16 (più i due del worker morto) | x17–x19');
    const tutti = await analizzaRighe(ev.filter((e) => e.f === 'orch' && e.min < 154.5).map((e) => e.l), { role: 'orchestrator' });
    const morto = await analizzaRighe(ev.filter((e) => e.f === 'A4').map((e) => e.l), {});
    assert.equal(r1.turns + r2.turns + (r3.turns - morto.turns) + r4.turns, tutti.turns, 'nessun turno perso né contato due volte');
    const somma = r1.costUsd + r2.costUsd + (r3.costUsd - morto.costUsd) + r4.costUsd;
    assert.ok(Math.abs(somma - tutti.costUsd) < 0.0005, `${somma} contro ${tutti.costUsd}`);
    assert.equal(r3.rewarmTurns, 1, 'x15 dopo un\'ora');
  } finally { togliCartella(base); }
});

test('in cloud la sessione nasce sopra il repo: i transcript si ritrovano dall\'id che Claude Code dà ai comandi', () => {
  const casa = cartellaTemporanea('filo-transcript-cloud-');
  try {
    const config = join(casa, 'claude');
    const repo = join(casa, 'user', 'Filo');
    mkdirSync(repo, { recursive: true });
    const sessione = join(config, 'projects', slugProgetto(join(casa, 'user')));
    mkdirSync(join(sessione, 'sess-cloud', 'subagents'), { recursive: true });
    writeFileSync(join(sessione, 'sess-cloud.jsonl'), `${orch('o1', H('09:00:00'), { cw: 30000 })}\n`);
    const worker = join(sessione, 'sess-cloud', 'subagents', 'agent-w.jsonl');
    writeFileSync(worker, `${riga('w', 'w1', H('09:10:00'), { cw: 25000 })}\n`);
    assert.equal(trovaTranscript({ cwd: repo, configDir: config, env: {} }).file, '', 'dallo slug del repo non si trova niente');
    const env = { CLAUDE_CODE_SESSION_ID: 'sess-cloud' };
    assert.ok(cartelleTranscript({ cwd: repo, configDir: config, env }).includes(sessione));
    assert.equal(trovaTranscript({ cwd: repo, configDir: config, env }).file, worker, 'il più recente della sessione: il worker che rilascia');
    for (const id of ['../sess-cloud', 'altra', '']) {
      assert.ok(!cartelleTranscript({ cwd: repo, configDir: config, env: { CLAUDE_CODE_SESSION_ID: id } }).includes(sessione), id);
    }
  } finally { togliCartella(casa); }
});
