// #871 verifica giro 1, rilievo 3: il manifesto che Filo legge per spiegarsi non manda più
// l'utente dove le voci non ci sono più (la fila in alto della home, «Ricarica» nel menu).

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('il manifesto dice dove stanno davvero Cronologia, Impostazioni, App, Profilo e Ricarica', () => {
  require(resolve(ROOT, 'src', 'shared', 'capabilities.js'));
  const C = globalThis.SN_CAPABILITIES;
  const testo = (id) => { const c = C.get(id); return `${c.desc || ''} ${c.invoke || ''}`; };

  const home = testo('home-page');
  expect(home, 'la home non ha più la fila di icone in alto').not.toMatch(/in alto a destra ci sono le icone/i);

  const errore = testo('network-error-page');
  expect(errore, '«Ricarica» non sta più nel menu del tasto destro').not.toMatch(/Ricarica"? dal menu/i);
});
