// Verifica locale di Gestione a sezioni, giro 1, rilievo 2: la scelta automatica d'apertura non deve portare via
// l'owner da quello che ha già cominciato a fare (una pratica aperta, una ricerca scritta) mentre le domande arrivano.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from './aiuto.mjs';

const LENTE = 8000;

async function apriConDomandeLente(app, openTab) {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(12, { priorita: 'bloccante' })], domandeLente: LENTE });
  const page = await openTab(MANAGE);
  // I feedback arrivano prima delle domande: l'owner li vede e comincia a lavorare.
  await expect(page.locator('.mg-item').first()).toBeVisible({ timeout: LENTE - 1000 });
  return page;
}

test('r2 una pratica aperta mentre le domande arrivano resta a schermo', async ({ app, openTab }) => {
  const page = await apriConDomandeLente(app, openTab);
  await page.locator('.mg-item', { hasText: '#805' }).click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await aspettaAvvio(page);
  await page.waitForTimeout(500);
  await expect(page.locator('.mg-sezione--active')).toHaveAttribute('data-sezione', 'feedback');
  await expect(page.locator('#panel-list')).toBeVisible();
  await expect(page.locator('#mgDetail')).toBeVisible();
});

test('r2 una ricerca scritta mentre le domande arrivano non si chiude', async ({ app, openTab }) => {
  const page = await apriConDomandeLente(app, openTab);
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('il tasto destro');
  await aspettaAvvio(page);
  await page.waitForTimeout(500);
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await expect(page.locator('#mgSearchInput')).toHaveValue('il tasto destro');
});
