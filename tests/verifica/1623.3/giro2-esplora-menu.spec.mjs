// Esplorazione verifica #1623.3 giro 2: «Invia feedback» dal tasto destro, poi Ctrl+V dove sta la tastiera.

import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, conta } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif;height:600px">`
  + `<p id="t">Pagina che ascolta.</p><script>window.__visti=[];`
  + `window.addEventListener('paste',(e)=>{let f=0;try{f=e.clipboardData.files.length}catch(_){}window.__visti.push(f)},true);</script></body></html>`;

for (const ms of [0, 250, 400]) {
  test(`menu Invia feedback, Ctrl+V dopo ${ms} ms`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const p = await testServer.openReady(openTab, PAGINA);
    await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const px = Buffer.alloc(48 * 32 * 4);
      for (let i = 0; i < 48 * 32; i++) px.set([0, 0, 255, 255], i * 4);
      const png = nativeImage.createFromBitmap(px, { width: 48, height: 32 }).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
    });
    await p.locator('#t').click({ button: 'right' });
    const voce = menuDi(p).voce('Invia feedback');
    await expect(voce).toBeVisible({ timeout: 10_000 });
    await voce.click();
    const premi = app.evaluate(async ({ BrowserWindow, webContents }, { attesa, u }) => {
      const t0 = Date.now();
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      const tw = win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents;
      const lascia = !!win._filoTabs.riquadri?.strati?.get(tw);
      tw.focus();
      if (attesa) await new Promise((r) => setTimeout(r, attesa));
      const wc = win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents;
      const s = win._filoTabs.riquadri?.strati?.get(wc);
      const stato = s ? { pronta: !!s.pronta, visibile: !!s.visibile, chiavi: Object.keys(s).join(',') } : null;
      const foco = { scheda: wc.isFocused(), strato: s?.vista?.webContents?.isFocused?.() ?? s?.view?.webContents?.isFocused?.() };
      const dove = wc ? wc.getURL() : 'nessuno';
      if (wc) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] });
        wc.sendInputEvent({ type: 'char', keyCode: 'v', modifiers: ['control'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] });
      }
      const dt = Date.now() - t0;
      const traccia = [];
      while (!(s && s.visibile) && Date.now() - t0 < 3000) {
        const f = webContents.getFocusedWebContents();
        const riga = `${f ? f.getURL().slice(0, 14) : '-'}|${s && s.trattenuti ? 'T' + s.trattenuti.length : 'n'}|${s && s.pronta ? 'P' : 'p'}`;
        if (traccia[traccia.length - 1]?.r !== riga) traccia.push({ t: Date.now() - t0, r: riga });
        await new Promise((r) => setTimeout(r, 3));
      }
      return { dove, lascia, stato, foco, dt, aSchermo: Date.now() - t0, traccia };
    }, { attesa: ms, u: p.url() });
    const r = await premi;
    await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
    await p.waitForTimeout(1500);
    const visti = await p.evaluate(() => window.__visti);
    const thumbs = await conta(app, p, '.sn-fb-thumb');
    console.log(`MENU ${ms}`, JSON.stringify(r), 'sito:', JSON.stringify(visti), 'allegati:', thumbs);
    expect(visti).toEqual([]);
    expect(thumbs).toBe(1);
  });
}
