// Sonda 2 del giro 3 di #838: pagina interna con selezione, PDF, seconda finestra.
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

function schede(app, i = 0) {
  return app.evaluate(({ BrowserWindow }, i) => {
    const ws = BrowserWindow.getAllWindows().filter((x) => x._filoTabs && !x._filoIncognito).sort((a, b) => a.id - b.id);
    const w = ws[i];
    return { ids: w._filoTabs.tabs.map((x) => x.id), activeId: w._filoTabs.activeId, urls: w._filoTabs.tabs.map((x) => x.url) };
  }, i);
}

test('sonda: Alt+E e Alt+T su pagina interna con selezione', async ({ app, openTab }) => {
  for (const [lettera, titolo] of [['E', 'Approfondimento'], ['T', 'Traduzione']]) {
    const page = await openTab('filo://options/options.html');
    await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8000 });
    await page.waitForTimeout(800);
    const sel = await page.evaluate(() => {
      const el = [...document.querySelectorAll('h1,h2,h3,p,label,span,div')].find((e) => e.children.length === 0 && (e.textContent || '').trim().length > 12 && e.offsetParent);
      if (!el) return '';
      el.click?.();
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
  }
});

test('sonda: PDF', async ({ app, openTab, shell }) => {
  const pdf = pdfMinimo('Documento di prova per Filo');
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/doc.pdf`;
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await shell.waitForTimeout(4000);
    const s = await schede(app);
    console.log('schede', JSON.stringify(s.urls));
    const tuttiWc = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getType() + ' ' + w.getURL().slice(0, 70)));
    console.log('webContents:', JSON.stringify(tuttiWc, null, 1));
    // clic dentro il PDF con un vero evento di mouse sulla scheda
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      w.show(); w.focus();
      const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
      wc.focus();
      wc.sendInputEvent({ type: 'mouseDown', x: 300, y: 300, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: 300, y: 300, button: 'left', clickCount: 1 });
    });
    await shell.waitForTimeout(1000);
    console.log('fuoco dopo clic nel PDF:', await dove(app));
    const prima = await schede(app);
    await premiDoveHaLaTastiera(app, 'S', ['alt']);
    await shell.waitForTimeout(4000);
    const dopo = await schede(app);
    console.log('PDF Alt+S: schede prima', prima.ids.length, 'dopo', dopo.ids.length, 'attiva chiusa:', !dopo.ids.includes(prima.activeId));
  } finally { srv.close(); }
});

test('sonda: seconda finestra', async ({ app, openTab, testServer, shell }) => {
  await testServer.openReady(openTab, '<p>uno</p>');
  await app.evaluate(() => require('./src/main/window').createMainWindow?.());
  await shell.waitForTimeout(3000);
  const n = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => x._filoTabs).length);
  console.log('finestre', n);
});
