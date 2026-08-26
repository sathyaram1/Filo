import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';

test('debug geometria', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate(() => { document.querySelectorAll('.sn-popup').forEach((n) => n.remove()); });
  const y = await page.evaluate(() => {
    const yy = Math.max(8, Math.round(window.innerHeight - 300));
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN,
      payload: { selection: 'parola', sentence: 'frase' },
      anchor: { x: 260, y: yy }, title: 'Spiega',
    });
    return yy;
  });
  await expect(page.locator('.sn-popup')).toBeVisible();
  const g1 = await page.evaluate(() => {
    const r = document.querySelector('.sn-popup').getBoundingClientRect();
    return { vh: window.innerHeight, top: r.top, h: r.height, bottom: r.bottom };
  });
  await page.evaluate(() => {
    const t = document.querySelector('.sn-popup .sn-msg-assistant .sn-msg-text');
    t.innerHTML = Array.from({ length: 14 }, (_, i) => `<p>Riga ${i + 1} della spiegazione: abbastanza testo da occupare una riga intera e far crescere il riquadro.</p>`).join('');
  });
  await page.waitForTimeout(1500);
  const g2 = await page.evaluate(() => {
    const r = document.querySelector('.sn-popup');
    const b = r.getBoundingClientRect();
    return { vh: window.innerHeight, top: b.top, h: b.height, bottom: b.bottom, styleTop: r.style.top, maxH: r.style.maxHeight };
  });
  console.log('ANCORA y=', y, 'PRIMA', JSON.stringify(g1), 'DOPO', JSON.stringify(g2));
});
