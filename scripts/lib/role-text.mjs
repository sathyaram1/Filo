// Composizione dei testi di ruolo: un pezzo condiviso fra più ruoli vive in un
// file solo, e il ruolo lo richiama con `<!-- includi: _nome.md -->`.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INCLUDI = /^[ \t]*<!--\s*includi:\s*(_[a-z0-9-]+\.md)\s*-->[ \t]*$/gim;

// Qualunque forma di richiamo, anche quelle che non so espandere: serve a
// riconoscerle per fermare.
const RICHIAMO = /<!--\s*includi:/i;
// Un pezzo condiviso può richiamarne un altro: si espande a giri, con un tetto
// che trasforma un anello (A richiama B che richiama A) in un errore invece che
// in un ciclo infinito.
const GIRI_MAX = 8;

// Un ruolo consegnato con un buco dentro lavora senza una parte delle regole, e
// nessuno se ne accorge: quindi ferma sia il pezzo che MANCA, sia un richiamo
// rimasto lì (annidato oltre il tetto, scritto in coda a una riga, o con un
// nome che questo strumento non riconosce).
export function espandiInclusioni(testo, dir) {
  let out = String(testo || '');
  for (let giro = 0; giro < GIRI_MAX && RICHIAMO.test(out); giro++) {
    const prima = out;
    out = out.replace(INCLUDI, (_, nome) => {
      const f = resolve(dir, nome);
      if (!existsSync(f)) throw new Error(`testo di ruolo: manca il pezzo condiviso ${nome} in ${dir}`);
      return readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
    });
    if (out === prima) break;
  }
  if (RICHIAMO.test(out)) {
    const riga = (out.split('\n').find((r) => RICHIAMO.test(r)) || '').trim();
    throw new Error(`testo di ruolo: richiamo a un pezzo condiviso non espanso, in ${dir} — «${riga}». Va da solo su una riga sua, col nome nella forma _nome.md, e senza anelli fra i pezzi.`);
  }
  return out;
}
