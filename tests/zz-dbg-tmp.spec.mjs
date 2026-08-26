import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';

test('dbg drag', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming, null, { timeout: 8000 });
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN,
      payload: { selection: 'p', sentence: 'una frase con p dentro' },
      anchor: { x: 260, y: Math.round(window.innerHeight * 0.1) },
      title: 'Spiega',
    });
  });
  await expect(page.locator('.sn-popup')).toBeVisible();
  const h = await page.evaluate(() => {
    const r = document.querySelector('.sn-popup').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
  });
  const target = await page.evaluate(() => Math.round(window.innerHeight * 0.55));
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x, target + 12, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  console.log('DOPO DRAG', await page.evaluate(() => {
    const r = document.querySelector('.sn-popup');
    return { top: r.style.top, maxH: r.style.maxHeight, oh: r.offsetHeight, hasRO: typeof ResizeObserver };
  }));
  await page.evaluate(() => {
    const t = document.querySelector('.sn-popup .sn-msg-assistant .sn-msg-text');
    t.innerHTML = Array.from({length:40},(_,i)=>`<p>Riga ${i+1} lunga abbastanza da occupare una riga intera del riquadro.</p>`).join('');
  });
  await page.waitForTimeout(600);
  console.log('DOPO CRESCITA', await page.evaluate(() => {
    const r = document.querySelector('.sn-popup');
    const b = r.getBoundingClientRect();
    return { top: r.style.top, maxH: r.style.maxHeight, oh: r.offsetHeight, bottom: b.bottom, vh: window.innerHeight };
  }));
});
