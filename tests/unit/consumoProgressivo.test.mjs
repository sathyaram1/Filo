// Lettore progressivo del consumo (scripts/lib/consumo-progressivo.mjs) e campi dei crediti nel battito
// (routine-channel.mjs misureCrediti/heartbeat), su transcript finti in una cartella temporanea.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const { avanzaFile, consumoSessione, principaleDi, sessioneDa, statoFile, totaliDi } = await import('../../scripts/lib/consumo-progressivo.mjs');
const { analizzaRighe } = await import('../../scripts/session-report.mjs');
const { misureCrediti, heartbeat } = await import('../../scripts/routine-channel.mjs');
const { SESSION_MARKERS } = await import('../../scripts/lib/branch-integrity.mjs');

const OPUS = 'claude-opus-5-5';
const riga = (id, output, extra = {}) => `${JSON.stringify({
  type: 'assistant', sessionId: 'sess-a', timestamp: '2026-10-09T10:00:00.000Z',
  message: { id, model: OPUS, usage: Object.assign({ input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100, output_tokens: output }, extra) },
})}\n`;
const utente = `${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'assistant' }] } })}\n`;

function progetto() {
  const casa = cartellaTemporanea('filo-consumo-');
  const cartella = join(casa, 'projects', 'p');
  mkdirSync(cartella, { recursive: true });
  return { casa, cartella, root: join(casa, 'repo'), principale: join(cartella, 'sess-a.jsonl') };
}

async function rapportoDi(file) {
  return analizzaRighe(readFileSync(file, 'utf8').split('\n'));
}

test('un messaggio diviso fra due letture vale la sua ULTIMA usage, come nel rapporto di fine sessione', async () => {
  const { casa, principale } = progetto();
  try {
    writeFileSync(principale, riga('m1', 2) + utente);
    let st = avanzaFile(principale, null);
    assert.equal(totaliDi(st).output, 2);
    assert.equal(totaliDi(st).turni, 1);
    appendFileSync(principale, riga('m1', 300) + riga('m2', 40));
    st = avanzaFile(principale, st);
    const t = totaliDi(st);
    assert.equal(t.output, 340, 'm1 conta 300 (non 302), m2 conta 40');
    assert.equal(t.turni, 2);
    const rep = await rapportoDi(principale);
    assert.equal(t.output, rep.tokens.output);
    assert.equal(Math.round(t.costo * 10000) / 10000, rep.costUsd, 'stesso prezzo del rapporto');
  } finally { togliCartella(casa); }
});

test('una riga a metà si legge solo quando è intera; un file accorciato si rilegge da capo', () => {
  const { casa, principale } = progetto();
  try {
    const intera = riga('m1', 5);
    const seconda = riga('m2', 7);
    writeFileSync(principale, intera + seconda.slice(0, 30));
    let st = avanzaFile(principale, null);
    assert.equal(st.offset, Buffer.byteLength(intera), 'si ferma all ultimo a capo');
    assert.equal(totaliDi(st).output, 5);
    appendFileSync(principale, seconda.slice(30));
    st = avanzaFile(principale, st);
    assert.equal(totaliDi(st).output, 12);
    truncateSync(principale, 0);
    writeFileSync(principale, riga('n1', 9));
    st = avanzaFile(principale, st);
    assert.equal(totaliDi(st).output, 9, 'riscritto più corto: niente resti della lettura vecchia');
  } finally { togliCartella(casa); }
});

test('consumo della sessione intera: principale + sotto-agenti, idempotente, e dal sotto-agente si risale', () => {
  const { casa, cartella, root, principale } = progetto();
  try {
    writeFileSync(principale, riga('m1', 10));
    const sub = join(cartella, 'sess-a', 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'agent-x.jsonl'), riga('s1', 20));
    const env = { FILO_TRANSCRIPT: join(sub, 'agent-x.jsonl') };
    assert.equal(principaleDi(env.FILO_TRANSCRIPT), principale);
    const a = consumoSessione({ root, env, configDir: casa });
    assert.equal(a.consumo.sessionId, 'sess-a');
    assert.equal(a.consumo.tokens.output, 30);
    assert.equal(a.consumo.turni, 2);
    assert.deepEqual(a.consumo.modelli, [OPUS]);
    const b = consumoSessione({ root, env, configDir: casa });
    assert.deepEqual(b.consumo, a.consumo, 'un battito ripetuto non conta due volte');
    // Un sotto-agente nuovo entra nel conto.
    writeFileSync(join(sub, 'agent-y.jsonl'), riga('s2', 5));
    assert.equal(consumoSessione({ root, env, configDir: casa }).consumo.tokens.output, 35);
    assert.ok(existsSync(statoFile(root)));
  } finally { togliCartella(casa); }
});

