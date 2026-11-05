// Giro 1 della verifica #2182: il quadro del worker fermo elenca le tracce della sessione. Il worker precedente dello
// stesso giro, finito pochi secondi prima del biglietto nuovo, non è un sotto-agente di questo. Non apre Filo.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const { segniDiVita, quadroDelFermo } = await import('../../../scripts/lib/veglia-worker.mjs');
const { impronta, FILE_REGISTRO } = await import('../../../scripts/lib/orchestratore-cieco.mjs');

const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const SID = 'sessione-verifica-2182';
const MIN = 60 * 1000;
const fatti = [];
test.afterAll(() => { for (const d of fatti) { try { togliCartella(d); } catch (_) {} } });

const testo = (ora) => ({ type: 'assistant', timestamp: new Date(ora).toISOString(), message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }] } });

test('r1 il worker finito prima del biglietto non compare fra le tracce del worker fermo', () => {
  const root = cartellaTemporanea('filo-v2182-root-');
  const conf = cartellaTemporanea('filo-v2182-claude-');
  fatti.push(root, conf);
  const sub = join(conf, 'projects', '-home-user-Filo', SID, 'subagents');
  mkdirSync(sub, { recursive: true });
  const biglietto = Date.now() - 25 * MIN;
  writeFileSync(join(conf, FILE_REGISTRO), JSON.stringify({ voci: [{ impronta: impronta(B), ruolo: 'verifier', ora: new Date(biglietto).toISOString() }] }));
  const traccia = (nome, tipo, ultimaMs) => {
    const f = join(sub, `agent-${nome}.jsonl`);
    writeFileSync(f, `${JSON.stringify(testo(ultimaMs))}\n`);
    writeFileSync(join(sub, `agent-${nome}.meta.json`), JSON.stringify({ agentType: tipo }));
    utimesSync(f, new Date(ultimaMs), new Date(ultimaMs));
  };
  // Il worker del biglietto prima: ha scritto la sua ultima riga 30 secondi prima che l'orchestratore chiedesse questo.
  traccia('prima', 'routine-nuovo-lavoro', biglietto - 30 * 1000);
  traccia('adesso', 'routine-worker', biglietto + 2 * MIN);
  const q = quadroDelFermo(segniDiVita({ root, ticket: B, sessione: SID, configDir: conf, leggiProcessi: () => [] }));
  expect(q, q).not.toContain('routine-nuovo-lavoro');
  expect(q, q).toContain('nessun sotto-agente');
});
