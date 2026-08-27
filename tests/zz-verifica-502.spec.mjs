// VERIFICA #502 (temporaneo, del verificatore — non va tenuto nel ramo).
// Parte dal sintomo: "seleziono in basso, chiedo la spiegazione approfondita,
// la risposta arriva e la riga per scrivere finisce fuori dallo schermo".
// Qui provo a romperlo su strade che lo spec del ramo non batte:
//  - la SECONDA strada nominata dall'utente (la freccetta nel menu del tasto destro);
//  - il turno successivo (la domanda di follow-up), che rialza il riquadro;
//  - una domanda di 10.000 caratteri nella casella;
//  - una risposta che arriva TUTTA IN UN COLPO;
//  - errore del provider;
//  - apri/chiudi ripetuto e due riquadri insieme;
//  - i numeri esatti della segnalazione (finestra alta 800, selezione a 3/4).

import { test, expect } from './fixtures/electron.mjs';

async function provider(app, { attesa = 300, pezzi = null, errore = false, unicoBlocco = false } = {}) {
  await app.evaluate(async (_e, o) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3', [C.ACTIONS.EXPLAIN]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const chunks = o.pezzi || Array.from({ length: 14 }, (_, i) =>
      `Paragrafo ${i + 1}: una spiegazione distesa e prolissa della parola selezionata. `);
    globalThis.__origGemV = globalThis.__origGemV || globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__origGemV,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, o.attesa));
        if (o.errore) throw new Error('provider esploso');
        if (o.unicoBlocco) { onDelta(chunks.join('')); return { text: chunks.join(''), usage: {} }; }
        for (const p of chunks) { onDelta(p); await new Promise((r) => setTimeout(r, 30)); }
        return { text: chunks.join(''), usage: {} };
      },
      complete: async () => {
        await new Promise((r) => setTimeout(r, o.attesa));
        if (o.errore) throw new Error('provider esploso');
        return { text: chunks.join(''), usage: {} };
      },
    };
  }, { attesa, pezzi, errore, unicoBlocco });
}

const attendiIngresso = async (page) => {
  await page.evaluate(async () => {
    for (const root of document.querySelectorAll('.sn-popup')) {
      if (!root.getAnimations) continue;
      await Promise.all(root.getAnimations().map((a) => a.finished.catch(() => {})));
    }
  });
};

// Misura TUTTI i riquadri aperti.
const misuraTutti = () => Array.from(document.querySelectorAll('.sn-popup')).map((root) => {
  const input = root.querySelector('.sn-popup-input');
  const send = root.querySelector('.sn-popup-send');
  const head = root.querySelector('.sn-popup-header');
  const r = root.getBoundingClientRect();
  const i = input.getBoundingClientRect();
  const s = send.getBoundingClientRect();
  const h = head.getBoundingClientRect();
  const el = document.elementFromPoint(i.left + i.width / 2, i.top + i.height / 2);
  const el2 = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
  return {
    vh: window.innerHeight, vw: window.innerWidth,
    top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
    inputTop: i.top, inputBottom: i.bottom,
    sendRight: s.right, sendBottom: s.bottom,
    headTop: h.top, headBottom: h.bottom,
    cassettaCliccabile: !!el && (el === input || input.contains(el)),
    inviaCliccabile: !!el2 && (el2 === send || send.contains(el2)),
  };
});

const fuori = (m) => {
  const e = [];
  if (m.bottom > m.vh + 1) e.push(`fondo fuori di ${Math.round(m.bottom - m.vh)}px (vh=${m.vh})`);
  if (m.top < -1) e.push(`cima fuori di ${Math.round(-m.top)}px`);
  if (m.right > m.vw + 1) e.push(`destra fuori di ${Math.round(m.right - m.vw)}px`);
  if (m.left < -1) e.push(`sinistra fuori di ${Math.round(-m.left)}px`);
  if (m.inputBottom > m.vh + 1) e.push(`riga per scrivere sotto il bordo di ${Math.round(m.inputBottom - m.vh)}px`);
  if (m.inputTop < -1) e.push(`riga per scrivere sopra il bordo di ${Math.round(-m.inputTop)}px`);
  if (m.headTop < -1) e.push(`intestazione sopra il bordo di ${Math.round(-m.headTop)}px`);
  if (!m.cassettaCliccabile) e.push('la casella di testo NON si clicca');
  if (!m.inviaCliccabile) e.push('il tasto di invio NON si clicca');
  return e;
};

