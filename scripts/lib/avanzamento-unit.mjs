// Reporter di `node --test` per il lanciatore degli unit: una riga per ogni passo di una prova, su file, perché il
// lanciatore veda se la corsa va avanti; dei file dice quando partono e quando finiscono. Non scrive su stdout.
// Sentinella: tests/unit/unitRunner.test.mjs.
import { resolve } from 'node:path';

// Quello che un test stampa non è avanzamento: un file appeso in un ciclo che scrive non finirebbe mai (#1063).
const PASSI = new Set(['test:enqueue', 'test:dequeue', 'test:start', 'test:plan', 'test:pass', 'test:fail', 'test:complete']);

export default async function* avanzamentoUnit(source) {
  for await (const ev of source) {
    const d = ev.data || {};
    // Il test che node crea per ogni file ha per nome il percorso dato sulla riga; quelli dentro il file no.
    const delFile = d.nesting === 0 && d.file && typeof d.name === 'string' && resolve(d.name) === resolve(d.file);
    if (delFile && ev.type === 'test:dequeue') yield `${JSON.stringify({ via: d.file })}\n`;
    else if (delFile && ev.type === 'test:complete') yield `${JSON.stringify({ fine: d.file })}\n`;
    else if (PASSI.has(ev.type)) yield '{}\n';
  }
}
