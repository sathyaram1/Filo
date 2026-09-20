// Composizione dei testi di ruolo: un pezzo condiviso fra più ruoli vive in un
// file solo, e il ruolo lo richiama con `<!-- includi: _nome.md -->`.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INCLUDI = /^[ \t]*<!--\s*includi:\s*(_[a-z0-9-]+\.md)\s*-->[ \t]*$/gim;

// Un incluso che manca ferma: un ruolo consegnato con un buco dentro lavora
// senza una parte delle regole, e nessuno se ne accorge.
export function espandiInclusioni(testo, dir) {
  return String(testo || '').replace(INCLUDI, (_, nome) => {
    const f = resolve(dir, nome);
    if (!existsSync(f)) throw new Error(`testo di ruolo: manca il pezzo condiviso ${nome} in ${dir}`);
    return readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  });
}