async function apri(page, frazione = 0.75) {
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate((f) => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * f) },
      title: 'Approfondisci',
    });
  }, frazione);
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
}

const finito = (page) => expect(page.locator('.sn-popup .sn-popup-meta').last()).toContainText('€', { timeout: 25_000 });

// ── 1. I NUMERI ESATTI DELLA SEGNALAZIONE ────────────────────────────────────
test('#502 numeri della segnalazione: finestra 800px, selezione a 3/4, risposta finita', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 800 });
  await provider(app, { attesa: 1500 });
  await apri(page, 0.75);
  await attendiIngresso(page);
  const vuoto = (await page.evaluate(misuraTutti))[0];
  expect(vuoto.height, 'la risposta è arrivata prima della misura da vuoto').toBeLessThan(350);

  await finito(page);
  await attendiIngresso(page);
  const m = (await page.evaluate(misuraTutti))[0];
  expect(m.vh).toBe(800);
  expect(fuori(m), `posa finale sbagliata: ${JSON.stringify(m)}`).toEqual([]);
  // E la domanda successiva si scrive davvero.
  await page.locator('.sn-popup .sn-popup-input').click();
  await page.locator('.sn-popup .sn-popup-input').fill('e adesso?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e adesso?');
});

// ── 2. LA SECONDA STRADA: la freccetta nel menu del tasto destro ─────────────
const PAGINA = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif}
#riempi{height:300vh;padding:20px}
#bersaglio{position:fixed;left:40px;top:78vh;font-size:20px}</style>
<div id="riempi">contorno</div><p id="bersaglio">supercalifragilistico</p>`;

test('#502 strada gemella: la freccetta dentro al riquadro del tasto destro', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await provider(app, { attesa: 1200 });

  await page.locator('#bersaglio').dblclick();
  await expect.poll(() => page.evaluate(() => String(window.getSelection())), { timeout: 5000 })
    .toContain('supercalifragilistico');

  // Tasto destro sulla selezione: il menu si apre con la sezione "Spiega".
  await page.locator('#bersaglio').click({ button: 'right' });
  const freccia = page.locator('.sn-menu-inline-arrow');
  await expect(freccia, 'la freccetta della spiegazione approfondita non compare nel menu del tasto destro').toBeVisible({ timeout: 15_000 });
  await freccia.click();

  await page.waitForSelector('.sn-popup', { timeout: 10_000 });
  await attendiIngresso(page);
  const vuoto = (await page.evaluate(misuraTutti))[0];
  expect(fuori(vuoto), `da vuoto (freccetta): ${JSON.stringify(vuoto)}`).toEqual([]);

  // Campiona mentre cresce.
  const brutti = [];
  const finoA = Date.now() + 20_000;
  while (Date.now() < finoA) {
    const ms = await page.evaluate(misuraTutti);
    if (!ms.length) break;
    const e = fuori(ms[0]);
    if (e.length) brutti.push({ e, m: ms[0] });
    const t = await page.locator('.sn-popup .sn-popup-meta').textContent().catch(() => '');
    if (t && t.includes('€')) break;
    await page.waitForTimeout(60);
  }
  await finito(page);
  await attendiIngresso(page);
  const m = (await page.evaluate(misuraTutti))[0];
  expect(fuori(m), `posa finale dalla freccetta: ${JSON.stringify(m)}`).toEqual([]);
  expect(brutti, `sbordi durante lo streaming dalla freccetta: ${JSON.stringify(brutti.slice(0, 2))}`).toEqual([]);
  try { await page.screenshot({ path: 'tests/.shots/v502-freccetta.png' }); } catch (_) {}
});

// ── 3. IL TURNO SUCCESSIVO: la domanda di follow-up rialza il riquadro ───────
test('#502 domanda successiva: il riquadro cresce di due bolle e resta usabile', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 700 });
  await provider(app, { attesa: 300 });
  await apri(page, 0.8);
  await finito(page);
  await attendiIngresso(page);
  const dopo1 = (await page.evaluate(misuraTutti))[0];
  expect(fuori(dopo1), `dopo il primo turno: ${JSON.stringify(dopo1)}`).toEqual([]);

  // Secondo turno, come lo farebbe l'utente.
  await page.locator('.sn-popup .sn-popup-input').click();
  await page.locator('.sn-popup .sn-popup-input').fill('e in parole povere?');
  await page.locator('.sn-popup .sn-popup-send').click();
  await expect(page.locator('.sn-popup .sn-msg-assistant')).toHaveCount(2, { timeout: 25_000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 25_000 });
  await attendiIngresso(page);
  const dopo2 = (await page.evaluate(misuraTutti))[0];
  expect(fuori(dopo2), `dopo il secondo turno: ${JSON.stringify(dopo2)}`).toEqual([]);
  // Terzo turno: si può continuare.
  await page.locator('.sn-popup .sn-popup-input').fill('ancora');
  await page.locator('.sn-popup .sn-popup-send').click();
  await expect(page.locator('.sn-popup .sn-msg-assistant')).toHaveCount(3, { timeout: 25_000 });
  await attendiIngresso(page);
  const dopo3 = (await page.evaluate(misuraTutti))[0];
  expect(fuori(dopo3), `dopo il terzo turno: ${JSON.stringify(dopo3)}`).toEqual([]);
});

// ── 4. DOMANDA DI 10.000 CARATTERI (la casella si allarga fino al suo tetto) ──
test('#502 domanda di 10.000 caratteri: la casella cresce e non spinge nulla fuori', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 620 });
  await provider(app, { attesa: 300 });
  await apri(page, 0.85);
  await finito(page);
  await attendiIngresso(page);

  await page.evaluate(() => {
    const i = document.querySelector('.sn-popup .sn-popup-input');
    i.value = 'a'.repeat(10_000);
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const m = (await page.evaluate(misuraTutti))[0];
  expect(fuori(m), `con la casella piena di 10.000 caratteri: ${JSON.stringify(m)}`).toEqual([]);

  // Solo spazi, e poi vuota: nessuno dei due deve spostare niente.
  await page.evaluate(() => {
    const i = document.querySelector('.sn-popup .sn-popup-input');
    i.value = '   '; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  expect(fuori((await page.evaluate(misuraTutti))[0])).toEqual([]);
  try { await page.screenshot({ path: 'tests/.shots/v502-10k.png' }); } catch (_) {}
});

// ── 5. RISPOSTA TUTTA IN UN COLPO + testo lunghissimo senza spazi ────────────
test('#502 risposta in un solo blocco da 12.000 caratteri: nessun salto fuori', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 720 });
  await provider(app, {
    attesa: 800, unicoBlocco: true,
    pezzi: ['x'.repeat(6000), ' ', 'parola '.repeat(900)],
  });
  await apri(page, 0.9);
  await attendiIngresso(page);
  expect(fuori((await page.evaluate(misuraTutti))[0])).toEqual([]);
  await finito(page);
  await attendiIngresso(page);
  const m = (await page.evaluate(misuraTutti))[0];
  expect(fuori(m), `dopo il blocco unico: ${JSON.stringify(m)}`).toEqual([]);
});

// ── 6. ERRORE DEL PROVIDER ───────────────────────────────────────────────────
test('#502 il provider fallisce: il riquadro resta dentro e la casella si clicca', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 640 });
  await provider(app, { attesa: 300, errore: true });
  await apri(page, 0.88);
  await expect(page.locator('.sn-popup .sn-msg-error')).toBeVisible({ timeout: 25_000 });
  await attendiIngresso(page);
  const m = (await page.evaluate(misuraTutti))[0];
  expect(fuori(m), `dopo l'errore: ${JSON.stringify(m)}`).toEqual([]);
});

