import { test, expect } from '../../fixtures/electron.mjs';

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

const crashate = (app) => app.evaluate(({ webContents }) => webContents.getAllWebContents()
  .filter((w) => w.isCrashed()).map((w) => w.getURL()));

async function visoriVivi(page) {
  const vis = page.frames().filter((f) => f.url().startsWith('chrome-extension://'));
  let vivi = 0;
  for (const f of vis) { try { if (await f.evaluate(() => !!document.querySelector('pdf-viewer'))) vivi++; } catch (_) {} }
  return vivi;
}

test('un PDF in un iframe e in un embed di un sito resta vivo', async ({ app, openTab, testServer }) => {
  const stesso = testServer.asset(pdfMinimo('Stesso sito'), 'application/pdf');
  const altro = testServer.asset(pdfMinimo('Altro sito'), 'application/pdf').replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><body>
    <iframe src="${stesso}" style="width:600px;height:400px"></iframe>
    <embed src="${altro}" type="application/pdf" style="width:600px;height:400px">
  </body>`);
  await expect.poll(() => visoriVivi(page), { timeout: 20_000 }).toBe(2);
  await new Promise((r) => setTimeout(r, 3000));
  expect(await crashate(app)).toEqual([]);
  expect(await visoriVivi(page)).toBe(2);
});

test('un PDF aperto in una scheda e ricaricato resta vivo', async ({ app, openTab, testServer }) => {
  const url = testServer.asset(pdfMinimo('Ricarica'), 'application/pdf');
  await testServer.openReady(openTab, '<p>prima</p>');
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.loadURL(u);
  }, url);
  let pdf = null;
  await expect.poll(() => { pdf = app.windows().find((w) => w.url() === url); return !!pdf; }, { timeout: 15_000 }).toBe(true);
  await expect.poll(() => visoriVivi(pdf), { timeout: 20_000 }).toBe(1);
  await app.evaluate(({ webContents }, u) => webContents.getAllWebContents().find((w) => w.getURL() === u).reload(), url);
  await new Promise((r) => setTimeout(r, 1500));
  await expect.poll(() => visoriVivi(pdf), { timeout: 20_000 }).toBe(1);
  await new Promise((r) => setTimeout(r, 3000));
  expect(await crashate(app)).toEqual([]);
});
