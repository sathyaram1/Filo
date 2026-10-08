// Verifica #667, giro 11 (riallineamento su main): la griglia dei modelli per
// azione, ridisegnata a ogni cambio arrivato da fuori, si mangia il messaggio
// che spiega perché un modello non si può assegnare a quella funzione.

import { test, expect } from '../../fixtures/electron.mjs';

test('r1 un modello che non va bene per la funzione resta spiegato, non sparisce in silenzio', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 6_000 });

  const riga = page.locator('#modelsGrid > div').filter({ hasText: 'Spiega (inline)' });
  const seg = riga.locator('.sn-chain-seg').first();
  const input = seg.locator('.sn-chain-input');
  const prima = await input.inputValue();

  // Una voce che legge ad alta voce, data a una funzione che scrive testo.
  await input.fill('kokoro');
  await page.keyboard.press('Tab');

  await expect(seg.locator('.sn-chain-msg'), 'il perché del rifiuto si deve leggere').toBeVisible({ timeout: 4_000 });
  await expect(input).toHaveValue(prima);
});
