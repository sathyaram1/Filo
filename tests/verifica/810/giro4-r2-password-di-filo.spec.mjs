// Verifica #810, giro 4, rilievo 2: la password che Filo stesso propone viene presa, al messaggio
// dopo, per una password letta da fuori, e il comando che la usa non parte.

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, newtab } from './aiuti.mjs';

test('la password proposta da Filo si usa al messaggio dopo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaModelli(app);
  await modelloFinto(app, { giri: [{ text: 'Ti propongo questa password: Tr7#kq29Lm. Salvala in un posto sicuro.' }] });
  await page.locator('#input').fill('generami una password sicura per il nuovo account');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti propongo' })).toBeVisible({ timeout: 20_000 });
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'echo Tr7#kq29Lm' }) }] },
      { text: 'Fatto.' },
    ],
  });
  await page.locator('#input').fill('ok, scrivila nel terminale così la copio');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 20_000 });
  const attivita = page.locator('.dash-activity').last();
  await expect(attivita).not.toContainText('fermato');
});
