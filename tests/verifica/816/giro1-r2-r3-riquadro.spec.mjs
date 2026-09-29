// #816 — primo giro, rilievi 2 e 3 sul riquadro delle segnalazioni chiuse col portafoglio:
// r2, una segnalazione chiusa senza modifiche non si congeda con «Fantastico!»;
// r3, la X di chiusura non copre il totale dei crediti.

import { test, expect } from '../../fixtures/electron.mjs';
import { banco, apriBanco, chiudiBanco, riscatta, homeDiAvvio, semina } from './aiuti.mjs';

test.beforeAll(apriBanco);
test.afterAll(chiudiBanco);
test.beforeEach(() => banco.azzera());

async function riquadro(app, page, schede, tema) {
  await semina(app, schede);
  await page.emulateMedia({ colorScheme: tema });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(900);
}

test('r2 — solo archiviata: il pulsante non festeggia una segnalazione chiusa senza modifiche', async ({ app }) => {
  const page = await homeDiAvvio(app);
  await page.waitForTimeout(500);
  await riscatta(app);
  const adesso = new Date().toISOString();
  await riquadro(app, page, [
    { _id: 'fbArch', status: 'archived', statusPublic: 'closed', name: 'Un doppione', seq: 904, subSeq: 0, userNote: '', reward: 50, createdAt: adesso, resolvedAt: adesso },
  ], 'light');
  await page.screenshot({ path: 'tests/.shots/816-r2-archiviata.png' }).catch(() => {});
  await expect(page.locator('.dash-recap-title')).toHaveText('Grazie! Il tuo feedback è stato chiuso');
  await expect(page.locator('.dash-thanks-item-body')).toHaveText('L’abbiamo chiuso senza modifiche.');
  await expect(page.locator('#thanksOverlay button').filter({ hasText: 'Fantastico!' })).toHaveCount(0);
});

test('r3 — risolte premiate: la X di chiusura sta fuori dal totale dei crediti, in chiaro e in scuro', async ({ app }) => {
  const page = await homeDiAvvio(app);
  await page.waitForTimeout(500);
  await riscatta(app);
  const adesso = new Date().toISOString();
  banco.grants = [
    { at: adesso, credits: 50, why: 'feedback_closed:fbA' },
    { at: adesso, credits: 70, why: 'feedback_closed:fbB' },
    ...banco.grants,
  ];
  const schede = [
    { _id: 'fbA', status: 'done', statusPublic: 'closed', name: 'Prima cosa', seq: 901, subSeq: 0, userNote: 'Sistemata.', reward: 300, createdAt: adesso, resolvedAt: adesso },
    { _id: 'fbB', status: 'done', statusPublic: 'closed', name: 'Seconda cosa', seq: 902, subSeq: 0, userNote: '', reward: 100, createdAt: adesso, resolvedAt: adesso },
  ];
  await riquadro(app, page, schede, 'dark');
  await page.screenshot({ path: 'tests/.shots/816-r3-scuro.png' }).catch(() => {});
  await expect(page.locator('.dash-thanks-total')).toContainText('+120 crediti');
  const totale = await page.locator('.dash-thanks-total').boundingBox();
  const x = await page.locator('.dash-recap-x').boundingBox();
  const siToccano = !(x.x >= totale.x + totale.width || x.x + x.width <= totale.x
    || x.y >= totale.y + totale.height || x.y + x.height <= totale.y);
  expect(siToccano, `X ${JSON.stringify(x)} sopra il totale ${JSON.stringify(totale)}`).toBe(false);
});
