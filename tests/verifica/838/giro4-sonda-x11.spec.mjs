// Sonda del giro 4: tasti veri dal server X (xdotool), non iniettati su un webContents.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

test.skip(process.platform !== 'linux', 'serve un server X');

const xdo = (...a) => execFileSync('xdotool', a, { encoding: 'utf8', env: process.env }).trim();
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const TESTO = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="testo">Una frase abbastanza lunga da poterla selezionare, spiegare e tradurre.</p>
  <input id="campo" style="width:300px">
</body></html>`;

async function finestraFilo(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.show(); w.focus();
    const b = w.getNativeWindowHandle();
    return { xid: Number(b.readBigUInt64LE ? b.readBigUInt64LE(0) : b.readUInt32LE(0)), bounds: w.getBounds() };
  });
}

function schede(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs;
    const f = webContents.getFocusedWebContents();
    return { ids: t.tabs.map((x) => x.id), activeId: t.activeId, focused: w.isFocused(),
      fuoco: f ? f.getType() + ':' + f.getURL() : null };
  });
}

function salvate(app) {
  return app.evaluate(async () => (await globalThis.SN_STORAGE.getRaw('savedPages', [])).map((p) => p.url));
}

function avviaXev() {
  const p = spawn('xev', ['-event', 'keyboard', '-geometry', '300x200+900+500'], { env: process.env });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  return { p, out: () => out };
}

test('X11: Filo dietro un altro programma non prende Alt+E/T/S/H, e quello li riceve', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, TESTO);
  await testServer.openReady(openTab, TESTO);
  const filo = await finestraFilo(app);
  const prima = await schede(app);
  const xev = avviaXev();
  let id = '';
  for (let i = 0; i < 50 && !id; i++) { await pausa(100); try { id = xdo('search', '--name', 'Event Tester'); } catch (_) {} }
  expect(id).not.toBe('');
  xdo('windowfocus', '--sync', id.split('\n')[0]);
  await pausa(500);
  const primaFocus = await schede(app);
  for (const k of ['alt+e', 'alt+t', 'alt+s', 'alt+h']) { xdo('key', k); await pausa(300); }
  await pausa(1500);
  const dopo = await schede(app);
  const out = xev.out();
  xev.p.kill();
  console.log('FILO focus prima/dopo', JSON.stringify(primaFocus), JSON.stringify(dopo));
  const presse = out.split('\n\n').filter((b) => b.startsWith('KeyPress') && /state 0x8,/.test(b)).map((b) => (b.match(/keysym 0x[0-9a-f]+, (\w+)/) || [])[1]);
  console.log('xev ha visto con Alt:', presse);
  expect(dopo.ids).toEqual(prima.ids);
  expect(await salvate(app)).toEqual([]);
  expect(presse).toEqual(expect.arrayContaining(['e', 't', 's', 'h']));
  void filo;
});

test('X11: con Filo davanti, tasti veri: Alt+E, Alt+T, Alt+H, poi Alt+S due volte', async ({ app, openTab, testServer }) => {
  for (let i = 1; i <= 3; i++) await testServer.openReady(openTab, TESTO.replace('Una frase', `Pagina ${i}. Una frase`));
  const page = app.windows().filter((w) => { try { return w.url().startsWith(testServer.origin); } catch (_) { return false; } }).pop();
  const filo = await finestraFilo(app);
  xdo('windowfocus', '--sync', String(filo.xid));
  await pausa(300);
  // clic vero dentro la pagina, sul paragrafo
  const box = await page.locator('#testo').boundingBox();
  const shellH = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return t.view.getBounds();
  });
  const cx = filo.bounds.x + shellH.x + box.x + 20;
  const cy = filo.bounds.y + shellH.y + box.y + box.height / 2;
  xdo('mousemove', '--sync', String(Math.round(cx)), String(Math.round(cy)));
  xdo('click', '--repeat', '3', '--delay', '80', '1');
  await pausa(500);
  console.log('dopo clic', JSON.stringify(await schede(app)), await page.evaluate(() => String(getSelection())));
  xdo('key', 'alt+e');
  await expect(page.locator('.sn-popup .sn-popup-title')).toHaveText('Approfondimento', { timeout: 8000 });
  await page.keyboard.press('Escape').catch(() => {});
  xdo('key', 'Escape');
  await pausa(400);
  xdo('mousemove', '--sync', String(Math.round(cx)), String(Math.round(cy)));
  xdo('click', '--repeat', '3', '--delay', '80', '1');
  await pausa(400);
  xdo('key', 'alt+t');
  await expect(page.locator('.sn-popup .sn-popup-title').last()).toHaveText('Traduzione', { timeout: 8000 });
  xdo('key', 'Escape');
  await pausa(300);
  xdo('key', 'alt+h');
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });
  const n = (await schede(app)).ids.length;
  xdo('key', 'alt+s');
  await expect.poll(async () => (await schede(app)).ids.length, { timeout: 10_000 }).toBe(n - 1);
  await pausa(600);
  console.log('dopo primo Alt+S', JSON.stringify(await schede(app)));
  xdo('key', 'alt+s');
  await expect.poll(async () => (await schede(app)).ids.length, { timeout: 10_000 }).toBe(n - 2);
  const s = await salvate(app);
  console.log('salvate', s);
  expect(new Set(s).size).toBe(s.length);
  expect(s.length).toBe(2);
});

function pdfMinimo(testo) {
  const ogg = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const flusso = `BT /F1 24 Tf 72 700 Td (${testo}) Tj ET`;
  ogg[3] = `<< /Length ${flusso.length} >>\nstream\n${flusso}\nendstream`;
  let out = '%PDF-1.4\n';
  const off = [];
  ogg.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${ogg.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${ogg.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('X11: PDF col visore davanti, Alt+S vero salva una volta e chiude una scheda', async ({ app, shell, openTab, testServer }) => {
  const pdf = pdfMinimo('Manuale');
  const srv = createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'application/pdf' }); r.end(pdf); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/m.pdf`;
  await testServer.openReady(openTab, TESTO);
  await testServer.openReady(openTab, TESTO);
  const filo = await finestraFilo(app);
  xdo('windowfocus', '--sync', String(filo.xid));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.evaluate(({ webContents }) => {
    const f = webContents.getFocusedWebContents();
    return !!f && f.getType() === 'remote' && !f.isLoading();
  }), { timeout: 15_000 }).toBe(true);
  await pausa(800);
  const n = (await schede(app)).ids.length;
  xdo('key', 'alt+s');
  await expect.poll(async () => (await salvate(app)).length, { timeout: 10_000 }).toBeGreaterThan(0);
  await pausa(1500);
  const s = await salvate(app);
  console.log('salvate pdf', s, JSON.stringify(await schede(app)));
  expect(s).toEqual([url]);
  expect((await schede(app)).ids.length).toBe(n - 1);
  srv.close();
});
