// Verifica #2121 giro 2, rilievo 1: il «risparmio max» dell'ora deve essere un tetto vero. Due sveglie del manutentore a
// 55 minuti, stesso prefisso: con la cache a un'ora la seconda leggerebbe il prefisso che oggi riscrive al primo turno.
import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const modulo = (p) => import(pathToFileURL(join(ROOT, p)).href);

const assistant = (id, ts, usage) => JSON.stringify({
  type: 'assistant', sessionId: `s-${ts}`, timestamp: ts,
  message: { id, model: 'claude-fable-5-1', role: 'assistant', usage, content: [{ type: 'text', text: 'ok' }] },
});
const sveglia = (ts1, ts2) => [
  JSON.stringify({ type: 'user', sessionId: `s-${ts1}`, timestamp: ts1, message: { role: 'user', content: 'sveglia' } }),
  // primo turno: scrive il prefisso comune (sistema, CLAUDE.md, ruolo), 30.000 token
  assistant(`a-${ts1}`, ts1, { input_tokens: 10, cache_creation_input_tokens: 30000, cache_read_input_tokens: 0, output_tokens: 100 }),
  assistant(`b-${ts1}`, ts2, { input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30000, output_tokens: 100 }),
];

test('r1 la seconda sveglia del manutentore a 55 minuti entra nel risparmio massimo dell\'ora', async () => {
  const { analizzaRighe } = await modulo('scripts/session-report.mjs');
  const { contoCache } = await modulo('scripts/manutentore.mjs');
  const prima = await analizzaRighe(sveglia('2026-11-05T08:00:00Z', '2026-11-05T08:01:00Z'), { role: 'manutentore', ticket: 't1' });
  const seconda = await analizzaRighe(sveglia('2026-11-05T08:55:00Z', '2026-11-05T08:56:00Z'), { role: 'manutentore', ticket: 't2' });
  const conto = contoCache([{ ruolo: 'manutentore', report: prima }, { ruolo: 'manutentore', report: seconda }]);
  // Con l'ora il primo turno della seconda sveglia legge i 30.000 token invece di scriverli: (12,5 − 0,25) $/M.
  const risparmioVero = 30000 * (12.5 - 0.25) / 1e6;
  expect(conto.totale.risparmioMax).toBeGreaterThanOrEqual(risparmioVero - 1e-6);
});
