// #2393 — Un collegamento trascinato da una pagina sulla fila delle schede, come in Chrome: sul centro di una scheda la
// porta lì, sul bordo di una scheda o sul «+» ne apre una nuova in quel posto. La miniatura di un video porta con sé
// anche l'immagine: il collegamento vince lo stesso. Il trascinamento è quello vero del sistema, via DevTools.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from './helpers/percorsi.mjs';
import { neiRiquadri } from './helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const pagina = (titolo) => `<!doctype html><html><head><meta charset="utf-8"><title>${titolo}</title></head>`
  + `<body style="margin:0;font:16px sans-serif"><p>${titolo}</p></body></html>`;

// Trascinamento vero sul punto (x, y) della barra. `immagine`: il file che Chromium aggiunge a una miniatura.
async function trascina(shell, url, { x, y, fasi = ['dragEnter', 'dragOver', 'drop'], file = [], maschera = 1 }) {
  const s = await shell.context().newCDPSession(shell);
  const data = {
    items: [{ mimeType: 'text/uri-list', data: url }, { mimeType: 'text/plain', data: url }],
    files: file,
    dragOperationsMask: maschera,
  };
  for (const type of fasi) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}

// Su un sito l'Aiuto sta nello strato sopra la scheda (#1509.3).
const statoAiuto = (app, page) => neiRiquadri(app, page, () => ({
  aperto: !!globalThis.SN_SIDEBAR?.isOpen?.(),
  allegati: globalThis.__filoSidebarTest?.allegati?.() || [],
}));

const stato = (shell) => shell.evaluate(async () => {
  const snap = await window.filoShell.tabs.snapshot();
  return { attiva: snap.activeId, schede: snap.tabs.map((t) => ({ id: t.id, url: t.url })) };
});

async function treSchede(shell, openTab, testServer) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await openTab(testServer.html(pagina('Prima')));
  await openTab(testServer.html(pagina('Seconda')));
  await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 8_000 });
}

const punto = async (loc, frazione = 0.5) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width * frazione, y: b.y + b.height / 2 };
};

test('lasciato al centro di una scheda: quella scheda apre il collegamento e passa davanti, nessuna scheda nuova', async ({ shell, openTab, testServer }) => {
  await treSchede(shell, openTab, testServer);
  const prima = await stato(shell);
  const bersaglio = prima.schede[1];
  const video = testServer.html(pagina('Video'));
  const p = await punto(shell.locator(`.tab[data-id="${bersaglio.id}"]`));
  await trascina(shell, video, { ...p, fasi: ['dragEnter', 'dragOver'] });
  await expect(shell.locator(`.tab[data-id="${bersaglio.id}"]`)).toHaveClass(/link-sopra/);
  await expect(shell.locator('.link-posto')).toBeHidden();
  await shell.screenshot({ path: 'tests/.shots/link-su-scheda-sopra.png' });
  await trascina(shell, video, { ...p, fasi: ['drop'] });
  await expect.poll(async () => (await stato(shell)).schede.find((t) => t.id === bersaglio.id)?.url, { timeout: 8_000 }).toBe(video);
  const dopo = await stato(shell);
  expect(dopo.attiva).toBe(bersaglio.id);
  expect(dopo.schede.map((t) => t.id)).toEqual(prima.schede.map((t) => t.id));
  await expect(shell.locator('.tab.link-sopra')).toHaveCount(0);
});

test('la miniatura di un video porta anche la sua immagine: su una scheda vince il collegamento, e un sito che dà solo il collegamento va lo stesso', async ({ shell, openTab, testServer }) => {
  await treSchede(shell, openTab, testServer);
  const prima = await stato(shell);
  const foto = join(cartellaInCasa('filo-test-link-'), 'miniatura.png');
  writeFileSync(foto, PNG);
  const video = testServer.html(pagina('Video'));
  await trascina(shell, video, { ...(await punto(shell.locator('.tab').nth(2))), file: [foto] });
  await expect.poll(async () => (await stato(shell)).schede[2].url, { timeout: 8_000 }).toBe(video);
  // Un collegamento che si può solo collegare, non copiare (maschera 2): il rilascio arriva lo stesso.
  const altro = testServer.html(pagina('Altro'));
  await trascina(shell, altro, { ...(await punto(shell.locator('.tab').nth(1))), maschera: 2 });
  await expect.poll(async () => (await stato(shell)).schede[1].url, { timeout: 8_000 }).toBe(altro);
  expect((await stato(shell)).schede).toHaveLength(prima.schede.length);
});

