// Verifica #1787 giro 3: dopo il riallineamento il contesto del manutentore deve dare la spesa come la scheda Crediti
// (dollari dell'account dalla taratura, quelli delle routine a parte, la quota di oggi), non i soli dollari delle routine.
import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 con una lettura della barra la riga del manutentore porta i dollari dell\'account e la quota di oggi', async () => {
  const M = await import(pathToFileURL(resolve(ROOT, 'scripts', 'manutentore.mjs')).href);
  // La risposta dell'operazione spesa del server: A al 70% letto dalla barra, 1.000 $ contati dalle routine.
  const righe = M.righeSpesa({
    ok: true, freni: 'attivi', numeri: { usdPer100: 2150 },
    accounts: {
      A: {
        pct: 70, lettura: 70, taratura: 2150, limite: 90, usdSettimana: 1000, usd24h: 300,
        accensioniSettimana: 20, accensioni24h: 5,
        passo: { spesoPct: 9, quotaPct: 10, spesoUsd: 193, quotaUsd: 215 },
        settimanaDaMs: Date.parse('2026-10-28T07:00:00Z'), rinnovoAtMs: Date.parse('2026-11-04T07:00:00Z'), fermo: '',
      },
    },
  });
  const riga = righe.join('\n').replace(/ /g, ' ');
  expect(riga, 'il 70% vale circa 1.505 $ con la taratura di 2.150 $').toMatch(/1[.,]?505/);
  expect(riga, 'i 1.000 $ sono delle sole routine, e la riga lo dice').toMatch(/routine/);
  expect(riga, 'la quota di oggi, il freno che ferma più spesso').toMatch(/oggi[^·,]*9%[^·,]*10%/);
});
