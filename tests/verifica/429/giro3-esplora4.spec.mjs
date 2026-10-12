import { test, expect } from '../../fixtures/electron.mjs';

test('porte vecchie: scorrimento striscia e fumetto', async ({ app, shell, openTab, testServer }) => {
  const p = await openTab('filo://manage/manage.html');
  await p.waitForLoadState('load');
  await shell.waitForTimeout(1000);
  console.log('striscia', JSON.stringify(await shell.evaluate(() => { const s = document.getElementById('tabs'); return { sw: s.scrollWidth, cw: s.clientWidth }; })));
  await shell.hover('#tabs .tab.active .title');
  await shell.waitForTimeout(1500);
  const testi = await shell.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0' && /tip|fumetto|tooltip|preview|anteprima/i.test(e.className + ' ' + e.id); }).map((e) => `${e.className}#${e.id}:${e.textContent.trim().slice(0, 60)} w${Math.round(e.getBoundingClientRect().width)}`));
  console.log('fumetto', JSON.stringify(testi));
  const wins = app.windows().map((w) => w.url());
  console.log('finestre', JSON.stringify(wins));
  const lungo = 'Parola '.repeat(150);
  await testServer.openReady(openTab, `<!doctype html><title>${lungo}</title><body>x</body>`);
  await shell.waitForTimeout(1000);
  await shell.mouse.move(0, 300);
  await shell.hover('#tabs .tab:nth-child(1) .title');
  await shell.waitForTimeout(300);
  await shell.hover('#tabs .tab.active .title');
  await shell.waitForTimeout(1500);
  const t2 = await shell.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0' && /tip|fumetto|tooltip|preview|anteprima/i.test(e.className + ' ' + e.id); }).map((e) => `${e.className}#${e.id}: w${Math.round(e.getBoundingClientRect().width)} h${Math.round(e.getBoundingClientRect().height)}`));
  console.log('fumetto-lungo', JSON.stringify(t2), await shell.evaluate(() => innerWidth));
  await shell.screenshot({ path: 'tests/.shots/429/fumetto-lungo.png' });
});
