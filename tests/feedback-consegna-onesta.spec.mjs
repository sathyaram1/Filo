// #1667 — il riquadro «Invia feedback» dice «inviato» solo a consegna avvenuta; un allegato che non sale non fa
// partire un feedback vuoto e chi l'ha mandato legge nella finestra quale file è saltato e perché; la schermata
// annotata di uno schermo grande scende sotto i 4 MB e parte. Finta è solo la rete (la submit nel main).

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

// Nel main: la submit di rete la decide la prova (`__rete.esito`), e ogni payload resta scritto.
async function reteFinta(app) {
  await app.evaluate(() => {
    globalThis.__rete = { esito: 'ok', payload: [], sblocca: null };
    globalThis.SN_FEEDBACK.submit = async (p) => {
      const R = globalThis.__rete;
      R.payload.push(p);
      if (R.esito === 'lento') await new Promise((r) => { R.sblocca = r; });
      if (R.esito === 'offline') throw new Error('fetch failed');
      if (R.esito === 'vuoto') {
        throw Object.assign(new Error('Il feedback non è partito: senza testo, e nessun allegato è salito («foto.png»: rifiutato dal deposito).'), { vuoto: true, permanente: true });
      }
      return { id: `fb-${R.payload.length}`, seq: 1, failed: R.esito === 'saltato' ? [{ name: 'foto.png', reason: 'rifiutato dal deposito', permanente: true }] : [] };
    };
  });
}
const esito = (app, e) => app.evaluate((_x, e) => { globalThis.__rete.esito = e; }, e);
const toast = (page, testo) => page.locator('.sn-toast').filter({ hasText: testo });

async function scriviEInvia(page, testo) {
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  if (testo) await page.locator('.sn-fb-text').fill(testo);
  await page.locator('.sn-fb-send').click();
}

test('«inviato» arriva solo quando la consegna è avvenuta; senza rete il riquadro dice «in partenza»', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await reteFinta(app);

  // La consegna è in viaggio: il riquadro si è chiuso (#1403), l'avviso dice che sta partendo e non dice «inviato».
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await esito(app, 'lento');
  await scriviEInvia(page, 'Il tasto Salva non risponde');
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 2_000 });
  await expect(toast(page, 'Sto inviando il feedback')).toHaveCount(1);
  await expect.poll(() => app.evaluate(() => typeof globalThis.__rete.sblocca), { timeout: 12_000 }).toBe('function');
  await page.waitForTimeout(800);
  await expect(toast(page, 'inviato')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/1667-invio-in-corso.png' });
  // Arriva: adesso sì.
  await app.evaluate(() => globalThis.__rete.sblocca());
  await expect(toast(page, 'Sto inviando il feedback')).toHaveCount(0, { timeout: 8_000 });
  await expect(toast(page, 'Grazie! Feedback inviato.')).toHaveCount(1);

  // Senza rete il riquadro si chiude subito, ma non promette quello che non è successo.
  await esito(app, 'offline');
  await scriviEInvia(page, 'La barra sparisce a schermo intero');
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 4_000 });
  const inPartenza = toast(page, 'Feedback in partenza');
  await expect(inPartenza).toHaveCount(1);
  await expect(inPartenza).not.toContainText('inviato');
  expect(await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.size()), 'il feedback resta in coda').toBeGreaterThan(0);
});

test('un allegato saltato lo dice la finestra, col nome e il motivo; un feedback rimasto vuoto non parte e il riquadro resta aperto', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await reteFinta(app);

  await esito(app, 'saltato');
  await scriviEInvia(page, 'Allego la foto del problema');
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8_000 });
  const avviso = shell.locator('.shell-notif').filter({ hasText: 'foto.png' });
  await expect(avviso).toHaveCount(1, { timeout: 10_000 });
  await expect(avviso).toContainText('rifiutato dal deposito');
  await expect(avviso).toContainText('è partito, ma senza un allegato');

  // Il deposito rifiuta l'unico allegato di un feedback senza testo: non nasce una scheda vuota.
  await esito(app, 'vuoto');
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }]);
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(1);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-status')).toContainText('«foto.png»: rifiutato dal deposito', { timeout: 8_000 });
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await expect(page.locator('.sn-fb-send')).toBeEnabled();
  await expect(toast(page, 'inviato')).toHaveCount(0);
  await expect(toast(page, 'in partenza')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/1667-vuoto-non-parte.png' });
});