// ── 7. APRI/CHIUDI RIPETUTO, POI DUE RIQUADRI INSIEME ────────────────────────
test('#502 apri/chiudi ripetuto e due riquadri insieme: tutti dentro lo schermo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 700 });
  await provider(app, { attesa: 200 });

  for (let i = 0; i < 8; i++) {
    await apri(page, 0.8);
    await page.evaluate(() => window.SN_POPUP.closeTopmost && window.SN_POPUP.closeTopmost());
  }
  await page.evaluate(() => { document.querySelectorAll('.sn-popup').forEach((n) => n.remove()); });

  // Due riquadri, ancorati in due punti bassi diversi.
  await apri(page, 0.8);
  await apri(page, 0.95);
  await page.waitForTimeout(500);
  await expect(page.locator('.sn-popup')).toHaveCount(2);
  await finito(page);
  await page.waitForTimeout(800);
  await attendiIngresso(page);
  const ms = await page.evaluate(misuraTutti);
  ms.forEach((m, i) => expect(fuori(m), `riquadro ${i}: ${JSON.stringify(m)}`).toEqual([]));
  try { await page.screenshot({ path: 'tests/.shots/v502-due.png' }); } catch (_) {}
});

// ── 8. TEMA CHIARO E TEMA SCURO (traccia visiva) ─────────────────────────────
for (const tema of ['light', 'dark']) {
  test(`#502 traccia visiva tema ${tema}`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab('filo://newtab/');
    const w = await page.evaluate(() => window.innerWidth);
    await page.setViewportSize({ width: w, height: 800 });
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await provider(app, { attesa: 300 });
    await apri(page, 0.75);
    await finito(page);
    await attendiIngresso(page);
    const m = (await page.evaluate(misuraTutti))[0];
    expect(fuori(m)).toEqual([]);
    try { await page.screenshot({ path: `tests/.shots/v502-tema-${tema}.png` }); } catch (_) {}
  });
}

