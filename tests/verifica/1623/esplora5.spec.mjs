// Esplorazione verifica #1623 giro 5.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo, statoDi } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function suDisco(nomi, byte = PNG) {
  const dir = cartellaInCasa('filo-verifica-1623-');
  return nomi.map((n) => { const p = join(dir, n); writeFileSync(p, byte); return p; });
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
}));
async function home(app) {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible();
  return page;
}
const SPIA = `<script>
  window.visti = [];
  const nota = (dove) => (e) => { for (const f of (e.dataTransfer && e.dataTransfer.files) || []) window.visti.push(dove + ' ' + f.name); };
  window.addEventListener('drop', nota('window'), true);
  document.addEventListener('drop', nota('doc'));
</script>`;

test('e1 casella di ricerca: Aiuto la prende e la pagina non la vede', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><input id="q" type="search" style="position:fixed;left:50px;top:50px;width:500px;height:60px">${SPIA}</body></html>`);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 200, y: 80 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: ['foto.png'] });
  console.log('E1 visti', JSON.stringify(await page.evaluate(() => window.visti)));
});

test('e2 contenteditable: Aiuto la prende e la pagina non la vede', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><div contenteditable="true" style="position:fixed;left:50px;top:50px;width:500px;height:200px;border:1px solid">scrivi</div>${SPIA}</body></html>`);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 200, y: 100 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: ['foto.png'] });
  console.log('E2 visti', JSON.stringify(await page.evaluate(() => window.visti)));
  console.log('E2 testo', JSON.stringify(await page.evaluate(() => document.querySelector('[contenteditable]').innerHTML)));
});

test('e3 home: pdf e immagine fuori dal campo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  const [foto] = suDisco(['foto.png']);
  const [pdf] = suDisco(['contratto.pdf'], Buffer.from('%PDF-1.4'));
  await lascia(page, [foto, pdf], { x: 120, y: 120 });
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator('#imgPreviews .dash-file-chip')).toHaveText(/contratto\.pdf/, { timeout: 5_000 });
  await page.screenshot({ path: 'tests/.shots/v1623-e3-home.png' });
});

test('e4 home: solo pdf fuori dal campo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  const [pdf] = suDisco(['contratto.pdf'], Buffer.from('%PDF-1.4'));
  await lascia(page, [pdf], { x: 120, y: 120 });
  await expect(page.locator('#imgPreviews .dash-file-chip')).toHaveText(/contratto\.pdf/, { timeout: 5_000 });
});

test('e5 sito: immagine rotta dice che non si apre', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">x</body></html>');
  const [rotta] = suDisco(['rotta.png'], Buffer.from('non sono un png'));
  await lascia(page, [rotta]);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tests/.shots/v1623-e5-rotta.png' });
  console.log('E5', JSON.stringify(await statoAiuto(app, page)), (await statoDi(app, page, '.sn-toast'))?.testo);
});

test('e6 sito: Aiuto aperto e ripiegato, immagine lasciata sulla pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">x</body></html>');
  const [a, b] = suDisco(['a.png', 'b.png']);
  await lascia(page, [a]);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: ['a.png'] });
  await nelMondoDiFilo(app, page, () => { globalThis.SN_SIDEBAR.close?.(); return 1; });
  await page.waitForTimeout(500);
  await lascia(page, [b]);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true });
  console.log('E6', JSON.stringify(await statoAiuto(app, page)));
  await page.screenshot({ path: 'tests/.shots/v1623-e6-sito.png' });
});

test('e7 riquadro con casella: la pagina del riquadro non vede la foto', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(`<!doctype html><html><body style="margin:0;height:100vh;background:#eef"><input style="width:300px;height:80px">${SPIA}</body></html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><iframe id="r" src="${dentro}" style="position:fixed;left:0;top:0;width:400px;height:300px;border:0"></iframe></body></html>`);
  await expect.poll(() => page.frames().some((f) => f.url() === dentro && f !== page.mainFrame())).toBe(true);
  const fr = page.frames().find((f) => f.url() === dentro);
  await fr.waitForLoadState('domcontentloaded');
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 100, y: 30 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: ['foto.png'] });
  console.log('E7 visti', JSON.stringify(await fr.evaluate(() => window.visti)));
});
