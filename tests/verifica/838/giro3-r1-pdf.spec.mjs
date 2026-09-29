// Verifica #838, giro 3, rilievo 1: con la tastiera dentro il visore PDF di una
// scheda, Alt+S e Alt+H devono fare quello che facevano quando erano scorciatoie
// di sistema (salvare e chiudere la scheda, aprire l'Aiuto sopra il documento).
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

let srv;
let url;
test.beforeEach(async () => {
  const pdf = pdfMinimo('Documento di prova per Filo');
  srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${srv.address().port}/manuale.pdf`;
});
test.afterEach(async () => { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); });

// Apre il PDF, ci clicca dentro come farebbe l'utente per leggerlo.
async function apriPdfEClicca(app, shell) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((w) => w.getType() === 'remote' && !w.isLoading())), { timeout: 15_000 }).toBe(true);
  await shell.waitForTimeout(1000);
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.show(); w.focus();
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'mouseDown', x: 300, y: 300, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 300, y: 300, button: 'left', clickCount: 1 });
    return w._filoTabs.activeId;
  });
}

// Il tasto arriva al visore PDF, dove sta la tastiera di chi legge il documento.
function premiNelVisore(app, keyCode) {
  return app.evaluate(({ webContents }, k) => {
    const visore = webContents.getAllWebContents().find((w) => w.getType() === 'remote');
    visore.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: ['alt'] });
    visore.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: ['alt'] });
  }, keyCode);
}

test('Alt+S con la tastiera nel visore PDF salva il documento per dopo e chiude la scheda', async ({ app, shell }) => {
  const id = await apriPdfEClicca(app, shell);
  await premiNelVisore(app, 'S');
  await expect.poll(() => app.evaluate(async (_e, u) => (await globalThis.SN_STORAGE.getRaw('savedPages', []))
    .some((p) => p.url === u), url), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, tid) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.some((t) => t.id === tid);
  }, id), { timeout: 10_000 }).toBe(false);
});

test('Alt+H con la tastiera nel visore PDF apre l\'Aiuto sopra il documento', async ({ app, shell }) => {
  await apriPdfEClicca(app, shell);
  await premiNelVisore(app, 'H');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return t.view.webContents.executeJavaScript('!!document.querySelector(".sn-sidebar")').catch(() => false);
  }), { timeout: 10_000 }).toBe(true);
});