test('sul bordo fra due schede ne nasce una nuova proprio lì, davanti; il segno mostra il posto prima di lasciare', async ({ shell, openTab, testServer }) => {
  await treSchede(shell, openTab, testServer);
  const prima = await stato(shell);
  const video = testServer.html(pagina('Video'));
  const p = await punto(shell.locator('.tab').nth(1), 0.92);
  await trascina(shell, video, { ...p, fasi: ['dragEnter', 'dragOver'] });
  await expect(shell.locator('.link-posto')).toBeVisible();
  await expect(shell.locator('.tab.link-sopra')).toHaveCount(0);
  const segno = await shell.locator('.link-posto').boundingBox();
  const terza = await shell.locator('.tab').nth(2).boundingBox();
  expect(Math.abs(segno.x + 1 - terza.x)).toBeLessThan(3);
  await shell.screenshot({ path: 'tests/.shots/link-su-scheda-fra-due.png' });
  await trascina(shell, video, { ...p, fasi: ['drop'] });
  await expect.poll(async () => (await stato(shell)).schede.length, { timeout: 8_000 }).toBe(4);
  const dopo = await stato(shell);
  expect(dopo.schede[2].url).toBe(video);
  expect(dopo.attiva).toBe(dopo.schede[2].id);
  expect(dopo.schede.filter((t) => t.url !== video).map((t) => t.url)).toEqual(prima.schede.map((t) => t.url));
  await expect(shell.locator('.link-posto')).toBeHidden();
});

test('nel tema scuro la scheda che riceve e il segno fra due si vedono', async ({ app, shell, openTab, testServer }) => {
  await treSchede(shell, openTab, testServer);
  const fondo = () => shell.evaluate(() => getComputedStyle(document.querySelector('.tab-row')).backgroundColor
    + getComputedStyle(document.documentElement).getPropertyValue('--bg') + getComputedStyle(document.documentElement).getPropertyValue('--tab-active'));
  const chiaro = await fondo();
  // La barra segue il tema del sistema (prefers-color-scheme): qui lo si chiede scuro alla sola barra.
  await shell.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(fondo, { timeout: 5_000 }).not.toBe(chiaro);
  const video = testServer.html(pagina('Video'));
  await trascina(shell, video, { ...(await punto(shell.locator('.tab').nth(1))), fasi: ['dragEnter', 'dragOver'] });
  await expect(shell.locator('.tab').nth(1)).toHaveClass(/link-sopra/);
  await shell.screenshot({ path: 'tests/.shots/link-su-scheda-sopra-scuro.png' });
  await trascina(shell, video, { ...(await punto(shell.locator('.tab').nth(0), 0.95)), fasi: ['dragOver'] });
  await expect(shell.locator('.link-posto')).toBeVisible();
  await expect(shell.locator('.tab.link-sopra')).toHaveCount(0);
  await shell.screenshot({ path: 'tests/.shots/link-su-scheda-fra-due-scuro.png' });
  await trascina(shell, video, { ...(await punto(shell.locator('.tab').nth(0), 0.95)), fasi: ['dragCancel'] });
  await expect(shell.locator('.link-posto')).toBeHidden();
});

