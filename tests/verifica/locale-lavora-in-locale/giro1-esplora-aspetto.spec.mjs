// Esplorazione usa e getta: fotografie del tasto «Lavoro locale» nei due temi.
import { test } from '../../fixtures/electron.mjs';

test('aspetto del tasto nei Ricevuti, chiaro e scuro', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => (msg && msg.type === 'auth_status') ? { ok: true, signedIn: true, isAdmin: true, profile: null } : orig(msg);
  });
  const fb = { _id: 'r-1', name: 'Il terminale non parte su Linux', text: 'Serve provare su una macchina vera.', seq: 950, subSeq: 0,
    status: 'design', statusReason: 'locale', statusPublic: 'open', clientId: 'routine:worker', senderProof: 'server',
    createdAt: '2026-10-01T07:00:00Z', images: [], notes: 'Richiede lavoro locale. Serve il terminale vero.' };
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setTab('inbox'); }, [fb]);
  await page.locator('.mg-item').click();
  for (const tema of ['light', 'dark']) {
    await page.evaluate(async (t) => { await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }); }, tema);
    await page.waitForTimeout(800);
    await page.locator('#mgActionsRow button', { hasText: 'Lavoro locale' }).hover();
    await page.screenshot({ path: `tests/.shots/913-ricevuti-${tema}.png` });
    await page.locator('.mg-item').click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/913-menu-${tema}.png` });
    await page.keyboard.press('Escape');
  }
});
