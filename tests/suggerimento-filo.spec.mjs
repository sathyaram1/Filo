// #2095 — «in diversi punti l'hover segue uno stile non Filo (rettangolo bianco con il nome)», e mancano hover dove non
// c'è motivo che manchino. Ogni title delle pagine di Filo esce nel fumetto di Filo (src/shared/suggerimento.js): durante
// il passaggio il title non c'è (Chromium non ha niente da mostrare), all'uscita torna; Esc e clic lo chiudono; il \n va
// a capo. Più gli hover che mancavano: invio, crocette, immagini, Aiuto, riquadro.

import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';

const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');
const haTitolo = (loc) => loc.evaluate((el) => el.hasAttribute('title'));

async function pronta(page) {
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && !!window.SN_SUGGERIMENTO,
    null, { timeout: 15_000 });
}

// Il primo pezzo col title che si vede davvero (niente sopra di lui), marcato per ritrovarlo.
async function unTitoloVisibile(page) {
  const titolo = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[title]')) {
      const t = (el.getAttribute('title') || '').trim();
      if (!t || el.tagName === 'IFRAME') continue;
      let r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.top < 0 || r.bottom > innerHeight) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); r = el.getBoundingClientRect(); }
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
      const sopra = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!sopra || !(sopra === el || el.contains(sopra))) continue;
      if (sopra !== el && sopra.closest('[title],[data-tip]') !== el) continue;
      el.setAttribute('data-prova-fumetto', '');
      return t;
    }
    return null;
  });
  expect(titolo, 'nessun pezzo con un title visibile nella pagina').not.toBeNull();
  return { el: page.locator('[data-prova-fumetto]'), titolo };
}

async function provaUnTitolo(page) {
  const { el, titolo } = await unTitoloVisibile(page);
  await el.hover();
  await expect(fumetto(page)).toBeVisible();
  await expect(fumetto(page)).toHaveText(titolo);
  expect(await haTitolo(el), 'durante il passaggio il title nativo non deve esserci').toBe(false);
  // Il fumetto sta accanto al pezzo, non in un angolo.
  const [b, f] = [await el.boundingBox(), await fumetto(page).boundingBox()];
  expect(Math.abs((f.y + f.height / 2) - (b.y + b.height / 2))).toBeLessThan(b.height / 2 + f.height + 20);
  // Esc lo chiude e non torna finché il puntatore resta lì.
  await page.keyboard.press('Escape');
  await expect(fumetto(page)).toBeHidden();
  await page.mouse.move(1, 1);
  await expect.poll(() => haTitolo(el)).toBe(true);
  // Rientrato torna; il clic lo chiude e il title è di nuovo al suo posto.
  await el.hover();
  await expect(fumetto(page)).toHaveText(titolo);
  await page.mouse.down();
  await expect(fumetto(page)).toBeHidden();
  expect(await haTitolo(el)).toBe(true);
  await page.mouse.up();
  await page.mouse.move(1, 1);
  return titolo;
}

test('home: il title di un tasto esce nel fumetto di Filo, senza il rettangolo nativo', async ({ openTab }) => {
  const home = await openTab('filo://newtab/');
  await pronta(home);
  const invio = home.locator('#sendBtn');
  await expect(invio).toHaveAttribute('title', 'Invia');
  await invio.hover();
  await expect(fumetto(home)).toHaveText('Invia');
  expect(await haTitolo(invio)).toBe(false);
  // Colori del fumetto della barra, non quelli del sistema.
  const colori = await fumetto(home).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(colori).toBe('rgb(253, 246, 236)');
  await home.screenshot({ path: 'tests/.shots/2095-home-invia.png' });
  await home.mouse.move(1, 1);
  await expect(fumetto(home)).toBeHidden();
  await expect.poll(() => haTitolo(invio)).toBe(true);
  await provaUnTitolo(home);
});

test('Preferenze: title, testo su più righe, tasto disabilitato e fuoco da tastiera', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await pronta(page);
  await provaUnTitolo(page);

  await page.evaluate(() => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:40px;top:40px;z-index:2147480000;display:flex;gap:8px';
    box.innerHTML = '<button id="pAcapo" title="Prima riga\nSeconda riga">A</button>'
      + '<button id="pSpento" disabled title="Spento perché manca la chiave">B</button>'
      + '<button id="pPrima">C</button><button id="pTasto" title="Da tastiera">D</button>';
    document.body.appendChild(box);
  });
  await page.locator('#pAcapo').hover();
  await expect(fumetto(page)).toBeVisible();
  const righe = await fumetto(page).evaluate((el) => el.innerText.split('\n'));
  expect(righe).toEqual(['Prima riga', 'Seconda riga']);
  const alto = (await fumetto(page).boundingBox()).height;
  await page.screenshot({ path: 'tests/.shots/2095-preferenze-a-capo.png' });

  await page.locator('#pSpento').hover({ force: true });
  await expect(fumetto(page)).toHaveText('Spento perché manca la chiave');
  expect((await fumetto(page).boundingBox()).height).toBeLessThan(alto);
  expect(await haTitolo(page.locator('#pSpento'))).toBe(false);
  await page.mouse.move(1, 300);
  await expect(fumetto(page)).toBeHidden();
  await expect.poll(() => haTitolo(page.locator('#pSpento'))).toBe(true);

  await page.locator('#pPrima').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#pTasto')).toBeFocused();
  await expect(fumetto(page)).toHaveText('Da tastiera');
  await page.locator('#pPrima').evaluate((el) => el.blur());
  await page.locator('#pTasto').evaluate((el) => el.blur());
  await expect(fumetto(page)).toBeHidden();
});

