// #502 — casi limite della posa del riquadro della spiegazione approfondita.
// Nato come banco di prova avversariale (prova a ROMPERE la posa invece di
// confermarla) e tenuto qui perché quegli angoli sono esattamente quelli in cui
// il difetto è tornato fuori tre volte: la strada del tasto destro, il secondo
// turno, il contenuto ostile, la raffica. Lo scenario centrale — la domanda
// successiva che allunga la riga per scrivere — sta in
// `popup-pose-streaming.spec.mjs` insieme al resto della posa.
//
//  1. la domanda lunga nella riga per scrivere (la casella cresce fino a 120px)
//     e poi cancellata: il riquadro deve tornare alto com'era, non restare
//     schiacciato;
//  2. la strada del TASTO DESTRO (la freccetta dentro il riquadro), che il
//     feedback nomina alla pari di Alt+E;
//  3. il secondo turno (domanda inviata, seconda risposta in streaming);
//  4. risposta ostile: parola lunghissima senza spazi, emoji, HTML;
//  5. aperture/chiusure a raffica e due riquadri insieme;
//  6. risposta vuota ed errore del provider.

import { test, expect } from './fixtures/electron.mjs';

async function preparaProvider(app, attesaMs = 300, opts = {}) {
  await app.evaluate(async (_electron, o) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = o.pezzi || Array.from({ length: 12 }, (_, i) =>
      `Paragrafo ${i + 1}: una spiegazione distesa della parola selezionata, con abbastanza testo da far crescere il riquadro fino al suo tetto di altezza. `);
    if (!globalThis.__origGemVer) globalThis.__origGemVer = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origGemVer,
      streamComplete: async ({ onDelta }) => {
        if (o.errore) throw new Error('boom provider');
        await new Promise((r) => setTimeout(r, o.attesa));
        for (const p of pezzi) {
          onDelta(p);
          await new Promise((r) => setTimeout(r, 20));
        }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  }, { attesa: attesaMs, ...opts });
}

async function ripristinaProvider(app) {
  await app.evaluate(() => {
    if (globalThis.__origGemVer) globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origGemVer;
  });
}

const attendiIngresso = async (page) => {
  await page.evaluate(async () => {
    const root = document.querySelector('.sn-popup');
    if (!root?.getAnimations) return;
    await Promise.all(root.getAnimations().map((a) => a.finished.catch(() => {})));
  });
};

const misura = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return null;
  const input = root.querySelector('.sn-popup-input');
  const send = root.querySelector('.sn-popup-send');
  const compose = root.querySelector('.sn-popup-compose');
  const body = root.querySelector('.sn-popup-body');
  const r = root.getBoundingClientRect();
  const i = input.getBoundingClientRect();
  const s = send ? send.getBoundingClientRect() : null;
  const c = compose ? compose.getBoundingClientRect() : null;
  const b = body ? body.getBoundingClientRect() : null;
  return {
    vh: window.innerHeight, vw: window.innerWidth,
    top: r.top, bottom: r.bottom, left: r.left, right: r.right,
    height: r.height, width: r.width,
    inputTop: i.top, inputBottom: i.bottom,
    sendRight: s ? s.right : 0,
    composeBottom: c ? c.bottom : 0,
    bodyH: b ? b.height : 0,
    scrollW: root.scrollWidth,
  };
};

const fuoriDaiBordi = (m) => {
  if (!m) return ['riquadro sparito'];
  const f = [];
  if (m.composeBottom > m.bottom + 1) f.push(`riga per scrivere oltre il bordo del riquadro di ${Math.round(m.composeBottom - m.bottom)}px`);
  if (m.bottom > m.vh + 1) f.push(`fondo oltre il bordo di ${Math.round(m.bottom - m.vh)}px (vh=${m.vh})`);
  if (m.top < -1) f.push(`cima oltre il bordo di ${Math.round(-m.top)}px`);
  if (m.inputBottom > m.vh) f.push(`riga per scrivere sotto il bordo di ${Math.round(m.inputBottom - m.vh)}px`);
  if (m.inputTop < 0) f.push(`riga per scrivere sopra il bordo di ${Math.round(-m.inputTop)}px`);
  if (m.right > m.vw + 1) f.push(`destra oltre il bordo di ${Math.round(m.right - m.vw)}px (vw=${m.vw})`);
  if (m.left < -1) f.push(`sinistra oltre il bordo di ${Math.round(-m.left)}px`);
  if (m.sendRight > m.vw + 1) f.push(`tasto di invio oltre il bordo destro di ${Math.round(m.sendRight - m.vw)}px`);
  return f;
};

const casellaCliccabile = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return false;
  const input = root.querySelector('.sn-popup-input');
  const r = input.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!el && (el === input || input.contains(el));
};

