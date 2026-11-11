// #2324 giro 1 — un worker che chiude il turno senza handback mentre un suo sotto-agente lavora ancora (una notifica lo
// risveglia): la veglia non deve rilasciarne il biglietto dopo due minuti di silenzio del figlio.
import { test, expect } from '@playwright/test';
import { chiusuraDi, strumentoInAttesa, veglia, USCITA_LAVORA } from '../../../scripts/lib/veglia-worker.mjs';

const ADESSO = Date.parse('2026-11-08T05:40:00Z');
const ts = (minFa) => new Date(ADESSO - minFa * 60000).toISOString();

test('r2 worker in attesa del suo sotto-agente, figlio in un comando da tre minuti: la veglia lo lascia lavorare', async () => {
  const worker = [
    { type: 'assistant', timestamp: ts(6), message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { prompt: 'lettura del diff' } }] } },
    { type: 'user', timestamp: ts(6), message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'Agent launched in background' }] } },
    { type: 'assistant', timestamp: ts(5), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Aspetto la lettura del diff.' }] } },
  ];
  const figlio = [
    { type: 'assistant', timestamp: ts(3), message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'node lettura-diff.mjs' } }] } },
  ];
  const chiusoMs = chiusuraDi(worker);
  const attesa = strumentoInAttesa(figlio);
  expect(Number.isFinite(chiusoMs)).toBe(true);
  expect(attesa && attesa.nome).toBe('Bash');

  const segni = {
    mio: true, finito: false, tempi: [Date.parse(ts(3))], processi: 0, comandi: [], processiLetti: true, chiusoMs,
    tracce: { viste: true, ultimoMs: Date.parse(ts(3)), attesa, elenco: [], chiusoMs },
  };
  let rilasciato = false;
  const r = await veglia({
    leggi: () => segni,
    rilascia: () => { rilasciato = true; return { ok: true }; },
    adesso: () => ADESSO, dorme: async () => {}, fetta: 1000, passo: 1000,
  });
  expect(rilasciato).toBe(false);
  expect(r.uscita).toBe(USCITA_LAVORA);
});
