// Prova del giro 2 (verifica locale) sul costo dell'orchestratore: non apre Filo,
// prova la misura dell'attesa prima del primo turno su un transcript costruito.

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const base = Date.parse('2026-10-07T08:00:00Z');
const T = (min) => new Date(base + min * 60000).toISOString();
let n = 0;
const turno = (min, { model = 'claude-opus-5-5', cw = 500, cr = 200000, tools = [] } = {}) => JSON.stringify({
  type: 'assistant', timestamp: T(min), sessionId: 'S',
  message: { id: `m${++n}`, model, usage: { input_tokens: 5, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: 100 }, content: tools },
});
const risultato = (min, id, text) => JSON.stringify({ type: 'user', timestamp: T(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
const notifica = (min, task, tu) => JSON.stringify({ type: 'user', timestamp: T(min), message: { role: 'user', content: `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${tu}</tool-use-id>\n<status>completed</status>\n</task-notification>` } });

test('r2 una richiesta fallita dopo la fine del worker non accorcia l\'attesa misurata', async () => {
  const { finestraOrchestratore } = await import(pathToFileURL(resolve(ROOT, 'scripts', 'session-report.mjs')).href);
  const linee = [
    turno(0, { cw: 30000, cr: 0 }),
    turno(1, { tools: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { prompt: 'x', run_in_background: true } }] }),
    risultato(1.1, 'tu1', 'Async agent launched successfully. (agentId: w1)'),
    turno(2),
    notifica(60, 'w1', 'tu1'),
    // La richiesta dopo la notifica fallisce (rete giù): Claude Code scrive un
    // messaggio «<synthetic>» con usage a zero, che non tocca la cache.
    turno(61, { model: '<synthetic>', cw: 0, cr: 0 }),
    // Il primo turno vero arriva 68 minuti dopo l'ultimo che ha usato la cache: è scaduta.
    turno(70, { cw: 200000, cr: 0 }),
  ];
  const { attesaPrimaS } = finestraOrchestratore(linee);
  expect(attesaPrimaS).toBe(68 * 60);
});
