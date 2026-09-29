// Verifica #588.5 giro 1: gli avvisi della barra si vedono sopra la pagina (esplorazione).
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PDF = Buffer.from('%PDF-1.4\n% prova\n' + 'x'.repeat(4096));
const SHOTS = join(process.cwd(), 'tests', '.shots');

async function apriServer() {
  const srv = createServer((req, res) => {
    const u = String(req.url || '').split('?')[0];
    if (u === '/pagina') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="margin:0;background:#00c000;height:100vh">
        <a id="pdf" href="/doc.pdf" style="display:block;padding:40px;font-size:20px">documento</a>
        <a id="rotto" href="/rotto.zip" style="display:block;padding:40px;font-size:20px">rotto</a>
        <input id="campo" style="margin:40px"></body></html>`);
      return;
    }
    if (u === '/doc.pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length });
      res.end(PDF);
      return;
    }
    if (u === '/rotto.zip') {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': 500000,
        'Content-Disposition': 'attachment; filename="rotto.zip"',
      });
      res.write(Buffer.alloc(1000, 1));
      setTimeout(() => { try { res.socket.destroy(); } catch (_) {} }, 300);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

function posa(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const v = tm.avvisi.vista;
    const figli = win.contentView.children;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    return {
      inCima: !!v && figli[figli.length - 1] === v,
      visibile: !!v && v.getVisible?.(),
      vista: v ? v.getBounds() : null,
      scheda: tab ? tab.view.getBounds() : null,
      contenuto: win.getContentBounds(),
    };
  });
}

// Quota di pixel non verdi nel rettangolo della vista, sulla cattura vera dello schermo.
async function nonVerdi(app, nome) {
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, `588.5-${nome}.png`);
  execFileSync('scrot', ['-o', file]);
  const p = await posa(app);
  return app.evaluate(({ nativeImage }, { file, p }) => {
    const img = nativeImage.createFromPath(file);
    const { width } = img.getSize();
    const bmp = img.toBitmap();
    const x0 = p.contenuto.x + p.vista.x;
    const y0 = p.contenuto.y + p.vista.y;
    let tot = 0; let diversi = 0;
    for (let y = y0; y < y0 + p.vista.height; y += 2) {
      for (let x = x0; x < x0 + p.vista.width; x += 2) {
        const i = (y * width + x) * 4;
        const b = bmp[i]; const g = bmp[i + 1]; const r = bmp[i + 2];
        tot++;
        if (!(g > 150 && r < 60 && b < 60)) diversi++;
      }
    }
    return { tot, diversi, quota: tot ? diversi / tot : 0 };
  }, { file, p });
}

test('un pdf cliccato: «Scaricato» si vede a schermo sopra la pagina e «Apri file» apre il file', async ({ app, shell, openTab, avvisi }) => {
  const srv = await apriServer();
  try {
    const page = await openTab(`${srv.base}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await app.evaluate(({ shell: sh }) => {
      globalThis.__aperti = [];
      sh.openPath = async (p) => { globalThis.__aperti.push(p); return ''; };
    });
    await page.locator('#pdf').click();
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText(/Scaricato: doc.*\.pdf/, { timeout: 15_000 });
    await expect.poll(async () => (await posa(app)).inCima).toBe(true);
    await page.waitForTimeout(400);
    const px = await nonVerdi(app, 'pdf');
    console.log('pixel', JSON.stringify(px), JSON.stringify(await posa(app)));
    expect(px.quota).toBeGreaterThan(0.3);
    await page.waitForTimeout(1100);
    await vista.locator('.shell-notif-action', { hasText: 'Apri file' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti.length)).toBe(1);
  } finally { await srv.close(); }
});

