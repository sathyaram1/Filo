// La prossima versione secondo il manifesto, con la regola del server che la pubblica: `prossimaVersione` di primo
// livello se c'è, altrimenti patch+1. Un campo che il server rifiuterebbe è un errore, mai un ripiego su patch+1.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared', 'patchNotes.js'));
const { cmpVersion } = globalThis.SN_PATCH_NOTES;

export const CAMPO = 'prossimaVersione';
const A_B_C = /^\d+\.\d+\.\d+$/;

/** `{ versione, dichiarata }`, o `{ errore }` col perché. */
export function prossimaVersione(manifesto) {
  const attuale = String((manifesto && manifesto.version) || '');
  if (!A_B_C.test(attuale)) return { errore: `la versione del manifesto «${attuale}» non è nella forma a.b.c` };
  if (!Object.hasOwn(manifesto, CAMPO)) {
    const [a, b, c] = attuale.split('.').map(Number);
    return { versione: `${a}.${b}.${c + 1}`, dichiarata: false };
  }
  const dichiarata = manifesto[CAMPO];
  if (typeof dichiarata !== 'string' || !A_B_C.test(dichiarata)) {
    return { errore: `«${CAMPO}» nel manifesto vale ${JSON.stringify(dichiarata)}: serve un numero a.b.c, come "0.3.0". `
      + 'Il server rifiuterebbe la pubblicazione: correggilo o toglilo.' };
  }
  if (cmpVersion(dichiarata, attuale) <= 0) {
    return { errore: `«${CAMPO}» nel manifesto è ${dichiarata}, non più alta della versione ${attuale}. `
      + 'Il server rifiuterebbe la pubblicazione: alzalo o toglilo.' };
  }
  return { versione: dichiarata, dichiarata: true };
}
