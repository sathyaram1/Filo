// #1170 giro 2, rilievo 1: il rapporto della chiusura dell'orchestratore non porta la versione del listino che main
// scrive in ogni rapporto (#882), anche quando il transcript non si trova. Non apre Filo.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { cartellaTemporanea, togliCartella } = await import(pathToFileURL(resolve(ROOT, 'tests', 'helpers', 'percorsi.mjs')).href);
const { rapportoChiusura, rapportoVuoto, LISTINO } = await import(pathToFileURL(resolve(ROOT, 'scripts', 'session-report.mjs')).href);

const riga = (id, ts, usage) => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId: 'orch',
  message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 0, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage }, content: [{ type: 'text', text: id }] },
});

test('r1 il rapporto della chiusura porta la versione del listino, come quello di un biglietto', async () => {
  expect(rapportoVuoto({ role: 'verifier' }).listino).toBe(LISTINO);
  const base = cartellaTemporanea('filo-1170-g2-');
  try {
    mkdirSync(base, { recursive: true });
    const main = join(base, 'orch.jsonl');
    writeFileSync(main, [
      riga('c1', '2026-10-07T13:10:05.000Z', { cache_creation_input_tokens: 34000 }),
      riga('c2', '2026-10-07T13:10:30.000Z', { cache_read_input_tokens: 34000 }),
    ].join('\n') + '\n');
    const r = await rapportoChiusura({ transcript: main });
    expect(r.closing).toBe(true);
    expect(r.turns).toBeGreaterThan(0);
    expect(r.listino).toBe(LISTINO);
    const assente = await rapportoChiusura({ transcript: join(base, 'non-c-e.jsonl') });
    expect(assente.listino).toBe(LISTINO);
  } finally { togliCartella(base); }
});
