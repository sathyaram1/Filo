// #1668 — chiedendo a Filo in chat di mandare un feedback, le immagini incollate nella conversazione partono con lui:
// il riquadro di conferma le mostra in miniatura, un clic le toglie, oltre i 5 si sceglie prima di poter inviare.
// Modello finto e deposito finto: si guarda cosa vede l'utente e cosa arriva a SN_FEEDBACK.submit.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, scrollConfirmToEnd, aspettaConfermaPronta } from './helpers/confirm.mjs';

const feedback = (args) => ({ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ titolo: 'Zoom rotto', testo: 'Lo zoom non si ingrandisce.', ...args }) });

async function depositoFinto(app) {
  await app.evaluate(() => {
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__submitVero = FB.submit;
    globalThis.__depositati = [];
    FB.submit = async (p) => { globalThis.__depositati.push(JSON.parse(JSON.stringify(p))); return { id: `fb-${globalThis.__depositati.length}` }; };
  });
}
const depositati = (app) => app.evaluate(() => globalThis.__depositati || []);
const rimetti = (app) => app.evaluate(() => { if (globalThis.__submitVero) globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });

// Foto vere, fatte da un canvas e incollate come dagli appunti.
async function incolla(page, colori) {
  await page.evaluate(async (colori) => {
    const dt = new DataTransfer();
    for (const [i, c] of colori.entries()) {
      const cv = new OffscreenCanvas(48, 32);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 48, 32);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      dt.items.add(new File([blob], `foto${i}.png`, { type: 'image/png' }));
    }
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, colori);
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(colori.length, { timeout: 5000 });
}

async function conferma(page) {
  await aspettaConfermaPronta(page);
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
}

test('immagine incollata, «manda questo come feedback»: miniatura nel riquadro e una immagine nel deposito', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await depositoFinto(app);
  await modelloFinto(app, [{ text: '', toolCalls: [feedback({ allegati: ['1'] })] }, { text: 'Inviata, con la tua immagine.' }]);
  await incolla(page, ['#c45a3b']);
  await chiedi(page, 'manda questo come feedback');

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await confirmState(page))?.allegati?.length).toBe(1);
  const s = await confirmState(page);
  expect(s.text).toContain('Lo zoom non si ingrandisce.');
  expect(s.allegati[0]).toMatchObject({ id: 'immagine:1', tolto: false, immagine: true });
  await expect.poll(async () => (await confirmState(page)).allegati[0].caricata).toBe(true);
  expect(s.allegati[0].larghezza).toBeGreaterThan(40);
  await page.screenshot({ path: 'tests/.shots/feedback-allegati-chat.png' });
  await conferma(page);

  await expect.poll(async () => (await depositati(app)).length, { timeout: 10_000 }).toBe(1);
  const [p] = await depositati(app);
  expect(p.text).toContain('Lo zoom non si ingrandisce.');
  expect(p.images).toHaveLength(1);
  expect(p.images[0].dataUrl).toMatch(/^data:image\/png;base64,/);
  await rimetti(app);
  await ripristina(app);
});

test('un\'immagine che la chat non ha non si inventa, e una tolta nel riquadro non parte', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  // Nel tema scuro: la nota e la miniatura tolta devono leggersi anche lì.
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
    { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await depositoFinto(app);
  await modelloFinto(app, [{ text: '', toolCalls: [feedback({ allegati: ['1', '7'] })] }, { text: 'Inviata.' }]);
  await incolla(page, ['#3b7ac4']);
  await chiedi(page, 'segnala questo bug con l\'immagine');

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await confirmState(page))?.allegati?.length).toBe(1);
  expect((await confirmState(page)).notaAllegati).toContain('«immagine 7» non è in questa chat');
  expect(await page.evaluate(() => window.SN_CONFIRM_UI._test.allegato('immagine:1'))).toBe(true);
  expect((await confirmState(page)).allegati[0].tolto).toBe(true);
  await page.screenshot({ path: 'tests/.shots/feedback-allegati-chat-scuro.png' });
  await conferma(page);

  await expect.poll(async () => (await depositati(app)).length, { timeout: 10_000 }).toBe(1);
  const [p] = await depositati(app);
  expect(p.images || []).toHaveLength(0);
  expect(p.text).toContain('Lo zoom non si ingrandisce.');
  await rimetti(app);
  await ripristina(app);
});