test('senza testo e con uno screenshot che non si può fare non parte niente: il riquadro lo dice e resta aperto', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await reteFinta(app);
  await page.evaluate(() => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => (m && m.type === 'capture_visible_tab' ? Promise.resolve({ ok: false }) : orig(m, ...r));
  });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-clear').click();
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-status')).toContainText('Screenshot non disponibile');
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  expect(await app.evaluate(() => globalThis.__rete.payload.length), 'nessun feedback vuoto è partito').toBe(0);
});

test('la schermata annotata di uno schermo grande scende sotto i 4 MB, coi tratti della pagina e della barra, e parte', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await reteFinta(app);
  // Lo scatto di uno schermo grande ad alta densità: rumore che un PNG non comprime, ben oltre i 4 MB.
  const pesoScatto = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = innerWidth * 2; c.height = innerHeight * 2;
    const cx = c.getContext('2d');
    const img = cx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.random() * 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = Math.random() * 255; img.data[i + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    const scatto = c.toDataURL('image/png');
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => (m && m.type === 'capture_visible_tab' ? Promise.resolve({ ok: true, dataUrl: scatto }) : orig(m, ...r));
    return window.SN_FEEDBACK.byteDiDataUrl(scatto);
  });
  expect(pesoScatto, 'lo scatto di partenza è davvero oltre il tetto').toBeGreaterThan(4 * 1024 * 1024);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  // Un tratto rosso lungo, in alto a sinistra, lontano dal riquadro.
  await page.mouse.move(100, 120);
  await page.mouse.down();
  for (let x = 110; x <= 400; x += 10) await page.mouse.move(x, 120);
  await page.mouse.up();
  // E uno sulla barra in alto, che vive nella shell: la schermata le mette una sopra l'altra.
  await expect(shell.locator('#feedback-draw')).toBeVisible({ timeout: 4_000 });
  const barra = await shell.locator('#feedback-draw').boundingBox();
  const yb = Math.min(15, (barra?.height || 40) / 2);
  await shell.mouse.move(160, yb);
  await shell.mouse.down();
  await shell.mouse.move(360, yb, { steps: 12 });
  await shell.mouse.up();
  await expect(page.locator('.sn-fb-clear')).toHaveText(/Cancella/, { timeout: 4_000 });
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 15_000 });
  await expect(toast(page, 'Grazie! Feedback inviato.')).toHaveCount(1);

  const immagine = await app.evaluate(() => globalThis.__rete.payload[0].images.map((i) => ({ name: i.name, dataUrl: i.dataUrl })));
  expect(immagine).toHaveLength(1);
  expect(immagine[0].name).toBe('schermata annotata');
  const verifica = await page.evaluate(async (u) => {
    const im = new Image();
    im.src = u;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const cx = c.getContext('2d');
    cx.drawImage(im, 0, 0);
    const k = im.naturalWidth / innerWidth;
    const barH = Math.round(im.naturalHeight - innerHeight * k);
    const [r, g, b] = cx.getImageData(Math.round(250 * k), barH + Math.round(120 * k), 1, 1).data;
    const fascia = cx.getImageData(0, 0, im.naturalWidth, Math.max(1, barH)).data;
    let rossiInBarra = 0;
    for (let i = 0; i < fascia.length; i += 4) if (fascia[i] > 200 && fascia[i + 1] < 90 && fascia[i + 2] < 90) rossiInBarra++;
    return { byte: window.SN_FEEDBACK.byteDiDataUrl(u), w: im.naturalWidth, barH, r, g, b, rossiInBarra };
  }, immagine[0].dataUrl);
  expect(verifica.byte, 'sotto il tetto del deposito').toBeLessThan(4 * 1024 * 1024);
  expect(verifica.w).toBeGreaterThan(0);
  expect(verifica.r, 'il tratto rosso sulla pagina c’è ancora').toBeGreaterThan(170);
  expect(verifica.g).toBeLessThan(110);
  expect(verifica.barH, 'la barra in alto sta sopra la pagina').toBeGreaterThan(0);
  expect(verifica.rossiInBarra, 'col suo tratto').toBeGreaterThan(0);
});

