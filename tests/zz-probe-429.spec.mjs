import { test, expect } from './fixtures/electron.mjs';
import { captureCompositeElectron } from './agent/driver.mjs';

test('probe', async ({ app, shell, openTab, testServer }) => {
  await shell.setViewportSize?.({ width: 1400, height: 900 }).catch(() => {});
  const u = testServer.html('<title>Memoria del sito di prova</title><body style="background:#fff">ciao</body>');
  await openTab(u);
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await new Promise((r) => setTimeout(r, 2500));
  const info = await shell.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab')].map((el) => ({
      active: el.classList.contains('active'),
      title: el.querySelector('.title')?.textContent,
      w: el.getBoundingClientRect().width,
      titleScroll: el.querySelector('.title')?.scrollWidth,
      titleClient: el.querySelector('.title')?.clientWidth,
      bg: getComputedStyle(el).backgroundColor,
      nat: el.style.getPropertyValue('--tab-naturale'),
    }));
    return { tabs, tabsW: document.querySelector('.tabs').getBoundingClientRect().width, rowW: document.querySelector('.tab-row').getBoundingClientRect().width, win: innerWidth };
  });
  const top = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    html: getComputedStyle(document.documentElement).backgroundColor,
    at: (() => { const el = document.elementFromPoint(innerWidth/2, 6); return el && (el.className + ' ' + getComputedStyle(el).backgroundColor); })(),
  }));
  const state = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w._filoTabs.tabs.map((t) => ({ url: t.url, color: t.color }));
  });
  const dbg = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')][1];
    const kids = (m) => { if (m) el.classList.add('misura'); const r = { w: el.getBoundingClientRect().width, kids: [...el.children].map((k) => [k.className, k.getBoundingClientRect().width, getComputedStyle(k).display]) , gap: getComputedStyle(el).gap, range: (() => { const r = document.createRange(); r.selectNodeContents(el.querySelector('.title')); return r.getBoundingClientRect().width; })(), sw: el.querySelector('.title').scrollWidth, font: getComputedStyle(el.querySelector('.title')).font, title: el.querySelector('.title').textContent}; el.classList.remove('misura'); return r; };
    return { misura: kids(true), normale: kids(false) };
  });
  console.log(JSON.stringify(dbg));
  console.log(JSON.stringify({ info, top, state }, null, 1));
  await captureCompositeElectron(app, 'tests/.shots/probe-429.png');
});
