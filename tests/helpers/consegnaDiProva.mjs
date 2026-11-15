// Una consegna con la prova accanto (#2505) buona, per i test che mettono in revisione da un deposito usa e getta: il
// JSON fuori dal deposito e il riferimento di origin/main da cui il canale misura il ramo, senza un remoto vero.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from './percorsi.mjs';
import '../../src/shared/consegna.js';

export function consegnaBuona(extra = {}) {
  return {
    criteri: globalThis.SN_CONSEGNA.CRITERI.map((k) => ({ criterio: k.n, esito: 'fatto', prova: `tests/unit/prova${k.n}.test.mjs, caso «uno»` })),
    classe: { valore: 'nascosto', motivo: 'Cambia la logica del canale, non i dati salvati.' },
    ...extra,
  };
}

/** Il file JSON di una consegna, fuori da ogni deposito. */
export function fileConsegna(consegna = consegnaBuona()) {
  const file = join(cartellaTemporanea('filo-consegna-prova-'), 'consegna.json');
  writeFileSync(file, JSON.stringify(consegna));
  return file;
}

/** Gli argomenti `--consegna <file>` per una messa in revisione da `casa` senza remoto; `base`: dove il ramo si stacca. */
export function argomentiConsegna(casa, { base = 'main', consegna = consegnaBuona() } = {}) {
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', base], { cwd: casa });
  return ['--consegna', fileConsegna(consegna)];
}
