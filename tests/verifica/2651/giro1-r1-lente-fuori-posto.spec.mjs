// Verifica #2651, giro 1, rilievo 1: la foto ferma e la lente devono stare sotto il puntatore anche con la barra di
// scorrimento della pagina e con la pagina ingrandita dal suo foglio di stile (come fa la dimensione del testo di Filo).
import { test, expect } from '../../fixtures/electron.mjs';
import { premiNellaBarra } from '../../helpers/barra.mjs';

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const scrivi = (app, t) => app.evaluate(({ clipboard }, testo) => clipboard.writeText(testo), t);

// I punti (in pixel CSS) della foto che rispettano `prova`, decodificati dal main.
const puntiDove = (app, buf, prova, riga = null) => app.evaluate(({ nativeImage }, d) => {
  const img = nativeImage.createFromBuffer(Buffer.from(d.b64, 'base64'));
  const { width, height } = img.getSize();
  const b = img.toBitmap();
  const ok = new Function('r', 'g', 'b', `return ${d.prova};`);
  const out = [];
  for (let y = d.riga ?? 0; y < (d.riga != null ? d.riga + 1 : height); y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (ok(b[i + 2], b[i + 1], b[i])) out.push([x, y]);
    }
  }
  return out;
}, { b64: buf.toString('base64'), prova, riga });

async function apri(app, page) {
  await premiNellaBarra(app, 'colorPicker');
  const strato = page.locator('.sn-color-overlay');
  await expect(strato).toBeVisible({ timeout: 8000 });
  return strato;
}

test('r1 con la barra di scorrimento, la riga sottile si prende cliccando dove si vede', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#ffffff">
    <div style="position:fixed;left:1150px;top:0;width:3px;height:100vh;background:#ff0000"></div>
    <div style="height:3000px"></div></body></html>`);
  await scrivi(app, 'prima');
  await apri(app, page);
  await page.mouse.move(600, 300);
  const rossi = await puntiDove(app, await page.screenshot({ scale: 'css' }), 'r > 200 && g < 60 && b < 60', 300);
  expect(rossi.length).toBeGreaterThan(0);
  const [x] = rossi[Math.floor(rossi.length / 2)];
  await page.mouse.click(x, 300);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#FF0000');
});

test('r1 con la pagina ingrandita dal suo stile, la lente compare accanto al puntatore', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><style>html{zoom:1.5}</style></head>
    <body style="margin:0"><div style="position:fixed;inset:0;background:#e05a2b"></div></body></html>`);
  await apri(app, page);
  await page.mouse.move(700, 500, { steps: 3 });
  await page.waitForTimeout(200);
  // Il riquadro scuro col codice del colore: sulla pagina tutta arancio è l'unica cosa scura.
  const scuri = await puntiDove(app, await page.screenshot({ scale: 'css' }), 'r < 90 && g < 90 && b < 90');
  await page.keyboard.press('Escape');
  expect(scuri.length).toBeGreaterThan(50);
  const xs = scuri.map((p) => p[0]), ys = scuri.map((p) => p[1]);
  expect(Math.max(...xs) - 700).toBeLessThan(300);
  expect(Math.max(...ys) - 500).toBeLessThan(300);
});
