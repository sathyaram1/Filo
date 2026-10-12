import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/429';
mkdirSync(SHOTS, { recursive: true });

async function pixel(shell, buf, x, y) {
  return shell.evaluate(async ({ b64, x, y }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { b64: buf.toString('base64'), x, y });
}

async function stato(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((t) => {
    const r = t.getBoundingClientRect();
    const ti = t.querySelector('.title');
    return {
      active: t.classList.contains('active'), x: Math.round(r.x), w: Math.round(r.width), bottom: Math.round(r.bottom),
      bg: getComputedStyle(t).backgroundColor, title: ti?.textContent,
      tw: ti?.clientWidth, tsw: ti?.scrollWidth,
    };
  }));
}

async function misura(shell, page, label) {
  await shell.waitForTimeout(1500);
  const tabs = await stato(shell);
  const sh = await shell.screenshot({ path: `${SHOTS}/${label}-shell.png` });
  const pg = await page.screenshot({ path: `${SHOTS}/${label}-page.png` });
  const act = tabs.find((t) => t.active);
  const tabPx = await pixel(shell, sh, act.x + Math.round(act.w / 2), act.bottom - 3);
  const pagePx = await pixel(shell, pg, 20, 2);
  const pagePxMid = await pixel(shell, pg, 400, 30);
  const shellBelow = await pixel(shell, sh, act.x + Math.round(act.w / 2), Math.min(act.bottom + 2, 87));
  const info = await shell.evaluate(() => ({ h: document.querySelector('.shell').getBoundingClientRect().height, compact: document.documentElement.dataset.chromeCompact, iw: innerWidth }));
  console.log(label, JSON.stringify({ tabs, tabPx, shellBelow, pagePx, pagePxMid, info }));
}

test('manage chiaro e scuro', async ({ app, shell, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('load');
  await misura(shell, page, 'manage-chiaro');
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await misura(shell, page, 'manage-scuro');
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await misura(shell, page, 'manage-ritorno');
});

test('pagina web con intestazione colorata', async ({ shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><title>Meteo Italia previsioni del tempo</title></head><body style="margin:0;background:#fff"><header style="height:80px;background:#2a6fb0"></header><p>ciao</p></body></html>');
  await misura(shell, page, 'web-blu');
  const page2 = await testServer.openReady(openTab, '<!doctype html><html><head><title>Bianco</title></head><body style="margin:0;background:#ffffff"><p>ciao</p></body></html>');
  await misura(shell, page2, 'web-bianco');
  const page3 = await testServer.openReady(openTab, '<!doctype html><html><head><title>Nero</title></head><body style="margin:0;background:#101010;color:#eee"><p>ciao</p></body></html>');
  await misura(shell, page3, 'web-nero');
});

test('settings e home', async ({ shell, openTab }) => {
  const p = await openTab('filo://options/options.html');
  await p.waitForLoadState('load');
  await misura(shell, p, 'options');
});
