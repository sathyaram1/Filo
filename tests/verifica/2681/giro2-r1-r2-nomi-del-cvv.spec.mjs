// Verifica #2681, secondo giro: il CVV chiamato con un nome meno frequente della sua lingua (r1), o col nome scritto
// con gli accenti scomposti (r2), deve sparire da ciò che arriva al modello come «CVV: 123».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const P = require(join(resolve(process.cwd()), 'src', 'shared', 'pavimento.js'));

const tolto = (t) => expect(P.oscura(t), t).not.toContain('123');

test('r1 i nomi meno frequenti del CVV nelle lingue delle etichette', () => {
  for (const t of [
    'Защитный код карты: 123',
    'Проверочный код: 123',
    'Kod zabezpieczający: 123',
    'Kod zabezpieczający karty to 123',
    'Código verificador do cartão: 123',
    'O código verificador é 123',
    'De controlecode is 123',
  ]) tolto(t);
});

test('r2 il nome del CVV con gli accenti scomposti', () => {
  for (const t of [
    'El código de seguridad es 123',
    'Die Kartenprüfnummer ist 123',
    'Le code de sécurité est 123',
  ]) tolto(t);
});
