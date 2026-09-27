// #511 giro 1: la ricerca a vuoto nella pagina feedback dice lo zero accanto alla
// casella, nei due temi, con input insoliti, e il contatore non resta muto.
import { test, expect } from '../../fixtures/electron.mjs';

const FAKE = Array.from({ length: 12 }, (_, i) => ({
  _id: `f${i}`, text: `Segnalazione numero ${i} sul pulsante copia`, name: `copia ${i}`,
  seq: 100 + i, subSeq: 0, status: 'unlabeled',
  createdAt: `2026-06-22T1${i % 10}:00:00Z`,
}));

async function apri(openTab, items = FAKE) {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((it) => { SN_FEEDBACK.list = async () => it; }, items);
  await page.click('#refresh');
  await expect(page.locator('[data-tab="inbox"]')).toHaveText(/Ricevuti \(12\)/);
  return page;
}

test('ricerca a vuoto: contatore «0 feedback» e messaggio, nei due temi', async ({ openTab }) => {
  const page = await apri(openTab);
  const count = page.locator('#count');
  await expect(count).toHaveText('12 feedback');
  await page.fill('#search', 'parolachenonce');
  await expect(page.locator('.fb-card')).toHaveCount(0);
  await expect(count).toBeVisible();
  await expect(count).toHaveText('0 feedback');
  await expect(page.locator('#empty')).toContainText('Nessun risultato');
  await page.screenshot({ path: 'tests/.shots/v511-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: 'tests/.shots/v511-scuro.png' });
});

test('stress: HTML, emoji, soli spazi, digitazione rapida', async ({ openTab }) => {
  const page = await apri(openTab);
  const count = page.locator('#count');
  await page.fill('#search', '<img src=x onerror=alert(1)>');
  await expect(count).toHaveText('0 feedback');
  await expect(page.locator('#empty img')).toHaveCount(0);
  await page.fill('#search', '🙂🙂');
  await expect(count).toHaveText('0 feedback');
  await page.fill('#search', '    ');
  await expect(count).toHaveText('12 feedback');
  await page.fill('#search', '');
  await page.locator('#search').pressSequentially('copia 3zz', { delay: 5 });
  await expect(count).toHaveText('0 feedback');
  for (let i = 0; i < 3; i++) await page.locator('#search').press('Backspace');
  // Il contatore torna a dire quante schede ci sono davvero a schermo.
  await expect(count).not.toHaveText('0 feedback');
  const cards = await page.locator('.fb-card').count();
  expect(cards).toBeGreaterThan(0);
  await expect(count).toHaveText(`${cards} feedback`);
});

test('cambio sezione durante una ricerca a vuoto: il contatore segue la sezione', async ({ openTab }) => {
  const page = await apri(openTab);
  const count = page.locator('#count');
  await page.fill('#search', 'parolachenonce');
  await expect(count).toHaveText('0 feedback');
  const tabs = page.locator('[data-tab]');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    await expect(count).toHaveText('0 feedback');
  }
});