test('stato illeggibile: si ricomincia senza lanciare, con lo stesso risultato', () => {
  const { casa, root, principale } = progetto();
  try {
    writeFileSync(principale, riga('m1', 10) + riga('m2', 11));
    const env = { FILO_TRANSCRIPT: principale };
    const giusto = consumoSessione({ root, env, configDir: casa }).consumo;
    writeFileSync(statoFile(root), '{ non è json');
    assert.deepEqual(consumoSessione({ root, env, configDir: casa }).consumo, giusto);
    writeFileSync(statoFile(root), JSON.stringify({ sessioni: { 'sess-a': { file: { [principale]: { offset: 'x' } }, aggiornatoIl: Date.now() } } }));
    assert.deepEqual(consumoSessione({ root, env, configDir: casa }).consumo, giusto);
  } finally { togliCartella(casa); }
});

test('sessione: FILO_SESSION_ID si cerca nelle cartelle del progetto; senza indicazioni nessun ripiego fuori da una routine', () => {
  const { casa, root } = progetto();
  try {
    const cwd = join(casa, 'lavoro');
    mkdirSync(cwd, { recursive: true });
    const cartella = join(casa, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
    mkdirSync(cartella, { recursive: true });
    writeFileSync(join(cartella, 'sess-b.jsonl'), riga('m1', 1));
    writeFileSync(join(cartella, 'sess-c.jsonl'), riga('m1', 1));
    assert.equal(sessioneDa({ env: { FILO_SESSION_ID: 'sess-b' }, cwd, configDir: casa }).file, join(cartella, 'sess-b.jsonl'));
    assert.equal(sessioneDa({ env: {}, cwd, configDir: casa }).file, '', 'in locale il «più recente» può essere la sessione di un altro');
    assert.ok(sessioneDa({ env: {}, cwd, configDir: casa, ripiego: true }).file.endsWith('.jsonl'));
    assert.equal(consumoSessione({ root, env: {}, cwd, configDir: casa }).consumo, null);
  } finally { togliCartella(casa); }
});

test('battito: consumo, barra e lettura della barra solo se è di questa sessione', async () => {
  const { casa, root, principale } = progetto();
  try {
    writeFileSync(principale, riga('m1', 10));
    const home = join(casa, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const env = { FILO_TRANSCRIPT: principale };
    let m = misureCrediti({ root, env, configDir: casa, home });
    assert.equal(m.consumo.sessionId, 'sess-a');
    assert.equal(m.barra, 'assente');
    assert.equal(m.quota, undefined);
    const lettura = { pct7d: 61, reset7dAtS: 1760000000, letturaAtMs: 1 };
    writeFileSync(join(home, '.claude', 'filo-quota.json'), JSON.stringify({ sessioni: { altra: { vistaAtMs: 1, lettura } } }));
    assert.equal(misureCrediti({ root, env, configDir: casa, home }).quota, undefined, 'la lettura di un altra sessione non è nostra');
    writeFileSync(join(home, '.claude', 'filo-quota.json'), JSON.stringify({ sessioni: { 'sess-a': { vistaAtMs: 1, lettura } } }));
    m = misureCrediti({ root, env, configDir: casa, home });
    assert.equal(m.barra, 'presente');
    assert.deepEqual(m.quota, lettura);

    // Il corpo che parte davvero, e gli avvisi del server che tornano.
    let corpo = null;
    const fetchImpl = async (_url, init) => {
      corpo = JSON.parse(init.body);
      return { status: 200, text: async () => JSON.stringify({ ok: true, expiresAt: 'x', avvisi: [{ campo: 'quota', reason: 'reset_fuori_ancora' }] }) };
    };
    const r = await heartbeat('tkt', { root, env, configDir: casa, home, fetchImpl });
    assert.equal(corpo.ticket, 'tkt');
    assert.equal(corpo.consumo.costUsd, m.consumo.costUsd);
    assert.equal(corpo.barra, 'presente');
    assert.deepEqual(corpo.quota, lettura);
    assert.ok('uptimeS' in corpo, 'le misure del contenitore restano');
    assert.equal(r.avvisi[0].reason, 'reset_fuori_ancora');
  } finally { togliCartella(casa); }
});

test('il file di stato del consumo è un marcatore di sessione: gitignorato ed escluso', () => {
  assert.ok(SESSION_MARKERS.includes('.claude/routine-consumo.json'));
  const gi = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8').split(/\r?\n/);
  assert.ok(gi.includes('.claude/routine-consumo.json'));
});