test('uno scaricamento che cade: «Scaricamento non riuscito» si vede sopra la pagina', async ({ app, openTab, avvisi }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const page = await openTab(`${srv.base}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.locator('#rotto').click();
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText(/non riuscito/, { timeout: 60_000 });
    await expect.poll(async () => (await posa(app)).inCima).toBe(true);
    await page.waitForTimeout(400);
    const px = await nonVerdi(app, 'rotto');
    expect(px.quota).toBeGreaterThan(0.3);
  } finally { await srv.close(); }
});

test('stress: testo con markup, emoji e lunghissimo; raffica; finestra bassa; scheda nuova', async ({ app, shell, openTab, avvisi }) => {
  const srv = await apriServer();
  try {
    const page = await openTab(`${srv.base}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await shell.evaluate(() => window.filoNotify('<img src=x onerror="document.title=1"><b>grassetto</b> 🎉 ' + 'parola'.repeat(80), { durationSec: 0 }));
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
    expect(await vista.locator('.shell-notif-msg b').count()).toBe(0);
    await expect(vista.locator('.shell-notif-msg')).toContainText('<b>grassetto</b> 🎉');
    await page.waitForTimeout(300);
    let px = await nonVerdi(app, 'lungo');
    console.log('lungo', JSON.stringify(px), JSON.stringify(await posa(app)));

    for (let i = 0; i < 7; i++) await shell.evaluate((n) => window.filoNotify('avviso ' + n, { durationSec: 0 }), i);
    await expect(vista.locator('.shell-notif')).toHaveCount(5);
    await expect(vista.locator('.shell-notif-msg').last()).toHaveText('avviso 6');

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      win.setContentSize(900, 360);
    });
    await page.waitForTimeout(600);
    const p = await posa(app);
    console.log('bassa', JSON.stringify(p));
    expect(p.vista.y).toBeGreaterThanOrEqual(p.scheda.y);
    expect(p.vista.y + p.vista.height).toBeLessThanOrEqual(p.contenuto.height);
    const ultimaDentro = await vista.evaluate(() => {
      const c = Array.from(document.querySelectorAll('.shell-notif')).pop().getBoundingClientRect();
      return c.bottom <= innerHeight + 1 && c.top >= -1;
    });
    expect(ultimaDentro).toBe(true);
    px = await nonVerdi(app, 'bassa');
    console.log('bassa px', JSON.stringify(px));

    await shell.evaluate(() => window.filoShell.tabs.open('about:blank'));
    await page.waitForTimeout(800);
    const q = await posa(app);
    expect(q.inCima).toBe(true);
    expect(q.visibile).toBe(true);
    await shell.keyboard.press('Control+t');
    await page.waitForTimeout(800);
    expect((await posa(app)).inCima).toBe(true);
    mkdirSync(SHOTS, { recursive: true });
    execFileSync('scrot', ['-o', join(SHOTS, '588.5-schedanuova.png')]);
  } finally { await srv.close(); }
});

test('la tastiera: un avviso che compare non toglie il campo a chi scrive; chiuso con la X torna alla pagina', async ({ app, shell, openTab, avvisi }) => {
  const srv = await apriServer();
  try {
    const page = await openTab(`${srv.base}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.locator('#campo').click();
    await shell.evaluate(() => window.filoNotify('ciao', { durationSec: 0 }));
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
    await page.waitForTimeout(300);
    const foc = await app.evaluate(({ BrowserWindow, webContents }) => {
      const f = webContents.getFocusedWebContents();
      return f ? f.getURL() : null;
    });
    console.log('focus dopo avviso', foc);
    expect(foc).toContain('/pagina');
    await vista.locator('.shell-notif-close').click();
    await page.waitForTimeout(400);
    const foc2 = await app.evaluate(({ webContents }) => {
      const f = webContents.getFocusedWebContents();
      return f ? f.getURL() : null;
    });
    console.log('focus dopo X', foc2);
    expect(foc2).toContain('/pagina');
    await expect.poll(async () => (await posa(app)).vista.width).toBe(0);
  } finally { await srv.close(); }
});