test('Preferenze → Avanzate: colori e attesa del fumetto sono token, e valgono anche nelle altre schede', async ({ openTab }) => {
  const home = await openTab('filo://newtab/');
  await pronta(home);
  const pref = await openTab('filo://preferences/preferences.html');
  await pronta(pref);
  await pref.locator('[id="tok-fumetto.sfondo"]').fill('#203040');
  await pref.locator('[id="tok-fumetto.ritardo"]').fill('1500ms');
  await expect.poll(() => home.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sn-fumetto-ritardo').trim()))
    .toBe('1500ms');
  const nuova = await openTab('filo://newtab/');
  await pronta(nuova);
  await nuova.locator('#sendBtn').hover();
  // L'attesa è quella scelta: a 700 ms non c'è ancora, poi compare.
  await nuova.waitForTimeout(700);
  await expect(fumetto(nuova)).toBeHidden();
  await expect(fumetto(nuova)).toHaveText('Invia', { timeout: 3000 });
  expect(await fumetto(nuova).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(32, 48, 64)');
  await pref.locator('.sn-token-row[data-token="fumetto.sfondo"] .sn-token-reset').click();
  await pref.locator('.sn-token-row[data-token="fumetto.ritardo"] .sn-token-reset').click();
});

test('Gestione: anche le pagine dell\'owner escono nel fumetto', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await pronta(page);
  await provaUnTitolo(page);
});

// Le foto vere, fatte da un canvas e incollate come dagli appunti.
async function incollaFoto(home) {
  await home.evaluate(async () => {
    const dt = new DataTransfer();
    const cv = new OffscreenCanvas(16, 16);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#c45a3b';
    ctx.fillRect(0, 0, 16, 16);
    dt.items.add(new File([await cv.convertToBlob({ type: 'image/png' })], 'foto.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(home.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5000 });
}

test('home: la crocetta e l\'immagine incollata hanno il loro fumetto', async ({ openTab }) => {
  const home = await openTab('filo://newtab/');
  await pronta(home);
  await incollaFoto(home);
  await home.locator('#imgPreviews .dash-img-preview img').hover();
  await expect(fumetto(home)).toHaveText('Ingrandisci');
  await home.locator('#imgPreviews .dash-img-remove').hover({ force: true });
  await expect(fumetto(home)).toHaveText('Togli');
});

test('Aiuto e riquadro: le crocette, l\'invio e la freccia hanno il loro fumetto', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      onDelta('Una risposta breve.');
      return { text: 'Una risposta breve.', usage: {}, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider };
    };
  });
  const page = await openTab('filo://preferences/preferences.html');
  await pronta(page);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const aiuto = page.locator('.sn-sidebar');
  await expect(aiuto).toBeVisible();
  await aiuto.locator('.sn-sidebar-close').hover();
  await expect(fumetto(page)).toHaveText('Chiudi');
  await aiuto.locator('.sn-sidebar-input button[type="submit"]').hover();
  await expect(fumetto(page)).toHaveText('Invia');
  await page.evaluate(() => window.SN_SIDEBAR.close());

  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
    anchor: { x: 160, y: 200 },
    title: 'Approfondisci',
  }));
  const riquadro = page.locator('.sn-popup').first();
  await expect(riquadro).toContainText('Una risposta breve.', { timeout: 8000 });
  await riquadro.locator('.sn-popup-close').hover();
  await expect(fumetto(page)).toHaveText('Chiudi');
  await riquadro.locator('.sn-popup-send').hover({ force: true });
  await expect(fumetto(page)).toHaveText('Invia');
});

test('home: la X del ringraziamento per un feedback risolto e quella delle Novità hanno il loro fumetto', async ({ app }) => {
  const page = await aspettaFinestra(app, (w) => w.url().startsWith('filo://newtab'), 'la home dell\'avvio non è nata');
  await page.waitForFunction(() => window.__filoDashActions && window.__filoDashActions.ricompenseAvvio, null, { timeout: 0 });
  await page.evaluate(() => window.__filoDashActions.ricompenseAvvio());
  await app.evaluate(async () => {
    const K = globalThis.SN_CONST.STORAGE_KEYS;
    await globalThis.SN_STORAGE.setRaw(K.LAST_SEEN_VERSION, '0.2.200');
    await globalThis.SN_STORAGE.setRaw(K.LAST_SEEN_NOTES, null);
  });
  await page.reload();
  const x = page.locator('.dash-recap-x').first();
  await expect(x).toBeVisible({ timeout: 10_000 });
  await x.hover();
  await expect(fumetto(page)).toHaveText('Chiudi');
  await page.screenshot({ path: 'tests/.shots/2095-novita-x.png' });
});
