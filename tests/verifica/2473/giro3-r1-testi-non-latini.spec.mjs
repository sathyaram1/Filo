// #2473 giro 3: la stima dei token della chat non deve stare sotto il contatore di Anthropic nemmeno per un testo incollato
// in cinese, con molte emoji o fatto di cifre. Misure del 18/11 su claude-haiku-5.5 (OpenRouter, solo Anthropic).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const loader = fs.readFileSync(path.join(radice, 'src/main/services/loader.js'), 'utf8');
for (const m of loader.matchAll(/require\(path\.join\(SHARED, '([^']+)'\)\)/g)) {
  try { require(path.join(radice, 'src/shared', m[1])); } catch (_) { /* un modulo che vuole il main */ }
}
const FC = globalThis.SN_FILO_CONTESTO;

const MISURE = [
  { pezzo: 'cinese', testo: '蜜蜂回到蜂巢，为同伴们跳舞。今天天气很好，我们去公园散步吧。'.repeat(60), token: 2459 },
  { pezzo: 'emoji', testo: '😀🎉🐝🌻❤️👍'.repeat(150), token: 2399 },
  { pezzo: 'cifre', testo: Array.from({ length: 1500 }, (_, i) => String((i * 7919) % 100000)).join(', ').slice(0, 8000), token: 4634 },
];

for (const m of MISURE) {
  test(`r1 un testo ${m.pezzo} incollato in chat non passa i 100.000 token veri prima della soglia di serie`, () => {
    expect(FC.stimaToken(m.testo), `stimati contro i ${m.token} di Anthropic`).toBeGreaterThanOrEqual(m.token);
    const caratteri = FC.TETTI_DI_SERIE.soglia * FC.CARATTERI_PER_TOKEN;
    const veri = Math.ceil((caratteri * m.token) / m.testo.length);
    expect(veri, `${caratteri} caratteri ${m.pezzo} alla soglia`).toBeLessThanOrEqual(100000);
  });
}
