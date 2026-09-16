// Prove del giro 1 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 5: a fine sessione uno script produce il rapporto (costi, tempi,
// strumenti, errori) dal transcript. Qui il transcript è scritto a mano, con
// le forme viste nei file veri: un messaggio su due righe con lo stesso id, un
// tool_use e il suo tool_result, un timeout, un errore, un sotto-agente.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { generaRapporto, analizzaRighe } from '../../../scripts/session-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'session-report.mjs');

const USO1 = { input_tokens: 100, cache_creation_input_tokens: 30000, cache_read_input_tokens: 0, output_tokens: 50 };
const USO2 = { input_tokens: 10, cache_creation_input_tokens: 25000, cache_read_input_tokens: 0, output_tokens: 20 };
const RIGHE = [
  { type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', sessionId: 'sess-1', message: { id: 'm1', model: 'claude-opus-5', usage: USO1, content: [{ type: 'text', text: 'ciao' }] } },
  { type: 'assistant', timestamp: '2026-09-16T10:00:01.000Z', sessionId: 'sess-1', message: { id: 'm1', model: 'claude-opus-5', usage: USO1, content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } },
  { type: 'user', timestamp: '2026-09-16T10:05:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Command timed out after 2m 0s' }] } },
  { type: 'assistant', timestamp: '2026-09-16T10:06:00.000Z', message: { id: 'm2', model: 'claude-opus-5', usage: USO2, content: [{ type: 'tool_use', id: 't2', name: 'Agent' }] } },
  { type: 'user', timestamp: '2026-09-16T10:07:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'fatto' }] }] } },
];
const SOTTO = [
  { type: 'assistant', timestamp: '2026-09-16T10:06:10.000Z', message: { id: 's1', model: 'claude-opus-5', usage: { input_tokens: 0, cache_creation_input_tokens: 100000, cache_read_input_tokens: 0, output_tokens: 1000 }, content: [{ type: 'text', text: 'lavoro del sotto-agente' }] } },
];

function scriviTranscript() {
  const dir = cartellaTemporanea('giro-routine-rapporto-');
  const file = join(dir, 'sess-1.jsonl');
  writeFileSync(file, RIGHE.map((r) => JSON.stringify(r)).join('\n') + '\n');
  mkdirSync(join(dir, 'sess-1', 'subagents'), { recursive: true });
  writeFileSync(join(dir, 'sess-1', 'subagents', 'agent-abc.jsonl'), SOTTO.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { dir, file };
}

test.describe('rapporto di fine sessione — dai numeri del transcript', () => {
  test('conta turni, token, costo, strumenti, timeout, errori, sotto-agenti e durata', async () => {
    const rep = await analizzaRighe(RIGHE.map((r) => JSON.stringify(r)), { role: 'verifier', ticket: 'abc' });
    expect(rep.sessionId).toBe('sess-1');
    expect(rep.turns).toBe(2);
    expect(rep.coldTurns).toBe(1);
    expect(rep.tokens).toEqual({ input: 110, cacheRead: 0, cacheWrite: 55000, output: 70 });
    expect(rep.costUsd).toBeCloseTo(0.346, 3);
    expect(rep.tools.total).toBe(2);
    expect(rep.tools.byName).toEqual({ Bash: 1, Agent: 1 });
    expect(rep.tools.timeouts).toBe(1);
    expect(rep.tools.errors).toBe(1);
    expect(rep.subagents).toBe(1);
    expect(rep.longestToolS).toBe(300);
    expect(rep.durationS).toBe(420);
    expect(rep.models).toEqual(['claude-opus-5']);
    expect(rep.role).toBe('verifier');
    expect(rep.ticket).toBe('abc');
  });

  test('dalla riga di comando: JSON su stdout, riassunto su stderr, mai un fallimento', () => {
    const { file } = scriviTranscript();
    const r = spawnSync(process.execPath, [SCRIPT, '--transcript', file, '--role', 'verifier', '--ticket', 'abcdefghijk'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const rep = JSON.parse(r.stdout);
    expect(rep.role).toBe('verifier');
    expect(rep.turns).toBe(2);
    expect(r.stderr).toMatch(/costo stimato: \$0\.34/);
    expect(r.stderr).toMatch(/strumenti: 2 \(timeout 1, errori 1, sotto-agenti 1/);
    const senza = spawnSync(process.execPath, [SCRIPT, '--transcript', join(file, '..', 'non-esiste.jsonl')], { cwd: ROOT, encoding: 'utf8' });
    expect(senza.status).toBe(0);
    expect(JSON.parse(senza.stdout).notes.join(' ')).toMatch(/assente/);
  });

  test('i sotto-agenti costano anche loro: il costo del rapporto li comprende', async () => {
    // Le sessioni delegano (CLAUDE.md: «le esplorazioni si delegano»), e i
    // transcript dei sotto-agenti stanno in <sessione>/subagents/*.jsonl con i
    // loro token. Su una sessione vera di questa macchina: il rapporto della
    // sessione madre dice 29 $, UN solo sotto-agente dei suoi diciassette ne
    // vale 55. Un costo che ignora i sotto-agenti è un costo sbagliato di
    // parecchie volte proprio nelle sessioni che costano di più.
    test.fail(true, 'rilievo aperto del giro 1: il rapporto legge solo il transcript della sessione madre');
    const { file } = scriviTranscript();
    const rep = await generaRapporto({ transcript: file, role: 'verifier' });
    expect(rep.tokens.output).toBe(70 + 1000);
    expect(rep.costUsd).toBeGreaterThan(0.99);
  });
});
