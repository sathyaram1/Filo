// Esplorazione della verifica #1551.1 giro 1: misure della home col testo ingrandito, da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';

async function home(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}

async function scala(app, page, s) {
  await page.evaluate(async (v) => {
    const r = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...((r && r.settings) || {}), textScale: v } });
  }, s);
  await page.waitForTimeout(400);
  const zoom = await page.evaluate(() => document.documentElement.style.zoom);
  return zoom;
}

function misura(page) {
  return page.evaluate(() => {
    const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
    const fuori = [];
    for (const col of ['left', 'right']) {
      const c = document.getElementById(col);
      const cb = c.getBoundingClientRect();
      for (const e of c.querySelectorAll('*')) {
        const b = e.getBoundingClientRect();
        if (!b.width || getComputedStyle(e).visibility === 'hidden') continue;
        if (b.right > cb.right + 2 || b.left < cb.left - 2) fuori.push(`${col}:${e.tagName}.${e.className}:${Math.round(b.left)}-${Math.round(b.right)}`);
      }
    }
    return { zoom: document.documentElement.style.zoom, inner: innerWidth, body: Math.round(document.body.getBoundingClientRect().width), campo: document.getElementById('input').clientWidth, dash: r('dash'), sx: r('left'), dx: r('right'), form: r('inputForm'), invio: r('sendBtn'), scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth, bodyScroll: document.body.scrollHeight - document.body.clientHeight, fuori: fuori.slice(0, 8) };
  });
}

for (const [W, s, z] of [[1000, 1.5, 1.5], [1280, 1.5, 1.5], [1000, 1.25, 1.5], [720, 1.25, 1.25], [720, 1, 2]]) {
  test(`esplora ${W} testo ${s} zoom ${z}`, async ({ app, shell }) => {
    await app.evaluate(({ BrowserWindow }, [w]) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(w, 760), [W]);
    let page = await home(app);
    await scala(app, page, s);
    await page.reload();
    page = await home(app);
    const zz = await page.evaluate(() => document.documentElement.style.zoom);
    if (z !== 1) {
      await app.evaluate(({ webContents }, f) => {
        webContents.getAllWebContents().find((w) => { try { return w.getURL().startsWith('filo://newtab'); } catch (_) { return false; } }).setZoomFactor(f);
      }, z);
      await page.waitForTimeout(500);
    }
    await page.locator('#input').click();
    await page.keyboard.type('ciao Filo, che tempo fa domani a Milano?');
    await page.waitForTimeout(300);
    const m = await misura(page);
    m.zoomSenzaReload = zz;
    m.valore = await page.locator('#input').inputValue();
    m.righe = await page.locator('#input').evaluate((t) => { const c = getComputedStyle(t); return Math.round((t.scrollHeight - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom)) / parseFloat(c.lineHeight)); });
    console.log('MISURA', JSON.stringify({ W, s, z, ...m }));
    await page.screenshot({ path: `tests/.shots/v1551-${W}-${s}-${z}.png` });
  });
}

test('esplora volo con testo 150% a 1000', async ({ app, shell, avvisi }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1000, 760));
  let page = await home(app);
  await scala(app, page, 1.5);
  await page.reload();
  page = await home(app);
  await page.evaluate(() => {
    window.__voli = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('dash-carta-in-volo')) {
      const t = () => { if (!n.isConnected) return; const b = n.getBoundingClientRect(); window.__voli.push([Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]); requestAnimationFrame(t); };
      t();
    } }).observe(document.body, { childList: true });
  });
  await shell.evaluate(() => window.filoNotify('Il portachiavi di sistema non risponde: l’accesso vale fino alla chiusura di Filo', { durationSec: 0, actions: [{ label: 'Capito', onClick() {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect(page.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/v1551-volo-meta.png' });
  await page.waitForTimeout(1500);
  const v = await page.evaluate(() => ({ voli: window.__voli.filter((_, i, a) => i === 0 || i === a.length - 1 || i % 5 === 0), carta: (() => { const b = document.querySelector('#accade > .dash-carta[data-tipo="cornice"]').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; })(), sx: (() => { const b = document.getElementById('left').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; })(), inner: [innerWidth, innerHeight] }));
  console.log('VOLO', JSON.stringify(v));
  await page.screenshot({ path: 'tests/.shots/v1551-volo-fine.png' });
});
