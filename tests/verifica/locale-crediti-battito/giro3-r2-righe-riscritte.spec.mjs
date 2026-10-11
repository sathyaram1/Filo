// Prova del giro 3 (verifica locale #1156): il consumo progressivo della sessione resta uguale al rapporto di fine
// sessione anche quando Claude Code riscrive in coda al registro righe già scritte (stesso uuid, stesso messaggio),
// come fa quando una sessione viene ripresa. Non apre Filo: è il conto letto dal registro.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const url = (p) => 'file:///' + join(ROOT, p).replace(/\\/g, '/');

let base = '';
test.afterAll(() => { if (base) togliCartella(base); });

test('r2 le righe riscritte da una ripresa non si contano due volte', async () => {
  const { consumoSessione } = await import(url('scripts/lib/consumo-progressivo.mjs'));
  const { generaRapporto } = await import(url('scripts/session-report.mjs'));
  base = cartellaTemporanea('filo-verifica-1156-r2-');
  const progetto = join(base, 'progetto');
  mkdirSync(join(base, 'repo', '.claude'), { recursive: true });
  mkdirSync(progetto, { recursive: true });
  const SID = 'sessione-ripresa-1';
  const file = join(progetto, `${SID}.jsonl`);
  const t = (m) => new Date(Date.parse('2026-10-10T10:00:00Z') + m * 60000).toISOString();
  const uso = (cr, cw, o) => ({ input_tokens: 4, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, output_tokens: o });
  const ass = (uuid, id, m, u) => JSON.stringify({ type: 'assistant', uuid, timestamp: t(m), sessionId: SID, message: { id, model: 'claude-opus-5-5', role: 'assistant', usage: u, content: [{ type: 'text', text: 'ok' }] } });
  const ute = (uuid, m) => JSON.stringify({ type: 'user', uuid, timestamp: t(m), sessionId: SID, message: { role: 'user', content: 'vai' } });
  const prima = [ute('u1', 0), ass('a1', 'msg_1', 1, uso(0, 40000, 800)), ute('u2', 2), ass('a2', 'msg_2', 3, uso(40000, 3000, 1200))];
  // La ripresa: metadati della sessione, poi le stesse righe di prima, identiche, e solo dopo un turno nuovo.
  const ripresa = [JSON.stringify({ type: 'last-prompt', lastPrompt: 'vai' }), JSON.stringify({ type: 'bridge-session', bridgeSessionId: 'b1' }), ...prima];
  const dopo = [ute('u3', 10), ass('a3', 'msg_3', 11, uso(43000, 2000, 600))];
  writeFileSync(file, [...prima, ...ripresa, ...dopo].join('\n') + '\n');
  const { consumo } = consumoSessione({ root: join(base, 'repo'), env: { FILO_TRANSCRIPT: file } });
  const rapporto = await generaRapporto({ transcript: file, cwd: join(base, 'repo') });
  expect(consumo.turni).toBe(3);
  expect(consumo.costUsd).toBe(rapporto.costUsd);
});
