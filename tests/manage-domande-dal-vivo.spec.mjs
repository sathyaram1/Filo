// LE DOMANDE DAL VIVO E L'APERTURA DELLA GESTIONE (#1150, verifica locale giro 1).
//   1. Una domanda nata con la pagina aperta entra nel contatore delle Domande al giro dopo, senza aprire la sezione.
//   2. L'apertura va su Domande con una bloccante, ma non porta via l'owner da una pratica o da una ricerca cominciate.
import { test, expect } from './fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, rilasciaDomande, aspettaAvvio } from './helpers/gestioneMainFinto.mjs';

const sezioneAccesa = (page) => page.locator('.mg-sezione--active');

test('una bloccante nata a pagina aperta accende il contatore delle Domande al giro dopo', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(14, { priorita: 'quando_puoi' })] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  const domande = page.locator('.mg-sezione[data-sezione="domande"]');
  await expect(domande.locator('.mg-sezione-count')).toHaveText('(1)');
  await expect(sezioneAccesa(page)).toHaveAttribute('data-sezione', 'feedback');
  await page.evaluate(() => window.__mgTest.setLiveTiming({ pollMs: 1000, clockMs: 200 }));

  await mainFinto(app, {
    feedbacks: PRATICHE, riferimenti: RIFERIMENTI,
    domande: [domanda(14, { priorita: 'quando_puoi' }), domanda(20, { priorita: 'bloccante' })],
  });
  await expect(domande.locator('.mg-sezione-count')).toHaveText('(2)', { timeout: 15000 });
  await expect(domande).toHaveClass(/mg-sezione--urgente/);
  await expect(sezioneAccesa(page)).toHaveAttribute('data-sezione', 'feedback');
});

async function apriConDomandeTrattenute(app, openTab) {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(12, { priorita: 'bloccante' })], trattieni: true });
  const page = await openTab(MANAGE);
  await expect(page.locator('.mg-item').first()).toBeVisible({ timeout: 20000 });
  return page;
}

test('senza gesti dell’owner, una bloccante arrivata dopo i feedback apre Domande', async ({ app, openTab }) => {
  const page = await apriConDomandeTrattenute(app, openTab);
  await rilasciaDomande(app);
  await aspettaAvvio(page);
  await expect(sezioneAccesa(page)).toHaveAttribute('data-sezione', 'domande');
});

test('una pratica aperta mentre le domande arrivano resta a schermo', async ({ app, openTab }) => {
  const page = await apriConDomandeTrattenute(app, openTab);
  await page.locator('.mg-item', { hasText: '#805' }).click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await rilasciaDomande(app);
  await aspettaAvvio(page);
  await expect(sezioneAccesa(page)).toHaveAttribute('data-sezione', 'feedback');
  await expect(page.locator('#mgDetail')).toBeVisible();
  // La bloccante resta in vista dalla barra.
  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).toHaveClass(/mg-sezione--urgente/);
});

test('una ricerca scritta mentre le domande arrivano non si chiude', async ({ app, openTab }) => {
  const page = await apriConDomandeTrattenute(app, openTab);
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('il tasto destro');
  await rilasciaDomande(app);
  await aspettaAvvio(page);
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await expect(page.locator('#mgSearchInput')).toHaveValue('il tasto destro');
});
