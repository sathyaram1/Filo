// #1403.5 giro 7 — le etichette non latine che main copriva nel testo verso i modelli restano coperte dopo il
// riallineamento, insieme alle guardie del lavoro (codice d'errore, crittografia, cifratura).
import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');
const S = '[dato riservato]';

test('r1 le forme declinate e le varianti che main copriva arrivano ai modelli coperte', () => {
  for (const [etichetta, valore] of [
    ['Паролата', 'Ключ!Зима2024'], ['Пароли', 'Ключ!Зима2024'], ['Паролем', 'Ключ!Зима2024'],
    ['Κωδικού', 'Κλειδί!2024'], ['κωδικοί', 'Κλειδί!2024'], ['暗証番号', '4821x9Zq'], ['패스워드', 'Pass2024!'],
  ]) {
    expect(P.oscura(`${etichetta}: ${valore}`), etichetta).toBe(`${etichetta}: ${S}`);
  }
});

test('le guardie del lavoro tengono: i codici che non sono la password restano interi', () => {
  for (const t of ['κωδικός σφάλματος: 10431', '密码学: 2024年课程', '암호화: AES256']) {
    expect(P.oscura(t), t).toBe(t);
  }
  expect(P.oscura('пароль: Ключ!Зима2024')).toBe(`пароль: ${S}`);
});
