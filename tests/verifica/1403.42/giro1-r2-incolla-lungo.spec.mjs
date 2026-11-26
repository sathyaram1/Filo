// Verifica #1403.42 giro 1: in un incolla lungo la password che l'utente dichiara in un'altra lingua resta sua, come in
// italiano: il main ora la riconosce nella pagina, e senza questo la tratterebbe come letta da fuori.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// In un processo a parte, con `window` come nel preload delle pagine.
function suoDiUnIncolla(frase) {
  const codice = `
    globalThis.window = {};
    const I = require(${JSON.stringify(join(ROOT, 'src', 'preload', 'immessi-utente.js'))});
    const riempi = 'Ciao Marta, ti scrivo i dati per entrare nel portale del condominio. '.repeat(20);
    process.stdout.write(I.diUnIncolla(riempi + '\\n' + ${JSON.stringify(frase)} + '\\n' + riempi));`;
  return execFileSync(process.execPath, ['-e', codice], { encoding: 'utf8' });
}

test('r2 un incolla lungo con la password dichiarata in tedesco o spagnolo la tiene dell\'utente', () => {
  expect(suoDiUnIncolla('la password è Gatto2024')).toContain('Gatto2024');
  expect(suoDiUnIncolla('das Passwort ist Gatto2024')).toContain('Gatto2024');
  expect(suoDiUnIncolla('la contraseña es Gatto2024')).toContain('Gatto2024');
});
