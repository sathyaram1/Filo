// #737.1 giro 11: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

test('navigazione: il clic che porta a una pagina che apre da sola non le regala la scheda', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const b = testServer.html(`<title>B</title><script>window.open(${JSON.stringify(ad)});setTimeout(function(){window.open(${JSON.stringify(ad)})},300)</script>`);
  const page = await openTab(testServer.html(`<a id="l" href="${b}" style="display:block;width:200px;height:60px">vai</a>`));
  await page.waitForTimeout(5600);
  await page.click('#l');
  await page.waitForTimeout(2500);
  console.log('SCHEDE', JSON.stringify(await schede(app)));
  expect(await aperteSu(app, ad)).toBe(0);
});

test('stampa: finestra vuota riempita dalla pagina col clic', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px">Stampa ricevuta</button>
    <script>window.__esito='';document.getElementById('b').onclick=function(){try{var w=window.open('');window.__esito=w?'finestra':'null';
    if(w){w.document.write('<title>RICEVUTA</title><h1>Ricevuta</h1>');w.document.close();}}catch(e){window.__esito='errore '+e.message}}</script>`));
  await page.waitForTimeout(5600);
  await page.click('#b');
  await page.waitForTimeout(2500);
  console.log('STAMPA', await page.evaluate(() => window.__esito), JSON.stringify(await schede(app)));
});

function pdfConLink(uri) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /Annots [6 0 R] >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Annot /Subtype /Link /Rect [0 0 612 792] /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`,
  ];
  const stream = 'BT /F1 48 Tf 72 600 Td (LINK QUI) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return out;
}

for (const tasto of ['left', 'middle']) {
  test(`pdf: clic ${tasto} su un collegamento`, async ({ app, openTab, testServer, shell }) => {
    const dest = testServer.html('<title>DAL PDF</title>');
    const pdf = testServer.asset(pdfConLink(dest), 'application/pdf');
    const page = await openTab(pdf);
    await page.waitForTimeout(4000);
    await page.mouse.move(300, 300);
    await page.mouse.click(300, 300, { button: tasto });
    await page.waitForTimeout(3000);
    console.log('PDF', tasto, JSON.stringify(await schede(app)), page.url());
    await page.screenshot({ path: `tests/.shots/giro11-pdf-${tasto}.png` });
  });
}
