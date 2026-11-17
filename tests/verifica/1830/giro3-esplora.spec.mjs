// Verifica #1830 giro 3, esplorazione: numerazione delle immagini fra più turni e immagine grande incollata.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, scrollConfirmToEnd, aspettaConfermaPronta } from '../../helpers/confirm.mjs';

const feedback = (args) => ({ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ titolo: 'Zoom rotto', testo: 'Lo zoom non va.', ...args }) });

async function deposito(app) {
  await app.evaluate(() => {
    globalThis.__dep = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__dep.push(JSON.parse(JSON.stringify(p))); return { id: 'x' }; };
  });
}

async function incolla(page, colori, { w = 48, h = 32, rumore = false } = {}) {
  await page.evaluate(async ({ colori, w, h, rumore }) => {
    const dt = new DataTransfer();
    for (const [i, c] of colori.entries()) {
      const cv = new OffscreenCanvas(w, h);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, w, h);
      if (rumore) {
        const im = ctx.getImageData(0, 0, w, h);
        for (let k = 0; k < im.data.length; k += 4) { im.data[k] = Math.random() * 255; im.data[k + 1] = Math.random() * 255; im.data[k + 2] = Math.random() * 255; im.data[k + 3] = 255; }
        ctx.putImageData(im, 0, 0);
      }
      const blob = await cv.convertToBlob({ type: 'image/png' });
      dt.items.add(new File([blob], `foto${i}.png`, { type: 'image/png' }));
    }
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { colori, w, h, rumore });
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(colori.length, { timeout: 15000 });
}

const coloreDi = (app, i) => app.evaluate(({ nativeImage }, i) => {
  const p = globalThis.__dep[0];
  const ni = nativeImage.createFromDataURL(p.images[i].dataUrl);
  const { width, height } = ni.getSize();
  const b = ni.toBitmap();
  const k = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
  return [b[k + 2], b[k + 1], b[k]];
}, i);

test('esplora: la seconda immagine, incollata in un turno dopo, è quella che parte', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await home(app);
  await deposito(app);
  await modelloFinto(app, [{ text: 'Vista la prima.' }]);
  await incolla(page, ['#ff0000']);
  await chiedi(page, 'guarda questa');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Vista la prima.')).toBeVisible({ timeout: 20_000 });
  await modelloFinto(app, [{ text: 'Vista la seconda.' }]);
  await incolla(page, ['#0000ff']);
  await chiedi(page, 'e questa');
  await expect(page.getByText('Vista la seconda.')).toBeVisible({ timeout: 20_000 });
  await modelloFinto(app, [{ text: '', toolCalls: [feedback({ allegati: ['2'] })] }, { text: 'Inviata.' }]);
  await chiedi(page, 'manda la seconda immagine come feedback');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await confirmState(page))?.allegati?.length).toBe(1);
  const chiamate = await chiamateAlModello(app);
  const ultima = chiamate[chiamate.length - 1] || [];
  console.log('UTENTE VISTO DAL MODELLO:', JSON.stringify(ultima.filter((m) => m.role === 'user').map((m) => (Array.isArray(m.content) ? m.content.map((c) => (c.type === 'text' ? c.text.slice(-200) : c.type)) : String(m.content).slice(-200)))));
  await aspettaConfermaPronta(page);
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await app.evaluate(() => globalThis.__dep)).length, { timeout: 10_000 }).toBe(1);
  const c = await coloreDi(app, 0);
  console.log('COLORE', c);
  expect(c[2]).toBeGreaterThan(200);
  await ripristina(app);
});

test('esplora: una foto grande incollata in chat parte con la segnalazione', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await home(app);
  await deposito(app);
  await modelloFinto(app, [{ text: '', toolCalls: [feedback({ allegati: ['1'] })] }, { text: 'Inviata.' }]);
  await incolla(page, ['#00ff00'], { w: 2560, h: 1440, rumore: true });
  await chiedi(page, 'manda questa come feedback');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await confirmState(page))?.allegati?.length, { timeout: 15_000 }).toBe(1);
  const s = await confirmState(page);
  console.log('GRANDE', JSON.stringify(s.allegati), s.notaAllegati, s.okDisabled);
  await page.screenshot({ path: 'tests/.shots/v1830-g3-grande.png' });
  await aspettaConfermaPronta(page);
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await app.evaluate(() => globalThis.__dep)).length, { timeout: 10_000 }).toBe(1);
  const [p] = await app.evaluate(() => globalThis.__dep);
  console.log('PARTITE', (p.images || []).map((x) => x.dataUrl.length));
  expect(p.images).toHaveLength(1);
  await ripristina(app);
});
