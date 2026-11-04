// #2116 — lo screenshot del riquadro «Invia feedback» copre password e carta come la foto per un modello: due valori
// diversi nel campo danno la stessa immagine. Una password ancora coi puntini resta com'è, come per il modello: si
// prova quella resa visibile. Se coprirli non riesce la pagina non parte, e il riquadro dice perché.
// Finta è solo la rete (la submit nel main).

import { test, expect } from './fixtures/electron.mjs';
import { vistaAvviso, copertura } from './helpers/avvisoSito.mjs';
import { nelMondoDiFilo, nelloStrato, paginaDelloStrato } from './helpers/riquadri.mjs';

async function reteFinta(app) {
  await app.evaluate(() => {
    globalThis.__rete = { payload: [] };
    globalThis.SN_FEEDBACK.submit = async (p) => {
      globalThis.__rete.payload.push(p);
      return { id: `fb-${globalThis.__rete.payload.length}`, seq: 1, failed: [] };
    };
  });
}

// Su http un modulo con password o carta apre l'avviso del sito sospetto: l'utente sceglie «Continua» prima di scrivere.
async function superaAvviso(app) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  await expect.poll(coperta, { timeout: 10_000 }).toBe(true);
  const avviso = await vistaAvviso(app);
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
}

const MODULO = `<!doctype html><html><head><meta charset="utf-8"><title>Accesso</title></head><body><h1>Area clienti</h1>
  <form>
    <p><label for="p">Password</label> <input id="p" type="password" style="width:300px;font-size:20px;outline:0;caret-color:transparent"></p>
    <p><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:300px;font-size:20px;outline:0;caret-color:transparent"></p>
  </form></body></html>`;

// Manda dal riquadro sopra la pagina un feedback con lo screenshot, come l'utente: testo, «Allega screenshot», Invia.
async function mandaConSchermata(app, page, testo) {
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
  if (testo) await strato.locator('.sn-fb-text').fill(testo);
  await strato.locator('.sn-fb-clear').click();
  await expect(strato.locator('.sn-fb-clear')).toHaveAttribute('aria-pressed', 'true');
  await strato.locator('.sn-fb-send').click();
  return strato;
}

// Quanti valori cambiano fra due immagini della pagina dentro il rettangolo r (px della pagina): zero, non si legge.
async function pixelDiversi(page, [a, b], r) {
  return page.evaluate(async ([a, b, r]) => {
    const pixel = async (url) => {
      const byte = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      const img = await createImageBitmap(new Blob([byte]));
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const sx = img.width / window.innerWidth, sy = img.height / window.innerHeight;
      return ctx.getImageData(Math.round(r.left * sx), Math.round(r.top * sy), Math.round(r.width * sx), Math.round(r.height * sy)).data;
    };
    const [pa, pb] = [await pixel(a), await pixel(b)];
    let n = 0;
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) n++;
    return n;
  }, [a, b, r]);
}

const dentro = (b) => ({ left: b.x + 3, top: b.y + 3, width: b.width - 6, height: b.height - 6 });

test('nello screenshot del feedback la password e il numero della carta scritti nella pagina sono coperti', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, MODULO);
  await superaAvviso(app);
  await reteFinta(app);

  const immagini = [];
  for (const [i, [password, carta]] of [['Gatto.Rosso.77', '4111 1111 1111 1111'], ['ab1', '5500 0000 0000 0004']].entries()) {
    // Coi puntini a schermo la password non si legge; si legge quando l'utente preme «mostra» e il sito la fa testo.
    await page.evaluate(() => { document.querySelector('#p').type = 'password'; });
    await page.fill('#p', password);
    await page.evaluate(() => { document.querySelector('#p').type = 'text'; });
    await page.fill('#c', carta);
    const strato = await mandaConSchermata(app, page, `Il tasto Accedi non risponde (${i + 1})`);
    await expect.poll(() => app.evaluate(() => globalThis.__rete.payload.length), { timeout: 15_000 }).toBe(i + 1);
    await expect(strato.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8_000 });
    const img = await app.evaluate(() => globalThis.__rete.payload.at(-1).images.map((x) => ({ name: x.name, dataUrl: x.dataUrl })));
    expect(img, 'lo screenshot deve partire').toHaveLength(1);
    expect(img[0].name).toBe('schermata annotata');
    immagini.push(img[0].dataUrl);
  }
  expect(immagini[0]).toMatch(/^data:image\//);

  const p = await page.locator('#p').boundingBox();
  const c = await page.locator('#c').boundingBox();
  expect(await pixelDiversi(page, immagini, dentro(p)), 'la password si legge nello screenshot del feedback').toBe(0);
  expect(await pixelDiversi(page, immagini, dentro(c)), 'il numero della carta si legge nello screenshot del feedback').toBe(0);
  // Il resto della pagina c'è: nella zona del titolo ci sono i colori del testo, non uno sfondo pieno.
  const h1 = await page.locator('h1').boundingBox();
  const colori = await page.evaluate(async ([url, r]) => {
    const byte = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    const img = await createImageBitmap(new Blob([byte]));
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const sx = img.width / window.innerWidth, sy = img.height / window.innerHeight;
    const d = ctx.getImageData(Math.round(r.left * sx), Math.round(r.top * sy), Math.round(r.width * sx), Math.round(r.height * sy)).data;
    const visti = new Set();
    for (let i = 0; i < d.length; i += 4) visti.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return visti.size;
  }, [immagini[0], { left: h1.x, top: h1.y, width: Math.min(h1.width, 200), height: h1.height }]);
  expect(colori, 'nello screenshot si deve vedere la pagina').toBeGreaterThan(2);
});

test('se un campo segreto non si riesce a coprire lo screenshot non parte e il riquadro dice perché', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, MODULO);
  await superaAvviso(app);
  await reteFinta(app);
  await page.fill('#p', 'Gatto.Rosso.77');
  // Quello che il main risponde quando un campo segreto sta in un riquadro che non si ritrova nella pagina.
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await paginaDelloStrato(app, page);
  await nelloStrato(app, page, () => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => (m && m.type === 'capture_visible_tab'
      ? Promise.resolve({ ok: false, code: 'segreti', error: 'campi segreti che non si riescono a coprire' }) : orig(m, ...r));
    return true;
  });

  // Senza testo non parte niente: il riquadro resta aperto e dice perché.
  let strato = await mandaConSchermata(app, page, '');
  await expect(strato.locator('.sn-fb-status')).toContainText('campo riservato (password o carta) che non sono riuscito a coprire');
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
  expect(await app.evaluate(() => globalThis.__rete.payload.length), 'non parte un feedback vuoto').toBe(0);
  await strato.screenshot({ path: 'tests/.shots/2116-segreti-non-coperti.png' });
  await strato.locator('.sn-fb-cancel').click();

  // Col testo parte il feedback, senza la foto, e l'avviso d'invio lo dice.
  strato = await mandaConSchermata(app, page, 'Il tasto Accedi non risponde');
  await expect.poll(() => app.evaluate(() => globalThis.__rete.payload.length), { timeout: 15_000 }).toBe(1);
  expect(await app.evaluate(() => globalThis.__rete.payload[0].images.length), 'la foto scoperta non deve partire').toBe(0);
  await expect(strato.locator('.sn-toast').filter({ hasText: 'La schermata non è partita' })).toHaveCount(1, { timeout: 8_000 });
});
