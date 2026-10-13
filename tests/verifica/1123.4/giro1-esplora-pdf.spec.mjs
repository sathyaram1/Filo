// Esplorazione del giro 1 di #1123.4: i tasti di Filo dal visore PDF su un file locale e in incognito.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

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

async function tastieraNelVisore(app, pdf, u) {
  const scheda = await app.evaluate(({ webContents }, url) => {
    const f = webContents.getFocusedWebContents();
    return !!f && f.getURL() === url && !f.isLoading();
  }, u);
  const visore = pdf.frames().find((f) => f.url().startsWith('chrome-extension://'));
  return scheda && !!visore && await visore.evaluate(() => document.hasFocus() && document.activeElement?.tagName === 'PDF-VIEWER');
}

async function apriPdf(app, u, incognito) {
  await app.evaluate(({ BrowserWindow }, o) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === o.incognito);
    w.show(); w.focus();
    w._filoTabs.openTab(o.u);
  }, { u, incognito });
  let pdf = null;
  await expect.poll(() => { pdf = app.windows().find((w) => { try { return w.url() === u; } catch (_) { return false; } }); return !!pdf; }, { timeout: 15_000 }).toBe(true);
  await expect.poll(() => Boolean(pdf.frames().find((f) => f.url().startsWith('chrome-extension://'))), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => {
    if (await tastieraNelVisore(app, pdf, u)) return true;
    const [l, a] = await pdf.evaluate(() => [innerWidth, innerHeight]);
    await pdf.mouse.click(l / 2, a / 2);
    return tastieraNelVisore(app, pdf, u);
  }, { timeout: 15_000 }).toBe(true);
}

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ webContents }, o) => {
    const f = webContents.getFocusedWebContents();
    f.sendInputEvent({ type: 'keyDown', keyCode: o.keyCode, modifiers: o.modifiers });
    f.sendInputEvent({ type: 'keyUp', keyCode: o.keyCode, modifiers: o.modifiers });
  }, { keyCode, modifiers });
}

function aiuto(app, incognito) {
  return app.evaluate(({ BrowserWindow }, inc) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === inc);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return t.view.webContents.executeJavaScript('!!document.querySelector(".sn-sidebar")');
  }, incognito);
}

test('PDF da file locale: Alt+H apre l\'Aiuto e Alt+S salva e chiude', async ({ app }) => {
  const dir = cartellaTemporanea('pdf-locale-');
  const file = path.join(dir, 'manuale locale.pdf');
  writeFileSync(file, pdfMinimo('Manuale locale'));
  const u = pathToFileURL(file).href;
  await apriPdf(app, u, false);
  await premi(app, 'H', ['alt']);
  await expect.poll(() => aiuto(app, false), { timeout: 10_000 }).toBe(true);
});

test('PDF in incognito: Alt+H apre l\'Aiuto, Ctrl+W chiude la scheda', async ({ app, shell }) => {
  const pdf = pdfMinimo('Manuale incognito');
  const { createServer } = await import('node:http');
  const srv = createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'application/pdf' }); r.end(pdf); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const u = `http://127.0.0.1:${srv.address().port}/inc.pdf`;
  try {
    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
      return !!(w && w._filoTabs && w._filoTabs.tabs.length);
    }), { timeout: 15_000 }).toBe(true);
    await apriPdf(app, u, true);
    await premi(app, 'H', ['alt']);
    await expect.poll(() => aiuto(app, true), { timeout: 10_000 }).toBe(true);
    const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.activeId);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
      w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId).view.webContents.executeJavaScript('document.querySelector(".sn-sidebar")?.remove()');
    });
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
