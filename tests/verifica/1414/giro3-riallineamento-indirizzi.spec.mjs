// #1414 giro 3 (riallineamento): nello stesso punto di Gestione convivono gli indirizzi delle pagine dell'owner
// (#utenti, #predefiniti) e quello delle domande arrivato da main (#domanda=D-n). Prova senza rilievo: la zona del conflitto.

import { test, expect } from '../../fixtures/electron.mjs';
import { GESTIONE } from '../../helpers/gestione.mjs';

const base = { clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x', pipeline: { action: 'human_review', verdicts: [] } };
const FB = { ...base, _id: 'fb-att', seq: 901, name: 'Colore del tema', status: 'design', statusReason: 'clarify', domandaId: 'D-7' };
const D7 = { id: 'D-7', numero: 7, stato: 'aperta', priorita: 'importante', titolo: '#901, domanda sul tema', problema: 'Caldo o freddo?', creataIl: Date.now(), origine: { tipo: 'feedback', id: 'fb-att' } };

test('nella stessa Gestione: #domanda apre la domanda, #utenti e #predefiniti le schede dell\'owner, e l\'indirizzo torna pulito', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FB]);
  await page.evaluate((ds) => window.__mgTest.setDomande(ds, {}), [D7]);

  await page.evaluate(() => { location.hash = '#domanda=D-7'; });
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"]')).toBeVisible();
  await expect.poll(() => page.url()).toBe(GESTIONE);

  await page.evaluate(() => { location.hash = '#utenti'; });
  await expect(page.locator('.mg-tab--active[data-tab="utenti"]')).toBeVisible();
  await expect(page.locator('#panel-utenti')).toBeVisible();
  await expect.poll(() => page.url()).toBe(GESTIONE);

  await page.evaluate(() => { location.hash = '#predefiniti'; });
  await expect(page.locator('.mg-tab--active[data-tab="predefiniti"]')).toBeVisible();
  await expect.poll(() => page.url()).toBe(GESTIONE);

  await page.evaluate(() => { location.hash = '#domanda=D-7'; });
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"]')).toBeVisible();
});
