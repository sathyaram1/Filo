// #1664 — una foto oltre i 4 MB, o in un formato che il browser apre ma non era fra i tipi ammessi, si allega
// rimpicciolita invece di essere rifiutata: nel riquadro «Invia feedback» e nelle caselle di Gestione. Un formato
// che non si apre (HEIC) si rifiuta dicendo cosa fare. La pagina dei feedback: tests/feedback-comment-attachments.spec.mjs.

import { test, expect } from './fixtures/electron.mjs';

const TETTO = 4 * 1024 * 1024;

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

// Una «foto» di rumore: il JPEG non la comprime, e a qualità piena passa i 4 MB come lo scatto di un telefono.
async function preparaFoto(page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 2000;
    const g = c.getContext('2d');
    const im = g.createImageData(c.width, c.height);
    for (let i = 0; i < im.data.length; i++) im.data[i] = (Math.random() * 256) | 0;
    g.putImageData(im, 0, 0);
    const jpeg = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 1));
    const webp = await new Promise((ok) => {
      const p = document.createElement('canvas');
      p.width = 64; p.height = 48;
      p.getContext('2d').fillRect(0, 0, 32, 24);
      p.toBlob(ok, 'image/webp', 0.9);
    });
    window.__foto = jpeg;
    window.__piccola = webp;
  });
  return page.evaluate(() => window.__foto.size);
}

async function rilascia(page, quale, nome, tipo) {
  await page.evaluate(({ quale, nome, tipo }) => {
    const modal = document.querySelector('.sn-fb-modal');
    const dt = new DataTransfer();
    const corpo = quale === 'rotta' ? new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 1, 2, 3]) : window[quale];
    dt.items.add(new File([corpo], nome, { type: tipo }));
    modal.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { quale, nome, tipo });
}

// Quello che parte è quello che la miniatura mostra: se ne leggono peso e tipo.
const miniaturaN = (page, i) => page.evaluate(async (i) => {
  const src = document.querySelectorAll('.sn-fb-thumb img')[i].getAttribute('src');
  const b = await (await fetch(src)).blob();
  return { size: b.size, type: b.type };
}, i);

test('riquadro: una foto oltre i 4 MB entra rimpicciolita, un AVIF entra ridisegnato, un HEIC si rifiuta col perché', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  const peso = await preparaFoto(page);
  expect(peso, 'la foto di prova deve passare il tetto').toBeGreaterThan(TETTO);

  await rilascia(page, '__foto', 'IMG_2041.JPG', 'image/jpeg');
  const miniature = page.locator('.sn-fb-thumb img');
  await expect(miniature).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('.sn-fb-status')).not.toContainText(/Non allegat/);
  const prima = await miniaturaN(page, 0);
  expect(prima.size).toBeGreaterThan(0);
  expect(prima.size).toBeLessThanOrEqual(TETTO);
  expect(prima.type).toMatch(/^image\/(jpeg|png)$/);

  // Il contenuto decide, non l'etichetta: un formato fuori elenco che il browser apre si ridisegna e parte.
  await rilascia(page, '__piccola', 'scansione.avif', 'image/avif');
  await expect(miniature).toHaveCount(2, { timeout: 10_000 });
  expect((await miniaturaN(page, 1)).type).toBe('image/png');

  await rilascia(page, 'rotta', 'IMG_2042.HEIC', 'image/heic');
  await expect(page.locator('.sn-fb-status')).toContainText('IMG_2042.HEIC', { timeout: 10_000 });
  await expect(page.locator('.sn-fb-status')).toContainText(/non sa aprire.*JPEG o PNG/);
  await expect(miniature).toHaveCount(2);

  // L'SVG resta fuori anche adesso: è un documento attivo.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.svg', { type: 'image/svg+xml' }));
    document.querySelector('.sn-fb-modal').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(page.locator('.sn-fb-status')).toContainText(/non supportato/i);
  await expect(miniature).toHaveCount(2);

  await page.screenshot({ path: 'tests/.shots/feedback-immagini-grandi-riquadro.png' });
});

test('riquadro: una foto grande incollata entra anche lei', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await preparaFoto(page);
  // L'incolla da tastiera vuole isTrusted: si passa dalla strada del tasto destro «Incolla immagine», segnata come nostra.
  await page.evaluate(() => {
    const ev = new CustomEvent('filo:paste-image', { bubbles: true, cancelable: true, detail: { blob: window.__foto } });
    document.querySelector('.sn-fb-modal').dispatchEvent(window.SN_FILO_UI.nostro(ev));
  });
  const miniature = page.locator('.sn-fb-thumb img');
  await expect(miniature).toHaveCount(1, { timeout: 20_000 });
  const m = await miniaturaN(page, 0);
  expect(m.size).toBeGreaterThan(0);
  expect(m.size).toBeLessThanOrEqual(TETTO);
});

test('Gestione: una foto oltre i 4 MB allegata a una risposta sale rimpicciolita', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => !!window.SN_MG_ALLEGATI && !!window.SN_IMMAGINI_CHAT, null, { timeout: 10_000 });
  await preparaFoto(page);
  const esito = await page.evaluate(async () => {
    const salite = [];
    window.SN_FEEDBACK.uploadAttachment = async (blob, name) => {
      salite.push({ size: blob.size, type: blob.type, name });
      return { kind: 'img', url: `https://firebasestorage.example/${encodeURIComponent(name)}`, name, type: blob.type };
    };
    const messaggi = [];
    const A = window.SN_MG_ALLEGATI.crea({ alMessaggio: (_k, t) => { if (t) messaggi.push(t); } });
    await A.aggiungi('d1', [new File([window.__foto], 'IMG_2041.JPG', { type: 'image/jpeg' })]);
    return { salite, messaggi, allegati: A.di('d1').length };
  });
  expect(esito.messaggi).toEqual([]);
  expect(esito.allegati).toBe(1);
  expect(esito.salite).toHaveLength(1);
  expect(esito.salite[0].size).toBeLessThanOrEqual(TETTO);
  expect(esito.salite[0].type).toMatch(/^image\/(jpeg|png)$/);
  expect(esito.salite[0].name).toBe('IMG_2041.JPG');
});