// ── 9. HTML/SCRIPT NELLA RISPOSTA (il corpo usa innerHTML) ───────────────────
test('#502 risposta con HTML ostile: niente esecuzione, e la posa regge', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 700 });
  await page.evaluate(() => { window.__bum = 0; });
  await provider(app, {
    attesa: 300,
    pezzi: [
      '<img src=x onerror="window.__bum=1">',
      '<script>window.__bum=2<\/script>',
      '<a href="javascript:window.__bum=3">clicca</a> ',
      'testo lungo di riempimento. '.repeat(200),
    ],
  });
  await apri(page, 0.8);
  await finito(page);
  await page.waitForTimeout(600);
  const bum = await page.evaluate(() => window.__bum);
  expect(bum, 'la risposta del modello ha eseguito codice nella pagina').toBe(0);
  const jsLink = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sn-popup a')).some((a) => /^javascript:/i.test(a.getAttribute('href') || '')));
  expect(jsLink, 'link javascript: sopravvissuto nel corpo della risposta').toBe(false);
  await attendiIngresso(page);
  const m = (await page.evaluate(misuraTutti))[0];
  expect(fuori(m), `con HTML ostile: ${JSON.stringify(m)}`).toEqual([]);
});

// ── 10. RISPOSTA VUOTA (stato vuoto) ─────────────────────────────────────────
test('#502 risposta vuota: il riquadro resta posato e la casella si clicca', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 600 });
  await provider(app, { attesa: 300, pezzi: [''] });
  await apri(page, 0.92);
  await finito(page);
  await attendiIngresso(page);
  const m = (await page.evaluate(misuraTutti))[0];
  expect(fuori(m), `con risposta vuota: ${JSON.stringify(m)}`).toEqual([]);
});
