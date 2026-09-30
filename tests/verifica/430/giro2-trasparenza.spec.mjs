// Verifica #430 giro 2 — esplorazione a finestra vera (FILO_TEST_VISIBLE=1): mentre si fotografa una scheda di
// dietro, sotto quella davanti, lo schermo non deve mostrarla. Si guarda lo schermo con scrot.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { pagina, schede, idDi } from './giro2-carta.mjs';

import { resolve } from 'node:path';

// Il colore dello schermo vero a metà della pagina (x, y in coordinate di schermo).
async function pixel(app, file, x, y) {
  execFileSync('scrot', ['-o', file]);
  return app.evaluate(({ nativeImage }, [f, x, y]) => {
    const img = nativeImage.createFromPath(f);
    const { width } = img.getSize();
    const b = img.toBitmap();
    const i = (y * width + x) * 4;
    return [b[i + 2], b[i + 1], b[i]];
  }, [resolve(file), x, y]);
}

test('davanti una pagina senza sfondo: la scheda aperta dietro non si vede mentre la si fotografa', async ({ app, shell, openTab, testServer }) => {
  test.skip(process.env.FILO_TEST_VISIBLE !== '1', 'solo a finestra vera');
  mkdirSync('tests/.shots', { recursive: true });
  const dietro = testServer.html(pagina('#d01010', 'Rossa'));
  const uA = testServer.html(`<!doctype html><title>Trasparente</title><style>html,body{background:transparent;margin:0;height:100%}</style>
<a id="vai" href="${dietro}" style="font:30px sans-serif;display:block;padding:20px">vai</a>`);
  const pA = await openTab(uA);
  await idDi(app, (t) => t.url === uA);
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds());
  console.log('FINESTRA', JSON.stringify(b));
  await pA.click('#vai', { modifiers: ['Control'] });
  let visti = 0;
  let giri = 0;
  const fine = Date.now() + 5000;
  while (Date.now() < fine) {
    const [r, g, bl] = await pixel(app, 'tests/.shots/430-g2-schermo.png', b.x + Math.round(b.width / 2), b.y + Math.round(b.height * 0.7));
    if (giri === 0) console.log('PRIMO PIXEL', r, g, bl);
    giri++;
    if (r > 180 && g < 90 && bl < 90) { visti++; execFileSync('cp', ['tests/.shots/430-g2-schermo.png', 'tests/.shots/430-g2-schermo-rosso.png']); }
  }
  const s = await schede(app);
  console.log('SCATTI', giri, 'ROSSI', visti, JSON.stringify(s.tutte.map((t) => [t.title, t.foto])));
  expect(visti).toBe(0);
});

test('la carta vera sullo schermo, sotto la scheda puntata', async ({ app, shell, openTab, testServer }) => {
  test.skip(process.env.FILO_TEST_VISIBLE !== '1', 'solo a finestra vera');
  mkdirSync('tests/.shots', { recursive: true });
  const dietro = testServer.html(pagina('#10b010', 'Un articolo di giornale con un titolo lungo'));
  const uA = testServer.html(pagina('#f4f4f4', 'Davanti', `<a id="vai" href="${dietro}">vai</a>`));
  const pA = await openTab(uA);
  await idDi(app, (t) => t.url === uA);
  await pA.click('#vai', { modifiers: ['Control'] });
  const d = await idDi(app, (t) => t.url === dietro);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === d).foto, { timeout: 10_000 }).toBe(true);
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(900);
  await shell.locator(`.tab[data-id="${d}"]`).hover();
  await shell.waitForTimeout(700);
  execFileSync('scrot', ['-o', 'tests/.shots/430-g2-carta-vera.png']);
});

test('la scheda fotografata sotto quella davanti, aperta con un clic, si vede', async ({ app, shell, openTab, testServer }) => {
  test.skip(process.env.FILO_TEST_VISIBLE !== '1', 'solo a finestra vera');
  mkdirSync('tests/.shots', { recursive: true });
  const dietro = testServer.html(pagina('#d01010', 'Rossa'));
  const uA = testServer.html(pagina('#f4f4f4', 'Davanti', `<a id="vai" href="${dietro}">vai</a>`));
  const pA = await openTab(uA);
  await idDi(app, (t) => t.url === uA);
  await pA.click('#vai', { modifiers: ['Control'] });
  const d = await idDi(app, (t) => t.url === dietro);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === d).foto, { timeout: 10_000 }).toBe(true);
  await shell.waitForTimeout(4000);
  await shell.locator(`.tab[data-id="${d}"]`).click();
  await shell.waitForTimeout(800);
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds());
  const [r, g, bl] = await pixel(app, 'tests/.shots/430-g2-aperta.png', b.x + Math.round(b.width / 2), b.y + Math.round(b.height * 0.7));
  console.log('APERTA', r, g, bl);
  expect(r > 180 && g < 90 && bl < 90).toBe(true);
});
