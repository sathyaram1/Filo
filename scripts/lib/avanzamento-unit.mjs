// Reporter di `node --test` per il lanciatore degli unit: una riga per ogni evento, su file, perché il lanciatore veda
// se la corsa va avanti; dei file dice quando partono e quando finiscono. Non scrive su stdout.
// Sentinella: tests/unit/unitRunner.test.mjs.
import { resolve } from 'node:path';

export default async function* avanzamentoUnit(source) {
  for await (const ev of source) {
    const d = ev.data || {};
    // Il test che node crea per ogni file ha per nome il percorso dato sulla riga; quelli dentro il file no.
    const delFile = d.nesting === 0 && d.file && typeof d.name === 'string' && resolve(d.name) === resolve(d.file);
    if (delFile && ev.type === 'test:dequeue') yield `${JSON.stringify({ via: d.file })}\n`;
    else if (delFile && ev.type === 'test:complete') yield `${JSON.stringify({ fine: d.file })}\n`;
    else yield '{}\n';
  }
}
