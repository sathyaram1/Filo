// Verifica #663.6 giro 2: ogni Filo aperto da una prova (rete finta, lancio diretto) parte già accolto.
// Chi scrive in chat due secondi dopo aver messo il modello, come una persona, trova la risposta e non l'intervista.
import { test as reteTest, expect } from '../../helpers/reteFinta.mjs';
import { test as baseTest } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function rispondeLaChat(app) {
  const page = await home(app);
  const benvenuto = await app.evaluate(() => globalThis.SN_ONBOARDING.WELCOME_MESSAGE.split('.')[0]);
  await modelloFinto(app, [{ text: 'RISPOSTA-6636' }]);
  try {
    await page.waitForTimeout(2000);
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-6636' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: benvenuto })).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
}

reteTest('rete finta: modello messo a home aperta, domanda dopo due secondi, risponde la chat', async ({ app }) => {
  reteTest.setTimeout(60_000);
  await rispondeLaChat(app);
});

baseTest('lancio diretto: modello messo a home aperta, domanda dopo due secondi, risponde la chat', async () => {
  baseTest.setTimeout(60_000);
  const userData = cartellaTemporanea('filo-6636-');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    await rispondeLaChat(app);
  } finally {
    await chiudiApp(app);
    try { togliCartella(userData); } catch (_) {}
  }
});
