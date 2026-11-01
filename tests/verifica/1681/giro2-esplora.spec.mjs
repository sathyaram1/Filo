// Esplorazione visiva, da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await page.evaluate((t) => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }), tema);
    await page.waitForTimeout(800);
    await app.evaluate(() => {
      globalThis.__rete = { sblocca: null };
      globalThis.SN_FEEDBACK.submit = async () => { await new Promise((r) => { globalThis.__rete.sblocca = r; }); return { id: 'x', seq: 1, failed: [] }; };
    });
    await page.evaluate(() => window.SN_FEEDBACK_UI.open());
    await page.locator('.sn-fb-file').setInputFiles([
      { name: 'registro-enorme-di-una-giornata-intera-con-un-nome-lunghissimo-davvero-senza-spazi.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024, 65) },
      { name: 'video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x') },
      { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('ciao') },
    ]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/1681-g2-scarti-${tema}.png` });
    await page.locator('.sn-fb-text').fill('prova');
    await page.locator('.sn-fb-send').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/1681-g2-attesa-${tema}.png` });
    await expect.poll(() => app.evaluate(() => typeof globalThis.__rete.sblocca === 'function')).toBe(true);
    await app.evaluate(() => globalThis.__rete.sblocca());
    await page.waitForTimeout(700);
    await page.screenshot({ path: `tests/.shots/1681-g2-inviato-${tema}.png` });
  });
}
