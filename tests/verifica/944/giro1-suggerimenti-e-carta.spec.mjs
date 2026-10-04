// Verifica #944 giro 1: il suggerimento che aspetta la carta della scheda non resta indietro, non arriva in ritardo
// e non compare dopo che il puntatore se n'è andato.

import { test, expect } from '../../fixtures/electron.mjs';

async function scritte(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const out = { suggerimento: null, carta: null };
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed() || !w.isVisible()) continue;
      const url = w.webContents.getURL();
      const leggi = (js) => w.webContents.executeJavaScript(js).catch(() => null);
      if (url === 'filo://shell/anteprima.html') out.carta = await leggi("document.getElementById('titolo').textContent");
      else if (url.startsWith('data:')) {
        const t = await leggi("(document.getElementById('tip') || {}).textContent ?? null");
        if (t != null) out.suggerimento = t;
      }
    }
    return out;
  });
}

async function pronta(shell, openTab, testServer) {
  await openTab(testServer.html('<title>Musica di sottofondo</title>'));
  await openTab(testServer.html('<title>Podcast</title>'));
  await expect(shell.locator('.tab .title')).toHaveText(['Home', 'Musica di sottofondo', 'Podcast'], { timeout: 10_000 });
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 10_000 });
}

test('dalla carta al bottone della barra: il suggerimento arriva presto e la carta non c\'è più', async ({ app, shell, openTab, testServer }) => {
  await pronta(shell, openTab, testServer);
  const tab = shell.locator('.tab').nth(1);
  await tab.locator('.title').hover();
  await expect.poll(() => scritte(app), { timeout: 3000 }).toEqual({ carta: 'Musica di sottofondo', suggerimento: null });
  const t0 = Date.now();
  await shell.locator('#tab-new').hover();
  await expect.poll(() => scritte(app), { timeout: 3000 }).toEqual({ carta: null, suggerimento: 'Nuova scheda' });
  expect(Date.now() - t0, 'il suggerimento ha aspettato troppo').toBeLessThan(1500);
});

test('dalla carta al controllo e via subito: nessun suggerimento resta a schermo', async ({ app, shell, openTab, testServer }) => {
  await pronta(shell, openTab, testServer);
  const tab = shell.locator('.tab').nth(1);
  for (let i = 0; i < 4; i++) {
    await tab.locator('.title').hover();
    await expect.poll(async () => (await scritte(app)).carta, { timeout: 3000 }).toBe('Musica di sottofondo');
    await tab.locator('.close').hover();
    // Esce nel momento in cui il suggerimento sta per comparire, mentre la carta sta ancora sparendo.
    await new Promise((r) => setTimeout(r, 330 + i * 15));
    await shell.mouse.move(600, 400);
    await new Promise((r) => setTimeout(r, 700));
    expect(await scritte(app), `giro ${i}`).toEqual({ carta: null, suggerimento: null });
    await shell.mouse.move(2, 2);
  }
});

test('da un controllo all\'altro di due schede: compare il suggerimento giusto, una volta sola', async ({ app, shell, openTab, testServer }) => {
  await pronta(shell, openTab, testServer);
  const a = shell.locator('.tab').nth(1);
  const b = shell.locator('.tab').nth(2);
  await a.locator('.title').hover();
  await expect.poll(async () => (await scritte(app)).carta, { timeout: 3000 }).toBe('Musica di sottofondo');
  await a.locator('.close').hover();
  await b.locator('.title').hover();
  await b.locator('.close').hover();
  await expect.poll(async () => (await scritte(app)).suggerimento, { timeout: 3000 }).toMatch(/^Chiudi scheda/);
  await new Promise((r) => setTimeout(r, 600));
  expect((await scritte(app)).carta).toBe(null);
});
