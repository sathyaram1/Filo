// #2393 — Un collegamento trascinato da una pagina sulla fila delle schede, come in Chrome: sul centro di una scheda la
// porta lì, sul bordo di una scheda o sul «+» ne apre una nuova in quel posto. La miniatura di un video porta con sé
// anche l'immagine: il collegamento vince lo stesso. Il trascinamento è quello vero del sistema, via DevTools.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from './helpers/percorsi.mjs';

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

test('sul «+» o sulla parte vuota della fila si apre in una scheda nuova in fondo; un’immagine sulla parte vuota resta della chat', async ({ shell, openTab, testServer }) => {
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
  // La miniatura lasciata dove non c'è una scheda: l'immagine va alla chat come prima (#1623), nessuna scheda nuova.
  const foto = join(cartellaInCasa('filo-test-link-'), 'miniatura.png');
  writeFileSync(foto, PNG);
  await trascina(shell, testServer.html(pagina('Tre')), { ...vuoto, fasi: ['dragEnter', 'dragOver'], file: [foto] });
  await expect(shell.locator('.link-posto')).toBeHidden();
  await trascina(shell, testServer.html(pagina('Tre')), { ...vuoto, fasi: ['drop'], file: [foto] });
  await shell.waitForTimeout(800);
  expect((await stato(shell)).schede).toHaveLength(5);
});

test('un indirizzo che non è del web (javascript:, file:, pagine di Filo) lasciato su una scheda non fa niente', async ({ shell, openTab, testServer }) => {
  await treSchede(shell, openTab, testServer);
  const prima = await stato(shell);
  const p = await punto(shell.locator('.tab').nth(2));
  for (const url of ['javascript:document.title="preso"', 'file:///etc/hosts', 'filo://options/options.html']) {
    await trascina(shell, url, p);
  }
  // Un collegamento vero dopo: se arriva lui, i tre prima sono stati scartati e non solo in ritardo.
  const vero = testServer.html(pagina('Vero'));
  await trascina(shell, vero, p);
  await expect.poll(async () => (await stato(shell)).schede[2].url, { timeout: 8_000 }).toBe(vero);
  const dopo = await stato(shell);
  expect(dopo.schede.map((t) => t.id)).toEqual(prima.schede.map((t) => t.id));
});
