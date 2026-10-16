// LE DOMANDE DAL VIVO E L'APERTURA DELLA GESTIONE (#1150, verifica locale giro 1).
//   1. Una domanda nata con la pagina aperta entra nel contatore delle Domande al giro dopo, senza aprire la sezione.
//   2. L'apertura va su Domande con una bloccante, ma non porta via l'owner da una pratica o da una ricerca cominciate.
//   3. Una rilettura che fallisce tiene a schermo le domande già lette, la risposta a metà e l'esito appena dato (giro 2).
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

async function apriSuDomande(app, openTab, cfg) {
  await mainFinto(app, cfg);
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await expect(sezioneAccesa(page)).toHaveAttribute('data-sezione', 'domande');
  return page;
}

test('una rilettura che fallisce tiene a schermo la domanda aperta e la risposta a metà, e lo dice', async ({ app, openTab }) => {
  const cfg = { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(12, { priorita: 'bloccante' }), domanda(13), domanda(14)] };
  const page = await apriSuDomande(app, openTab, cfg);
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-14"] .mg-domanda-titolo').click();
  const art = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-14"]');
  await art.locator('.mg-dq-testo').fill('Risposta a metà');
  await mainFinto(app, { ...cfg, guasti: 1000 });
  await page.evaluate(() => window.__mgTest.setLiveTiming({ pollMs: 1000, clockMs: 200 }));
  const avviso = page.locator('#mgDomandeStato');
  await expect(avviso).toContainText('Non riesco ad aggiornare le domande', { timeout: 15000 });
  await expect(art.locator('.mg-dq-testo')).toHaveValue('Risposta a metà');
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-id="D-14"]')).toHaveClass(/mg-domanda--aperta/);
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(3)');
  await expect(page.locator('#mgDomandeRiprova')).toBeVisible();
  // La lettura dopo riesce: l'avviso se ne va e tutto resta dov'era.
  await mainFinto(app, cfg);
  await expect(avviso).toBeHidden({ timeout: 15000 });
  await expect(art.locator('.mg-dq-testo')).toHaveValue('Risposta a metà');
});

test('una risposta partita resta col suo esito anche se le riletture dopo falliscono, cambiando scheda compreso', async ({ app, openTab }) => {
  const cfg = { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(12, { priorita: 'bloccante' }), domanda(13)] };
  const page = await apriSuDomande(app, openTab, cfg);
  const art = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-12"]');
  await expect(art).toBeVisible();
  await mainFinto(app, { ...cfg, guasti: 1000 });
  await art.locator('button[data-scelta="0"]').click();
  await expect(art.locator('.mg-dq-msg')).toHaveText(/Mandata/);
  await expect(page.locator('#mgDomandeStato')).toContainText('Non riesco ad aggiornare le domande');
  await expect(art.locator('.mg-dq-msg')).toHaveText(/Mandata/);
  await page.locator('.mg-tab[data-tab="domande-lavoro"]').click();
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-id="D-12"]')).toBeVisible();
  await expect(page.locator('#mgDomandeStato')).toContainText('Non riesco ad aggiornare le domande');
});
