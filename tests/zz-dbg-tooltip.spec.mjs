import { test, expect } from './fixtures/electron.mjs';

const LINK = 'https://example.com/articolo-lungo';

test('dbg tooltip', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="height:65vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="link" href="${LINK}" style="display:inline-block;padding:8px">un collegamento in fondo</a>
  </body></html>`);
  await page.locator('#link').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();

  const icona = menu.locator('.sn-menu-row-btn:not(.sn-menu-row-overflow):not(.sn-menu-row-empty)').first();
  const box = await icona.boundingBox();
  await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await expect(page.locator('.sn-tooltip')).toBeVisible({ timeout: 3000 });

  await page.evaluate(() => {
    window.__ev = [];
    const b = document.querySelector('.sn-menu .sn-menu-row-btn');
    b.addEventListener('mouseleave', () => window.__ev.push('leave'));
    b.addEventListener('mouseenter', () => window.__ev.push('enter'));
    document.addEventListener('mousemove', () => window.__ev.push('move'), true);
  });

  const stato = async () => page.evaluate(() => {
    const t = document.querySelector('.sn-tooltip');
    const m = document.querySelector('.sn-menu');
    return {
      tooltipVisibile: t ? t.style.display !== 'none' : null,
      tooltipTop: t ? Math.round(t.getBoundingClientRect().top) : null,
      menuTop: m ? Math.round(m.getBoundingClientRect().top) : null,
      ev: window.__ev.slice(),
    };
  });

  console.log('PRIMA', JSON.stringify(await stato()));

  console.log('ICONA', JSON.stringify(await page.evaluate(() => {
    const b = document.querySelector('.sn-menu .sn-menu-row-btn');
    const r = b.getBoundingClientRect();
    const m = document.querySelector('.sn-menu').getBoundingClientRect();
    return { iconaH: Math.round(r.height), iconaTop: Math.round(r.top), menuBottom: Math.round(m.bottom), vh: window.innerHeight };
  })));

  console.log('SLIDE', JSON.stringify(await page.evaluate((slide) => {
    const menu = document.querySelector('.sn-menu');
    const box = menu.querySelector('.sn-menu-inline');
    const cs = getComputedStyle(box);
    const extra = cs.boxSizing === 'border-box' ? 0
      : parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
        + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const bottom = menu.getBoundingClientRect().bottom;
    const delta = Math.round(window.innerHeight - bottom) + slide;
    const target = Math.round(box.getBoundingClientRect().height) - extra + delta;
    box.style.minHeight = `${target}px`;
    return { extra, delta, target, boxSizing: cs.boxSizing };
  }, 6)));

  for (const ms of [50, 150, 400, 1000]) {
    await page.waitForTimeout(ms === 50 ? 50 : ms - 0);
    console.log(`DOPO+${ms}`, JSON.stringify(await stato()));
  }
});
