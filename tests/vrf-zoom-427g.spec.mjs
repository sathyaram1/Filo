// VERIFICA #427 — c'e' un riscontro visibile del livello di zoom con Ctrl+? (temporaneo)
import { test } from './fixtures/electron.mjs';

test('badge percentuale con Ctrl+ vs con la modalita rotella', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForTimeout(900);
  await page.mouse.click(400, 300).catch(() => {});
  await page.waitForTimeout(200);

  const snap = (tag) => page.evaluate((t) => {
    const txt = document.body.innerText || '';
    const pct = txt.match(/\d{2,3}\s*%/g);
    const badges = Array.from(document.querySelectorAll('[class*="zoom"], [id*="zoom"]'))
      .map((e) => ({ cls: e.className, id: e.id, txt: (e.textContent || '').trim().slice(0, 20), vis: !!(e.offsetParent || e.getClientRects().length) }));
    return { tag: t, pctInBody: pct, badges };
  }, tag);

  await page.keyboard.press('Control+Equal');
  await page.waitForTimeout(120);
  console.log('[427] subito dopo Ctrl+ :', JSON.stringify(await snap('ctrl+')));
  await page.waitForTimeout(1200);
  console.log('[427] 1.3s dopo Ctrl+  :', JSON.stringify(await snap('ctrl+ dopo')));

  // modalita rotella (clic centrale)
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(300);
  await page.mouse.click(400, 300, { button: 'middle' }).catch(() => {});
  await page.waitForTimeout(400);
  console.log('[427] dopo clic centrale :', JSON.stringify(await snap('rotella')));
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(400);
  console.log('[427] rotella + scroll   :', JSON.stringify(await snap('rotella scroll')));
});
