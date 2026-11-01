// Verifica #1681 giro 1: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, paginaDelloStrato, statoDi, conta } from '../../helpers/riquadri.mjs';

async function newtabPage(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('vero: deposito che rifiuta l unico allegato senza testo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const cif = await app.evaluate(() => globalThis.SN_FEEDBACK.encryptionUnavailable());
  console.log('cifratura:', JSON.stringify(cif));
  await app.evaluate(() => {
    globalThis.__chiamate = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (u, o) => {
      const s = String(u);
      globalThis.__chiamate.push(s.slice(0, 120));
      if (/firebasestorage|storage\.googleapis/.test(s)) return new Response('no', { status: 403 });
      throw new Error('fetch failed');
    };
    globalThis.__origFetch = orig;
  });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }]);
  await page.locator('.sn-fb-send').click();
  await page.waitForTimeout(6000);
  console.log('status:', await page.locator('.sn-fb-status').textContent());
  console.log('modal:', await page.locator('.sn-fb-modal').count());
  console.log('toast:', await page.locator('.sn-toast').allTextContents());
  console.log('chiamate:', JSON.stringify(await app.evaluate(() => globalThis.__chiamate)));
  console.log('coda:', await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.size()));
  const avvisi = app.windows().find((w) => w.url().startsWith('filo://shell/avvisi.html'));
  console.log('notif shell:', await shell.locator('.shell-notif').allTextContents());
  if (avvisi) console.log('notif avvisi:', await avvisi.locator('.shell-notif').allTextContents());
  console.log('mie:', JSON.stringify(await app.evaluate(async () => { try { return await globalThis.SN_SEGNALAZIONI_MIE?.elenco?.(); } catch (e) { return String(e); } })));
});
