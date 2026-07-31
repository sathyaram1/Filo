// PROBE TEMPORANEO (audit prober) — aprire un PDF in una scheda.
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// PDF minimo valido (1 pagina, testo "Ciao").
const PDF = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
  '4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 20 100 Td (Ciao Filo) Tj ET\nendstream endobj\n' +
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

test('aprire un PDF inline in una scheda', async ({ app, shell, openTab }) => {
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/doc.pdf')) {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF.length) });
      res.end(PDF);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Articolo</h1><p><a id="pdf" href="/doc.pdf">Apri il PDF</a></p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  await app.evaluate(({ session }) => {
    globalThis.__dl = [];
    session.defaultSession.on('will-download', (e, item) => {
      globalThis.__dl.push({ url: item.getURL(), filename: item.getFilename() });
    });
  });

  const plugins = await app.evaluate(({ app: a }) => {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0];
    return { plugins: w?.webContents?.getWebPreferences?.()?.plugins ?? 'n/a' };
  }).catch((e) => ({ err: e.message }));
  console.log('SHELL webPrefs plugins:', JSON.stringify(plugins));

  const page = await openTab(`http://127.0.0.1:${port}/p`);
  await page.waitForTimeout(800);
  await page.click('#pdf').catch((e) => console.log('click err', e.message));
  await page.waitForTimeout(3500);

  const dl = await app.evaluate(() => globalThis.__dl);
  console.log('WILL-DOWNLOAD (pdf):', JSON.stringify(dl));

  // Che cosa mostra ora la scheda?
  const urls = app.windows().map((w) => w.url());
  console.log('WINDOW URLS:', JSON.stringify(urls));
  const pdfPage = app.windows().find((w) => w.url().includes('doc.pdf'));
  if (pdfPage) {
    const body = await pdfPage.evaluate(() => ({
      title: document.title,
      embed: !!document.querySelector('embed, object, iframe'),
      text: (document.body.innerText || '').slice(0, 200),
      html: document.documentElement.outerHTML.slice(0, 400),
    })).catch((e) => ({ err: e.message }));
    console.log('PDF PAGE:', JSON.stringify(body, null, 2));
    await pdfPage.screenshot({ path: 'tests/.shots/probe-pdf.png' }).catch(() => {});
  } else {
    console.log('Nessuna scheda ha aperto il PDF; la scheda originale è ancora su:', page.url());
  }

  // Prova diretta: apri il PDF come tab.
  const direct = await openTab(`http://127.0.0.1:${port}/doc.pdf`).catch((e) => null);
  await new Promise((r) => setTimeout(r, 2500));
  if (direct) {
    const b = await direct.evaluate(() => ({
      url: location.href,
      title: document.title,
      embed: !!document.querySelector('embed, object, iframe'),
      text: (document.body.innerText || '').slice(0, 200),
    })).catch((e) => ({ err: e.message }));
    console.log('PDF DIRETTO:', JSON.stringify(b, null, 2));
    await direct.screenshot({ path: 'tests/.shots/probe-pdf-direct.png' }).catch(() => {});
  }
  const dl2 = await app.evaluate(() => globalThis.__dl);
  console.log('WILL-DOWNLOAD dopo apertura diretta:', JSON.stringify(dl2));

  await new Promise((r) => srv.close(r));
});
