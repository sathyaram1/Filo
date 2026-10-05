// Verifica #675, giro 1: Gestione → Automazioni, scelte salvate a poca distanza.

import { test, expect } from '../../fixtures/electron.mjs';
import { apri, cambia } from './banco.mjs';

test('due interruttori dell\'auto-approvazione toccati di fila restano entrambi come scelti', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => { window.__delayAuto = [600, 0]; });
  await cambia(page, 'mgAutoApproveOwner', false);
  await cambia(page, 'mgAutoApproveUser', false);
  await page.waitForTimeout(1500);
  const mappa = await page.evaluate(() => window.__mappa);
  expect(mappa.owner).toBe(false);
  expect(mappa.user).toBe(false);
  await expect(page.locator('#mgAutoApproveOwner')).not.toBeChecked();
  await expect(page.locator('#mgAutoApproveUser')).not.toBeChecked();
});
