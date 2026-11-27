// Verifica #2681, giro 16: il CVV chiamato col suo nome in arabo, ebraico, cinese, giapponese, coreano, svedese, turco
// o ceco deve sparire da ciò che arriva al modello come «CVV: 123».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const P = require(join(resolve(process.cwd()), 'src', 'shared', 'pavimento.js'));

test('r1 il nome del CVV nelle lingue non ancora riconosciute', () => {
  for (const t of [
    'رمز الأمان هو 123',
    'رمز التحقق: 123',
    'קוד האבטחה הוא 123',
    'קוד אבטחה: 123',
    '安全码: 123',
    'セキュリティコード: 123',
    '보안 코드: 123',
    'Säkerhetskod: 123',
    'Güvenlik kodu: 123',
    'Bezpečnostní kód: 123',
  ]) expect(P.oscura(t), t).not.toContain('123');
});
