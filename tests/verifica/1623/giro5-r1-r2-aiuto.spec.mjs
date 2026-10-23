// Verifica #1623, giro 5: r1 un'immagine data all'Aiuto lasciandola sopra una casella di testo non arriva al sito
// (che il passaggio non l'aveva accettato); r2 un file immagine rovinato non entra come anteprima rotta, e lo si dice.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo, statoDi } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function suDisco(nome, byte = PNG) {
  const p = join(cartellaInCasa('filo-verifica-1623-g5-'), nome);
  writeFileSync(p, byte);
  return p;
}
async function lascia(page, files, { x = 200, y = 200 } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}
const allegati = (app, page) => nelMondoDiFilo(app, page, () => (globalThis.__filoSidebarTest?.allegati?.() || []).map((a) => a.nome));
// Il sito ascolta i rilasci senza accettare il passaggio: in un browser qualunque non ne riceverebbe nessuno.
const SPIA = `<script>
  window.visti = [];
  const nota = (e) => { for (const f of (e.dataTransfer && e.dataTransfer.files) || []) window.visti.push(f.name); };
  window.addEventListener('drop', nota, true);
</script>`;

test('r1 un’immagine lasciata sopra la casella di ricerca va all’Aiuto e il sito non la legge', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><input type="search" placeholder="Cerca" style="position:fixed;left:50px;top:50px;width:500px;height:60px">${SPIA}</body></html>`);
  await lascia(page, [suDisco('estratto conto.png')], { x: 200, y: 80 });
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toEqual(['estratto conto.png']);
  expect(await page.evaluate(() => window.visti)).toEqual([]);
});

test('r1 un’immagine lasciata su un editor del sito va all’Aiuto e il sito non la legge', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><div contenteditable="true" style="position:fixed;left:50px;top:50px;width:500px;height:200px">scrivi</div>${SPIA}</body></html>`);
  await lascia(page, [suDisco('foto.png')], { x: 200, y: 100 });
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toEqual(['foto.png']);
  expect(await page.evaluate(() => window.visti)).toEqual([]);
});

test('r1 un’immagine lasciata sulla casella di un riquadro incorporato va all’Aiuto e il riquadro non la legge', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(`<!doctype html><html><body style="margin:0;height:100vh"><input style="width:300px;height:80px">${SPIA}</body></html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><iframe src="${dentro}" style="position:fixed;left:0;top:0;width:400px;height:300px;border:0"></iframe></body></html>`);
  await expect.poll(() => page.frames().some((f) => f.url() === dentro && f !== page.mainFrame())).toBe(true);
  const fr = page.frames().find((f) => f.url() === dentro);
  await fr.waitForLoadState('domcontentloaded');
  await lascia(page, [suDisco('foto.png')], { x: 100, y: 30 });
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toEqual(['foto.png']);
  expect(await fr.evaluate(() => window.visti)).toEqual([]);
});

test('r2 un file immagine rovinato non entra nell’Aiuto come anteprima rotta, e un avviso lo dice', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">x</body></html>');
  await lascia(page, [suDisco('rovinata.png', Buffer.from('questo non è un png'))]);
  await expect.poll(async () => (await statoDi(app, page, '.sn-toast'))?.testo || '', { timeout: 8_000 }).toMatch(/non si è aperta/);
  expect(await allegati(app, page)).toEqual([]);
});
