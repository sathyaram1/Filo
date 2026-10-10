// Prova del giro 5 (verifica locale) sul costo dell'orchestratore nel rapporto delle routine.
// Non apre Filo: il rilascio si lancia come lo lancia l'orchestratore in cloud, contro un canale finto
// che tiene il rapporto ricevuto, su transcript costruiti con la forma di quelli veri.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CANALE = resolve(ROOT, 'scripts', 'routine-channel.mjs');

const T0 = Date.now() - 3 * 60 * 60 * 1000;
const iso = (min) => new Date(T0 + min * 60000).toISOString();
let nid = 0;
function turno(min, { cr = 50000, cw = 2000, out = 300, tools = [] } = {}) {
  nid += 1;
  return { type: 'assistant', timestamp: iso(min), sessionId: 'S', message: { id: `msg_${nid}`, model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out }, content: tools.length ? tools : [{ type: 'text', text: 'ok' }] } };
}
const usa = (id, name, input) => ({ type: 'tool_use', id, name, input });
const risultato = (min, id, testo) => ({ type: 'user', timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content: testo }] } });
const notifica = (min, id, taskId, stato = 'completed') => ({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(min), content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${stato}</status>\n<summary>Agent finished</summary>\n</task-notification>` });

/**
 * Il worker uno, in sottofondo, prende il biglietto T1 (dispatch scrive il marcatore al minuto 2), lavora e
 * rilascia al minuto 60. Il worker due muore prima di arrivare a dispatch: il marcatore resta quello del T1, e
 * l'orchestratore rilascia lui il T2 al minuto 66.
 */
function sessione() {
  const P = [];
  P.push(turno(0, { cr: 0, cw: 30000 }));
  P.push(turno(1, { tools: [usa('t_w1', 'Agent', { prompt: 'w1', subagent_type: 'routine-worker' })] }));
  P.push(risultato(1.01, 't_w1', 'Async agent launched successfully.\nagentId: w1'));
  P.push(turno(1.02));
  P.push(notifica(61, 't_w1', 'w1'));
  P.push(turno(62, { cr: 0, cw: 120000 }));
  P.push(turno(63, { tools: [usa('t_tk', 'Bash', { command: 'node scripts/routine-channel.mjs ticket "x" --json' })] }));
  P.push(risultato(63.1, 't_tk', '{"ticket":"T2","role":"verifier"}'));
  P.push(turno(64, { tools: [usa('t_w2', 'Agent', { prompt: 'w2', subagent_type: 'routine-worker' })] }));
  P.push(risultato(64.01, 't_w2', 'Async agent launched successfully.\nagentId: w2'));
  P.push(turno(64.02));
  P.push(notifica(64.5, 't_w2', 'w2', 'failed'));
  P.push(turno(65));
  P.push(turno(66, { tools: [usa('t_rel', 'Bash', { command: 'node scripts/routine-channel.mjs release T2 --role orchestrator' })] }));
  const W1 = [
    turno(1.1, { cr: 0, cw: 25000 }),
    turno(2, { cw: 3000, tools: [usa('w_d', 'Bash', { command: 'node scripts/dispatch.mjs --ticket T1' })] }),
    turno(30, { cr: 0, cw: 80000 }),
    turno(60, { tools: [usa('w_rel', 'Bash', { command: 'node scripts/routine-channel.mjs release T1 --role verifier' })] }),
  ];
  const base = mkdtempSync(join(os.tmpdir(), 'orch-costo-g5-'));
  const sub = join(base, 'progetto', 'S', 'subagents');
  mkdirSync(sub, { recursive: true });
  const principale = join(base, 'progetto', 'S.jsonl');
  writeFileSync(principale, P.map((x) => JSON.stringify(x)).join('\n') + '\n');
  writeFileSync(join(sub, 'agent-w1.jsonl'), W1.map((x) => JSON.stringify(x)).join('\n') + '\n');
  writeFileSync(join(sub, 'agent-w1.meta.json'), JSON.stringify({ agentType: 'routine-worker' }));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  // Il marcatore che dispatch ha lasciato al worker uno: nessuno lo toglie dopo il suo rilascio.
  writeFileSync(join(repo, '.claude', 'routine-ticket.json'), JSON.stringify({ ticket: 'T1', since: iso(2) }, null, 2) + '\n');
  return { principale, repo };
}

function canaleFinto() {
  const ricevuti = [];
  const server = http.createServer((req, res) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => {
      ricevuti.push({ url: req.url, body: JSON.parse(s || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, ricevuti, url: `http://127.0.0.1:${server.address().port}` })));
}

function lancia(args, env) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CANALE, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => ok({ code, out, err }));
  });
}

async function rilascioDelT2() {
  const { principale, repo } = sessione();
  const canale = await canaleFinto();
  try {
    const r = await lancia(['release', 'T2', '--role', 'orchestrator', '--senza-push'], {
      FILO_REPO_ROOT: repo, FILO_ROUTINE_API: canale.url, FILO_TRANSCRIPT: principale,
    });
    const rel = canale.ricevuti.find((x) => x.url === '/routineRelease');
    return { r, report: rel && rel.body.report };
  } finally {
    canale.server.close();
  }
}

test('r1 il rilascio dell’orchestratore per un worker morto prima di dispatch non riporta i turni già nel rapporto del T1', async () => {
  const { r, report } = await rilascioDelT2();
  expect(r.code, r.err).toBe(0);
  expect(report, 'il rapporto non è arrivato al canale').toBeTruthy();
  // Dalla fine del worker uno (minuto 61) al rilascio: i turni dei minuti 62, 63, 64, 64.02, 65 e 66.
  // Quelli dei minuti 0, 1 e 1.02 il server li ha già avuti col rapporto del T1.
  expect(Date.parse(report.startedAt)).toBeGreaterThan(Date.parse(iso(61)));
});

test('r1 il rilascio dell’orchestratore per un worker morto prima di dispatch non riporta il costo del worker uno', async () => {
  const { report } = await rilascioDelT2();
  expect(report, 'il rapporto non è arrivato al canale').toBeTruthy();
  // Il worker uno ha già mandato il suo costo col rilascio del T1: qui ricontato raddoppia.
  expect(report.subagentCostUsd).toBe(0);
});
