// Sonda 2 del giro 3 di #838: pagina interna con selezione, PDF.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

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

function dove(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const f = webContents.getFocusedWebContents();
    if (!f) return 'NESSUNO';
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents === f) return w._filoTabs ? 'barra' : 'finestra:' + f.getURL().slice(0, 30);
      if (w._filoTabs) {
        const t = w._filoTabs.tabs.find((x) => x.view.webContents === f);
        if (t) return (t.id === w._filoTabs.activeId ? 'scheda-attiva' : 'scheda-NON-attiva') + ':' + t.url.slice(-14);
      }
    }
    return 'altro:' + f.getType() + ':' + f.getURL().slice(0, 60);
  });
}

function premiDoveHaLaTastiera(app, keyCode, modifiers) {
  return app.evaluate(({ webContents }, o) => {
    const f = webContents.getFocusedWebContents();
    if (!f) return false;
    f.sendInputEvent({ type: 'keyDown', keyCode: o.keyCode, modifiers: o.modifiers });
    f.sendInputEvent({ type: 'keyUp', keyCode: o.keyCode, modifiers: o.modifiers });
    return true;
  }, { keyCode, modifiers });
}

function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return { ids: w._filoTabs.tabs.map((x) => x.id), activeId: w._filoTabs.activeId, urls: w._filoTabs.tabs.map((x) => x.url) };
  });
}

for (const [lettera, titolo, url] of [['E', 'Approfondimento', 'filo://options/options.html'], ['T', 'Traduzione', 'filo://history/history.html']]) {
  test(`sonda: Alt+${lettera} su pagina interna con selezione`, async ({ app, openTab }) => {
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8000 });
    await page.waitForTimeout(800);
    const sel = await page.evaluate(() => {
      const el = [...document.querySelectorAll('h1,h2,h3,p,label,span,div,button')].find((e) => e.children.length === 0 && (e.textContent || '').trim().length > 5 && e.offsetParent);
      if (!el) return '';
      const r = document.createRange(); r.selectNodeContents(el);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return s.toString();
    });
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      w.show(); w.focus();
      w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.focus();
    });
    console.log('selezione:', JSON.stringify(sel), 'fuoco:', await dove(app));
    await premiDoveHaLaTastiera(app, lettera, ['alt']);
    const ok = await page.locator('.sn-popup .sn-popup-title').first().textContent({ timeout: 6000 }).catch(() => 'NIENTE');
    console.log(`INTERNA Alt+${lettera}:`, ok, '(atteso', titolo + ')');
  });
}

async function apriPdf(app, shell) {
  const pdf = pdfMinimo('Documento di prova per Filo');
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/doc.pdf`;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getType() === 'remote')), { timeout: 10000 }).toBe(true);
  await shell.waitForTimeout(1500);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.show(); w.focus();
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'mouseDown', x: 300, y: 300, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 300, y: 300, button: 'left', clickCount: 1 });
  });
  await shell.waitForTimeout(800);
  return srv;
}

for (const [nome, tasto, mod] of [['Alt+S', 'S', ['alt']], ['Ctrl+W', 'W', ['control']], ['Alt+H', 'H', ['alt']]]) {
  test(`sonda: PDF ${nome} dal visore`, async ({ app, shell }) => {
    const srv = await apriPdf(app, shell);
    try {
      console.log('fuoco:', await dove(app));
      const prima = await schede(app);
      await premiDoveHaLaTastiera(app, tasto, mod);
      await shell.waitForTimeout(3000);
      const dopo = await schede(app);
      const aiuto = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
        return t.view.webContents.executeJavaScript('!!document.querySelector(".sn-sidebar")').catch(() => 'err');
      });
      console.log(`PDF ${nome} dal visore: scheda PDF chiusa=`, !dopo.ids.includes(prima.activeId), 'aiuto=', aiuto);
    } finally { srv.close(); }
  });
}

test('sonda: PDF, la stessa azione chiesta direttamente (come faceva la scorciatoia di sistema)', async ({ app, shell }) => {
  const srv = await apriPdf(app, shell);
  try {
    const prima = await schede(app);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      globalThis.__filoShortcuts.dispatch('open-help-sidebar', w);
    });
    await shell.waitForTimeout(2500);
    const aiuto = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      return t.view.webContents.executeJavaScript('!!document.querySelector(".sn-sidebar")').catch(() => 'err');
    });
    console.log('PDF dispatch Aiuto diretto: aiuto=', aiuto);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      globalThis.__filoShortcuts.dispatch('save-for-later', w);
    });
    await shell.waitForTimeout(3000);
    const dopo = await schede(app);
    const salvata = await app.evaluate(async () => (await globalThis.SN_STORAGE.getRaw('savedPages', [])).map((p) => p.url));
    console.log('PDF dispatch Salva diretto: chiusa=', !dopo.ids.includes(prima.activeId), 'salvate=', JSON.stringify(salvata));
  } finally { srv.close(); }
});
