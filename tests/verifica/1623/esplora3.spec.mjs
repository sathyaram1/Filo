// Esplorazione del giro 3 di #1623: si cancella prima della consegna.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function foto(n = 1) {
  const dir = cartellaInCasa('filo-test-esplora-');
  return Array.from({ length: n }, (_, i) => { const p = join(dir, `f${i + 1}.png`); writeFileSync(p, PNG); return p; });
}
async function lascia(page, files, { x = 200, y = 200, fasi = ['dragEnter', 'dragOver', 'drop'] } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of fasi) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}
const statoAiuto = (app, page) => nelMondoDiFilo(app, page, () => ({
  aperto: !!globalThis.SN_SIDEBAR?.isOpen?.(),
  allegati: (globalThis.__filoSidebarTest?.allegati?.() || []).map((a) => a.nome),
  fuoco: document.activeElement === document.querySelector('.sn-sidebar-input textarea'),
}));
async function home(app) {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible();
  return page;
}

test('A contenteditable senza codice: va all’Aiuto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:100vh">
    <div id="ed" contenteditable="true" style="position:fixed;left:20px;top:20px;width:500px;height:300px;border:1px solid">scrivi</div></body></html>`);
  await lascia(page, foto(1), { x: 200, y: 150 });
  await page.waitForTimeout(1500);
  const st = await statoAiuto(app, page);
  const html = await page.evaluate(() => document.getElementById('ed').innerHTML);
  console.log('A', JSON.stringify(st), html);
});

test('B pagina che annulla il dragover ovunque ma il drop non lo prende', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:100vh">
    <div id="zona" style="position:fixed;left:0;top:0;width:100px;height:100px;background:#eee">zona</div>
    <script>window.ricevuti=[];document.addEventListener('dragover',(e)=>e.preventDefault());
    zona.addEventListener('drop',(e)=>{e.preventDefault();window.ricevuti.push(1);});</script></body></html>`);
  await lascia(page, foto(1), { x: 400, y: 400 });
  await page.waitForTimeout(1500);
  console.log('B', JSON.stringify(await statoAiuto(app, page)), await page.evaluate(() => window.ricevuti.length));
});

test('C home: dragCancel spegne il campo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  const f = foto(1);
  await lascia(page, f, { x: 120, y: 120, fasi: ['dragEnter', 'dragOver'] });
  const prima = await page.locator('#inputForm').getAttribute('class');
  await lascia(page, f, { x: 120, y: 120, fasi: ['dragCancel'] });
  await page.waitForTimeout(500);
  console.log('C', prima, '->', await page.locator('#inputForm').getAttribute('class'));
});

test('D barra laterale con la home davanti, e fila delle schede col sito: fuoco', async ({ app, shell, openTab, testServer }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const casa = await home(app);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const box = await barra.locator('#pannello').boundingBox();
  await lascia(barra, foto(1), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page_wait(casa);
  console.log('D-home', await casa.locator('#imgPreviews .dash-img-preview img').count());
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:100vh">x</body></html>');
  const t = await shell.locator('.tab').last().boundingBox();
  await lascia(shell, foto(2), { x: t.x + t.width + 260, y: t.y + t.height / 2 });
  await page.waitForTimeout(2000);
  console.log('D-sito', JSON.stringify(await statoAiuto(app, page)));
  const fuocoVista = await app.evaluate(({ BrowserWindow, webContents }) => {
    const f = webContents.getFocusedWebContents();
    return f ? f.getURL() : null;
  });
  console.log('D-focused', fuocoVista);
});
async function page_wait(p) { await p.waitForTimeout(1500); }

test('E pagina delle preferenze e editor', async ({ app, openTab }) => {
  for (const u of ['filo://preferences/preferences.html', 'filo://options/options.html', 'filo://editor/editor.html']) {
    let page;
    try { page = await openTab(u); } catch (e) { console.log('E', u, 'non apre', e.message); continue; }
    await page.waitForTimeout(2000);
    await lascia(page, foto(1), { x: 400, y: 400 });
    await page.waitForTimeout(1500);
    let st = null;
    try { st = await statoAiuto(app, page); } catch (e) { st = e.message; }
    console.log('E', u, JSON.stringify(st));
  }
});

test('F Aiuto spento nelle impostazioni: avviso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:100vh">x</body></html>');
  await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { aiutoAcceso: false, helpEnabled: false } }, { url: 'filo://preferences/preferences.html' });
  });
  await page.waitForTimeout(500);
  await lascia(page, foto(1));
  await page.waitForTimeout(1500);
  const toast = await nelMondoDiFilo(app, page, () => Array.from(document.querySelectorAll('.sn-toast')).map((t) => t.textContent).join('|'));
  console.log('F', JSON.stringify(await statoAiuto(app, page)), toast);
});