async function riquadroPosato(app, page, frazione = 0.75) {
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );
  await page.evaluate((f) => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * f) },
      title: 'Approfondisci',
    });
  }, frazione);
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await attendiIngresso(page);
  return page.evaluate(misura);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. La domanda successiva è LUNGA: la casella per scriverla cresce (fino a
//    120px) e alza il riquadro dal basso, esattamente come faceva la risposta.
//    E quando l'utente la cancella — o la manda — lo spazio torna: il riquadro
//    deve tornare alto com'era, non restare schiacciato con la risposta in una
//    striscia.
// ─────────────────────────────────────────────────────────────────────────────
test('domanda lunga nella riga per scrivere: niente esce, e cancellandola il riquadro torna alto com\'era', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaProvider(app);
  const prima = await riquadroPosato(app, page);
  expect(fuoriDaiBordi(prima)).toEqual([]);

  const input = page.locator('.sn-popup .sn-popup-input');
  await input.click();
  // Una domanda vera ma lunga: la casella si allarga fino al suo tetto.
  await input.fill('perché questa cosa funziona così e non in un altro modo? '.repeat(12));
  await expect.poll(
    async () => (await page.evaluate(() => document.querySelector('.sn-popup .sn-popup-input').getBoundingClientRect().height)),
    { timeout: 5000, message: 'la casella non è cresciuta: lo scenario non è quello vero' },
  ).toBeGreaterThan(60);

  const conDomanda = await page.evaluate(misura);
  expect(fuoriDaiBordi(conDomanda), 'con la domanda lunga il riquadro esce').toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);

  // Ora la cancella. Lo spazio è tornato: la risposta deve tornare leggibile.
  await input.fill('');
  await expect.poll(
    async () => (await page.evaluate(misura)).height,
    { timeout: 5000, message: 'cancellata la domanda, il riquadro è rimasto schiacciato' },
  ).toBeGreaterThan(prima.height - 3);

  await ripristinaProvider(app);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. La strada del TASTO DESTRO. Il feedback la nomina alla pari di Alt+E
//    («la freccetta dentro al riquadro del tasto destro»): due strade
//    equivalenti devono fare la stessa cosa.
// ─────────────────────────────────────────────────────────────────────────────
const PAGINA = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  #riempitivo { height: 300vh; padding: 20px; }
  #bersaglio { position: fixed; left: 40px; top: 75vh; font-size: 20px; }
</style>
<div id="riempitivo">Testo di contorno.</div>
<p id="bersaglio">supercalifragilistico</p>`;

test('freccetta del tasto destro su una parola in basso: stessa posa della scorciatoia', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await preparaProvider(app);

  await page.locator('#bersaglio').dblclick();
  await expect.poll(() => page.evaluate(() => String(window.getSelection())), { timeout: 5000 })
    .toContain('supercalifragilistico');

  // Tasto destro sulla parola: il menu contestuale di Filo con la sezione
  // "Spiega" e la freccetta dell'approfondimento.
  await page.locator('#bersaglio').click({ button: 'right' });
  const freccia = page.locator('.sn-menu-inline-arrow');
  await expect(freccia).toBeVisible({ timeout: 10_000 });
  await freccia.click();

  await page.waitForSelector('.sn-popup', { timeout: 10_000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 25_000 });
  await attendiIngresso(page);

  const m = await page.evaluate(misura);
  expect(fuoriDaiBordi(m), 'dalla freccetta del tasto destro il riquadro esce dallo schermo').toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);
  await page.locator('.sn-popup .sn-popup-input').fill('e adesso?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e adesso?');

  try { await page.screenshot({ path: 'tests/.shots/zz502-tasto-destro.png' }); } catch (_) {}
  await ripristinaProvider(app);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Secondo turno: la domanda inviata aggiunge la bolla dell'utente e una
//    seconda risposta in streaming. Il riquadro cresce di nuovo, dopo essere
//    già stato posato.
// ─────────────────────────────────────────────────────────────────────────────
test('seconda domanda inviata: la conversazione continua senza uscire dallo schermo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaProvider(app);
  const prima = await riquadroPosato(app, page);
  expect(fuoriDaiBordi(prima)).toEqual([]);

  const input = page.locator('.sn-popup .sn-popup-input');
  await input.click();
  await input.fill('e questo cosa vuol dire?');
  await input.press('Enter');

  // La domanda dell'utente compare come bolla e arriva la seconda risposta.
  await expect(page.locator('.sn-popup .sn-msg-user .sn-msg-text').last())
    .toContainText('e questo cosa vuol dire?', { timeout: 10_000 });

  // Campiona MENTRE la seconda risposta arriva: nessun istante fuori.
  const sconfinamenti = [];
  const finoA = Date.now() + 12_000;
  while (Date.now() < finoA) {
    const m = await page.evaluate(misura);
    if (!m) break;
    const f = fuoriDaiBordi(m);
    if (f.length) sconfinamenti.push(f);
    const meta = await page.locator('.sn-popup .sn-popup-meta').textContent().catch(() => '');
    if (meta && meta.includes('€')) break;
    await page.waitForTimeout(80);
  }
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });

  const dopo = await page.evaluate(misura);
  expect(fuoriDaiBordi(dopo), 'dopo la seconda risposta il riquadro esce').toEqual([]);
  expect(sconfinamenti, `fuori durante la seconda risposta: ${JSON.stringify(sconfinamenti.slice(0, 3))}`).toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);

  await ripristinaProvider(app);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Risposta ostile: una parola lunghissima senza spazi (che non va a capo da
//    sola), emoji e HTML. La larghezza è l'altro asse dello stesso difetto.
// ─────────────────────────────────────────────────────────────────────────────
test('risposta con una parola lunghissima senza spazi, emoji e HTML: non sborda e non esegue niente', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaProvider(app, 300, {
    pezzi: [
      'a'.repeat(4000),
      ' 🙂🙃😀'.repeat(200),
      ' <img src=x onerror="window.__filoXss=1"> <script>window.__filoXss=1<\/script> ',
      ' [click](javascript:window.__filoXss=1) ',
    ],
  });
  const m = await riquadroPosato(app, page);

  expect(fuoriDaiBordi(m), 'con una risposta ostile il riquadro sborda').toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);
  // Il riquadro non si allarga oltre la sua larghezza naturale.
  expect(m.width).toBeLessThanOrEqual(390);
  // E non ha una barra orizzontale nascosta con dentro il tasto di invio.
  expect(m.scrollW).toBeLessThanOrEqual(Math.ceil(m.width) + 2);
  // Niente è stato eseguito.
  expect(await page.evaluate(() => window.__filoXss || null)).toBeNull();

  await ripristinaProvider(app);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Uso "sbagliato": aperture e chiusure a raffica, poi due riquadri insieme.
// ─────────────────────────────────────────────────────────────────────────────
test('aperture e chiusure a raffica e due riquadri insieme: restano dentro e usabili', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  await preparaProvider(app, 100);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });

  const apri = (f, titolo) => page.evaluate(({ f, titolo }) => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * f) },
      title: titolo,
    });
  }, { f, titolo });

  // Raffica: apre e chiude subito, dieci volte.
  for (let i = 0; i < 10; i++) {
    await apri(0.8, `giro ${i}`);
    await page.waitForSelector('.sn-popup', { timeout: 5000 });
    await page.locator('.sn-popup .sn-popup-close').last().click();
    await expect(page.locator('.sn-popup')).toHaveCount(0, { timeout: 5000 });
  }

  // Nessun riquadro fantasma rimasto appeso al documento.
  expect(await page.evaluate(() => document.querySelectorAll('.sn-popup').length)).toBe(0);

  // Due insieme, uno in alto e uno in basso.
  await apri(0.25, 'primo');
  await page.waitForSelector('.sn-popup', { timeout: 5000 });
  await apri(0.85, 'secondo');
  await expect(page.locator('.sn-popup')).toHaveCount(2, { timeout: 5000 });
  await expect(page.locator('.sn-popup .sn-popup-meta').last()).toContainText('€', { timeout: 25_000 });

  const tutti = await page.evaluate(() => [...document.querySelectorAll('.sn-popup')].map((root) => {
    const input = root.querySelector('.sn-popup-input');
    const compose = root.querySelector('.sn-popup-compose');
    const r = root.getBoundingClientRect();
    const i = input.getBoundingClientRect();
    const c = compose.getBoundingClientRect();
    return {
      vh: window.innerHeight, vw: window.innerWidth,
      top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width,
      inputTop: i.top, inputBottom: i.bottom, composeBottom: c.bottom,
      sendRight: root.querySelector('.sn-popup-send').getBoundingClientRect().right,
      scrollW: root.scrollWidth,
      titolo: root.querySelector('.sn-popup-title').textContent,
    };
  }));
  for (const m of tutti) {
    expect(fuoriDaiBordi(m), `riquadro "${m.titolo}" fuori dallo schermo`).toEqual([]);
  }

  try { await page.screenshot({ path: 'tests/.shots/zz502-due-riquadri.png' }); } catch (_) {}
  await ripristinaProvider(app);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Stato vuoto ed errore: la risposta non arriva o arriva vuota. Il riquadro
//    deve restare dentro e la riga per scrivere raggiungibile — è l'unico modo
//    di riprovare.
// ─────────────────────────────────────────────────────────────────────────────
test('risposta vuota: il riquadro resta dentro lo schermo e si può riprovare', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaProvider(app, 300, { pezzi: ['   '] });
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.9) },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await page.waitForTimeout(3000);
  await attendiIngresso(page);

  const m = await page.evaluate(misura);
  expect(fuoriDaiBordi(m), 'con risposta vuota il riquadro esce').toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);

  await ripristinaProvider(app);
});

test('provider in errore: il riquadro resta dentro lo schermo e la riga per scrivere si clicca', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaProvider(app, 100, { errore: true });
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.9) },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await page.waitForTimeout(3000);
  await attendiIngresso(page);

  const m = await page.evaluate(misura);
  expect(fuoriDaiBordi(m), 'in errore il riquadro esce').toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);

  await ripristinaProvider(app);
});
