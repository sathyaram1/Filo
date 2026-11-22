// Esplorazione: dopo l'OK a un programma per la barra, Filo riprende da solo?
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

test('ripresa dopo OK', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('barra-esplora');
  const gioco = path.join(dir, 'Gioco');
  fs.writeFileSync(gioco, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(gioco, 0o755);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'BARRA_SITI', arguments: JSON.stringify({ operazione: 'aggiungi', elemento: gioco, nome: 'Gioco' }) }] },
    { text: 'Ti chiedo conferma.' },
    { text: 'Risposta finale.' },
  ]);
  try {
    await page.locator('#input').fill('metti il mio gioco nella barra');
    await page.locator('#sendBtn').click();
    const btn = page.locator('button.dash-action-btn', { hasText: 'nella barra dei siti' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' })).toHaveCount(1, { timeout: 15_000 });
    await btn.click();
    await clickConfirm(page, 'ok');
    await expect(btn).toHaveText(/^[✓✗]/, { timeout: 15_000 });
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 15_000 }).toBe(3);
  } finally { await ripristina(app); }
});