test('oltre le 5 immagini il riquadro dice quante togliere e l\'OK aspetta la scelta', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await depositoFinto(app);
  await modelloFinto(app, [{ text: '', toolCalls: [feedback({ allegati: ['1', '2', '3', '4', '5', '6'] })] }, { text: 'Inviata.' }]);
  await incolla(page, ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666']);
  await chiedi(page, 'manda un feedback con tutte queste');

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await confirmState(page))?.allegati?.length).toBe(6);
  await aspettaConfermaPronta(page);
  await scrollConfirmToEnd(page);
  let s = await confirmState(page);
  expect(s.notaAllegati).toContain('6 immagini: ne partono al massimo 5, togline 1');
  expect(s.okDisabled).toBe(true);
  expect(await page.evaluate(() => window.SN_CONFIRM_UI._test.click('ok'))).toBe(false);
  await page.screenshot({ path: 'tests/.shots/feedback-allegati-chat-oltre.png' });

  await page.evaluate(() => window.SN_CONFIRM_UI._test.allegato('immagine:3'));
  s = await confirmState(page);
  expect(s.notaAllegati).toBe('');
  expect(s.okDisabled).toBe(false);
  await clickConfirm(page, 'ok');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);

  await expect.poll(async () => (await depositati(app)).length, { timeout: 10_000 }).toBe(1);
  expect((await depositati(app))[0].images).toHaveLength(5);
  await rimetti(app);
  await ripristina(app);
});

// #1664 — una foto oltre i 4 MB entra nella chat come riga «File:»: parte rimpicciolita, come dal riquadro; un AVIF
// parte ridisegnato; un HEIC, che non si apre, resta fuori col perché.
test('dalla chat una foto grande e un AVIF presi dal computer partono preparati, un HEIC no', async ({ app }) => {
  test.setTimeout(120_000);
  const b64 = await app.evaluate(({ nativeImage }) => {
    const w = 2600;
    const h = 2000;
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < buf.length; i++) buf[i] = (i % 4 === 3) ? 255 : Math.floor(Math.random() * 256);
    return nativeImage.createFromBitmap(buf, { width: w, height: h }).toJPEG(95).toString('base64');
  });
  const dir = cartellaTemporanea('filo-allegati-chat-');
  const foto = join(dir, 'IMG_2041.jpg');
  const avif = join(dir, 'scansione.avif');
  const heic = join(dir, 'IMG_2042.HEIC');
  writeFileSync(foto, Buffer.from(b64, 'base64'));
  expect(statSync(foto).size, 'la foto di prova supera il tetto').toBeGreaterThan(TETTO);
  copyFileSync('tests/fixtures/provenienza/xmp-ai.avif', avif);
  writeFileSync(heic, Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 1, 2, 3]));

  const page = await home(app);
  await depositoFinto(app);
  await modelloFinto(app, [{ text: '', toolCalls: [feedback({ allegati: [foto, avif, heic] })] }, { text: 'Inviata.' }]);
  await chiedi(page, `manda queste con la segnalazione\nFile: ${foto}\nFile: ${avif}\nFile: ${heic}`);

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await confirmState(page))?.allegati?.length).toBe(3);
  await expect.poll(async () => (await confirmState(page)).allegati.map((v) => [v.immagine, v.tolto]), { timeout: 20_000 })
    .toEqual([[true, false], [true, false], [false, true]]);
  expect((await confirmState(page)).notaAllegati).toContain('IMG_2042.HEIC');
  await conferma(page);

  await expect.poll(async () => (await depositati(app)).length, { timeout: 15_000 }).toBe(1);
  const [p] = await depositati(app);
  expect(p.images).toHaveLength(2);
  for (const im of p.images) {
    expect(im.dataUrl).toMatch(/^data:image\/(jpeg|png);base64,/);
    expect(Math.floor((im.dataUrl.length - im.dataUrl.indexOf(',') - 1) * 3 / 4)).toBeLessThanOrEqual(TETTO);
  }
  await rimetti(app);
  await ripristina(app);
});
