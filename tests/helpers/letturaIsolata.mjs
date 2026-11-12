// La lettura recintata delle immagini (src/main/services/provenienzaIsolata.js) per le prove. Il suo thread non tiene
// vivo il processo: un intervallo vero acceso per tutto il file lo teneva vivo anche dietro una promessa rimasta a metà,
// e il file si appendeva invece di cadere rosso (#1231). Qui il processo resta vivo solo finché una lettura è in viaggio.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TENUTA = Symbol.for('filo.prove.letturaIsolata');

/** Il modulo, con `analizza` e `cercaMarchi` che tengono vivo il processo mentre aspettano il thread. */
export function letturaIsolata() {
  const isolata = require('../../src/main/services/provenienzaIsolata.js');
  if (isolata[TENUTA]) return isolata;
  for (const nome of ['analizza', 'cercaMarchi']) {
    const vera = isolata[nome];
    isolata[nome] = async (...a) => {
      const vivo = setInterval(() => {}, 60_000);
      try { return await vera(...a); } finally { clearInterval(vivo); }
    };
  }
  isolata[TENUTA] = true;
  return isolata;
}