test('sul «+» o sulla parte vuota della fila si apre in una scheda nuova in fondo; un’immagine sulla parte vuota resta della chat', async ({ app, shell, openTab, testServer }) => {
  await treSchede(shell, openTab, testServer);
  const uno = testServer.html(pagina('Uno'));
  await trascina(shell, uno, await punto(shell.locator('#tab-new')));
  await expect.poll(async () => (await stato(shell)).schede.at(-1)?.url, { timeout: 8_000 }).toBe(uno);
  const nuova = await shell.locator('#tab-new').boundingBox();
  const vuoto = { x: nuova.x + nuova.width + 120, y: nuova.y + nuova.height / 2 };
  const due = testServer.html(pagina('Due'));
  await trascina(shell, due, vuoto);
  await expect.poll(async () => (await stato(shell)).schede.at(-1)?.url, { timeout: 8_000 }).toBe(due);
  const dopo = await stato(shell);
  expect(dopo.schede).toHaveLength(5);
  expect(dopo.attiva).toBe(dopo.schede.at(-1).id);
  let sito = null;
  await expect.poll(() => Boolean(sito = app.windows().find((w) => w.url() === due)), { timeout: 8_000 }).toBe(true);
  await sito.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  // La miniatura lasciata dove non c'è una scheda: l'immagine va alla chat come prima (#1623), nessuna scheda nuova.
  // La fila si è allungata: la parte vuota si rimisura, o il punto cadrebbe sulla scheda appena nata.
  await expect(shell.locator('.tab')).toHaveCount(5);
  const piu = await shell.locator('#tab-new').boundingBox();
  const fondo = { x: piu.x + piu.width + 120, y: piu.y + piu.height / 2 };
  const foto = join(cartellaInCasa('filo-test-link-'), 'miniatura.png');
  writeFileSync(foto, PNG);
  await trascina(shell, testServer.html(pagina('Tre')), { ...fondo, fasi: ['dragEnter', 'dragOver'], file: [foto] });
  await expect(shell.locator('.link-posto')).toBeHidden();
  await trascina(shell, testServer.html(pagina('Tre')), { ...fondo, fasi: ['drop'], file: [foto] });
  await expect.poll(() => statoAiuto(app, sito), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: [{ nome: 'miniatura.png' }] });
  expect((await stato(shell)).schede).toHaveLength(5);
});

test('un indirizzo che non è del web (javascript:, file:, pagine di Filo) lasciato su una scheda non fa niente', async ({ shell, openTab, testServer }) => {
  await treSchede(shell, openTab, testServer);
  const prima = await stato(shell);
  const p = await punto(shell.locator('.tab').nth(2));
  for (const url of ['javascript:document.title="preso"', 'file:///etc/hosts', 'filo://options/options.html']) {
    await trascina(shell, url, p);
  }
  await shell.waitForTimeout(800);
  expect(await stato(shell)).toEqual(prima);
  // Un collegamento vero dopo: arriva, quindi i tre prima sono stati scartati e il rilascio era arrivato.
  const vero = testServer.html(pagina('Vero'));
  await trascina(shell, vero, p);
  await expect.poll(async () => (await stato(shell)).schede[2].url, { timeout: 8_000 }).toBe(vero);
  const dopo = await stato(shell);
  expect(dopo.schede.map((t) => t.id)).toEqual(prima.schede.map((t) => t.id));
});

test('a schermo intero, con le schede scese dal bordo alto, il collegamento lasciato su una scheda si apre lì', async ({ app, shell, openTab, testServer }) => {
  await treSchede(shell, openTab, testServer);
  const davanti = await stato(shell);
  const sito = app.windows().find((w) => w.url() === davanti.schede[2].url);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.setContentFullscreen(true);
  });
  const scese = () => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    return tm.schedeInAlto.visibili;
  });
  await expect.poll(async () => app.evaluate(({ BrowserWindow }, id) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    return tm.tabs.find((t) => t.id === id).view.getBounds().y;
  }, davanti.attiva)).toBe(0);
  expect(await scese()).toBe(false);
  await sito.mouse.move(400, 200);
  await sito.mouse.move(400, 0, { steps: 4 });
  await expect.poll(scese, { timeout: 4_000 }).toBe(true);
  const video = testServer.html(pagina('Video'));
  await trascina(shell, video, await punto(shell.locator('.tab').nth(1)));
  await expect.poll(async () => (await stato(shell)).schede[1].url, { timeout: 8_000 }).toBe(video);
  expect((await stato(shell)).attiva).toBe(davanti.schede[1].id);
  expect((await stato(shell)).schede).toHaveLength(3);
});