// #1681 — chi riapre il riquadro mentre l'invio aspetta (dal #1403 si chiude da sé all'invio) e scrive altro: la
// consegna del primo non chiude il riquadro nuovo, non ne cancella la bozza e non gli ripropone il testo in viaggio.
test('la consegna di un feedback partito non chiude il riquadro riaperto per scriverne un altro', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await reteFinta(app);
  await esito(app, 'lento');
  await scriviEInvia(page, 'Il tasto Salva non risponde');
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
  await expect.poll(() => app.evaluate(() => typeof globalThis.__rete.sblocca), { timeout: 12_000 }).toBe('function');
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator('.sn-fb-text'), 'il testo in viaggio non torna come bozza').toHaveValue('');
  await page.locator('.sn-fb-text').fill('Secondo problema: la barra sparisce');
  await page.waitForTimeout(800);

  await app.evaluate(() => globalThis.__rete.sblocca());
  await expect(toast(page, 'Grazie! Feedback inviato.')).toHaveCount(1, { timeout: 8_000 });
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await expect(page.locator('.sn-fb-text')).toHaveValue('Secondo problema: la barra sparisce');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-text')).toHaveValue('Secondo problema: la barra sparisce');
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('un allegato lasciato fuori dal riquadro si dice col suo nome e il motivo, anche in mezzo a uno entrato', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-file').setInputFiles([
    { name: 'registro-enorme.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024, 65) },
    { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('ciao') },
  ]);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  await expect(page.locator('.sn-fb-status')).toHaveText('Non allegato «registro-enorme.pdf»: troppo grande (max 4 MB).');
  // Oltre le cinque immagini: si nominano quelle rimaste fuori.
  await page.locator('.sn-fb-file').setInputFiles([1, 2, 3, 4, 5, 6, 7].map((i) => ({ name: `foto${i}.png`, mimeType: 'image/png', buffer: PNG })));
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(5);
  await expect(page.locator('.sn-fb-status')).toContainText('Non allegati «foto6.png»: oltre le 5 immagini ammesse; «foto7.png»');
  await page.screenshot({ path: 'tests/.shots/1681-allegati-fuori.png' });
});

test('con cinque immagini la schermata chiesta che non ci sta non resta fuori in silenzio: l’avviso d’invio lo dice', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await reteFinta(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-file').setInputFiles([1, 2, 3, 4, 5].map((i) => ({ name: `foto${i}.png`, mimeType: 'image/png', buffer: PNG })));
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(5);
  await page.locator('.sn-fb-text').fill('Guarda lo schermo');
  await page.locator('.sn-fb-clear').click();
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 15_000 });
  await expect(toast(page, 'La schermata annotata non è partita: c\'erano già 5 immagini')).toHaveCount(1);
  const nomi = await app.evaluate(() => globalThis.__rete.payload[0].images.map((i) => i.name));
  expect(nomi).toEqual(['foto1.png', 'foto2.png', 'foto3.png', 'foto4.png', 'foto5.png']);
});

test('il feedback vuoto che non parte lo dice il riquadro aperto, senza un secondo avviso nella finestra né una voce vuota fra le mie', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // La spedizione vera: finta è solo la rete, dove il deposito rifiuta e il resto non risponde.
  await app.evaluate(() => {
    globalThis.fetch = async (u) => {
      if (/firebasestorage/.test(String(u))) return new Response('no', { status: 403 });
      throw new Error('fetch failed');
    };
  });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'foto.png', mimeType: 'image/png', buffer: PNG }]);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-status')).toContainText('«foto.png»: rifiutato dal deposito', { timeout: 10_000 });
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(shell.locator('.shell-notif').filter({ hasText: 'non è partito' })).toHaveCount(0);
  expect(await app.evaluate(async () => (await globalThis.SN_SEGNALAZIONI_MIE.elenco()).length)).toBe(0);
});
