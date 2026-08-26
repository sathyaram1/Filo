// Feedback #500, superficie gemella del menu: il RIQUADRO DELLA RISPOSTA di
// Filo — quello che si apre chiedendo di spiegare o tradurre — non ha
// un'altezza definitiva quando viene posato. Filo lo posa mentre è ancora
// vuoto, alto un paio di centinaia di pixel; poi la risposta arriva, il
// riquadro cresce fino al suo tetto e nessuno lo rimisura. Aprendolo intorno a
// metà schermo il fondo finisce sotto il bordo della finestra: la riga col
// modello e il costo resta tagliata a metà e il campo dove si scrive la domanda
// successiva finisce tutto fuori — la conversazione si interrompe lì.
//
// Questi spec asseriscono il SUCCESSO dal punto di vista di chi usa Filo: dopo
// che la risposta è arrivata si riesce ancora a leggere la riga del modello e a
// SCRIVERE la domanda successiva. Senza il fix — misura unica all'apertura — il
// campo resta fuori dalla finestra e Playwright non riesce nemmeno a cliccarci:
// rosso.
//
// L'unica cosa che il riquadro non deve fare è muoversi da solo dopo che
// l'utente l'ha trascinato a mano: lì resta dov'è e scorre.

import { test, expect } from './fixtures/electron.mjs';

// Una pagina nuova per ogni test: le pagine interne di Filo vengono riusate fra
// una scheda e l'altra, e un riquadro rimasto aperto da un test precedente
// sarebbe quello che troviamo cercando `.sn-popup`.
async function paginaFresca(openTab, testServer) {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body
    style="margin:0;font:16px sans-serif"><p style="padding:16px">Una pagina qualunque.</p></body></html>`);
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  return page;
}

// Apre il riquadro come fa "Spiega" dal menu del tasto destro. `fraz` è dove
// sta il punto cliccato, in frazione dell'altezza della finestra.
async function apriRiquadro(page, fraz = 0.5) {
  const y = await page.evaluate((f) => {
    const yy = Math.round(window.innerHeight * f);
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 260, y: yy },
      title: 'Spiega',
    });
    return yy;
  }, fraz);
  await expect(page.locator('.sn-popup')).toBeVisible();
  return y;
}

// La risposta arriva: è la stessa mutazione che fa il gestore dei delta,
// scrivere il markdown reso dentro la bolla dell'assistente.
async function rispostaArriva(page, righe = 14) {
  await page.evaluate((n) => {
    const t = document.querySelector('.sn-popup .sn-msg-assistant .sn-msg-text');
    if (!t) throw new Error('nessuna bolla di risposta nel riquadro');
    t.innerHTML = Array.from({ length: n }, (_, i) =>
      `<p>Riga ${i + 1} della spiegazione: abbastanza testo da occupare una riga intera e far crescere il riquadro.</p>`).join('');
  }, righe);
}

// Geometria del riquadro e delle due cose che devono restare raggiungibili.
async function geometria(page) {
  return page.evaluate(() => {
    const r = document.querySelector('.sn-popup');
    if (!r) return { error: 'riquadro chiuso' };
    const meta = r.querySelector('.sn-popup-meta');
    const input = r.querySelector('.sn-popup-input');
    const b = r.getBoundingClientRect();
    return {
      vh: window.innerHeight,
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      altezza: Math.round(b.height),
      metaBottom: meta ? Math.round(meta.getBoundingClientRect().bottom) : null,
      inputBottom: input ? Math.round(input.getBoundingClientRect().bottom) : null,
      corpoScorrevole: (() => {
        const c = r.querySelector('.sn-popup-body');
        return !!c && c.scrollHeight > c.clientHeight + 1;
      })(),
    };
  });
}

async function attendiRientro(page) {
  await expect.poll(async () => {
    const g = await geometria(page);
    return g.error ? 9999 : g.bottom - g.vh;
  }, { timeout: 5000 }).toBeLessThanOrEqual(0);
}

test('#500 la risposta arriva e fa crescere il riquadro: resta dentro la finestra', async ({ openTab, testServer }) => {
  const page = await paginaFresca(openTab, testServer);

  await apriRiquadro(page, 0.5);
  const prima = await geometria(page);
  expect(prima.error).toBeFalsy();

  await rispostaArriva(page);
  // La crescita è vera: senza, il resto non proverebbe niente.
  await expect.poll(async () => (await geometria(page)).altezza, { timeout: 5000 })
    .toBeGreaterThan(prima.altezza);
  // …e così com'era finirebbe sotto il bordo.
  expect(prima.top + (await geometria(page)).altezza).toBeGreaterThan(prima.vh);

  await attendiRientro(page);
  const g = await geometria(page);
  expect(g.top).toBeGreaterThanOrEqual(0);
  expect(g.metaBottom).toBeLessThanOrEqual(g.vh);
  expect(g.inputBottom).toBeLessThanOrEqual(g.vh);

  // E la conversazione continua davvero: Playwright rifiuta di scrivere in un
  // campo fuori dalla finestra, quindi questo è il test vero.
  const campo = page.locator('.sn-popup-input');
  await campo.click({ timeout: 3000 });
  await campo.fill('e questo cosa vuol dire?');
  await expect(campo).toHaveValue('e questo cosa vuol dire?');
});

test('#500 crescendo, il riquadro scivola del minimo invece di saltare sopra al cursore', async ({ openTab, testServer }) => {
  const page = await paginaFresca(openTab, testServer);

  const y = await apriRiquadro(page, 0.5);
  const prima = await geometria(page);
  await rispostaArriva(page);
  await attendiRientro(page);
  const dopo = await geometria(page);

  // Si è mosso (serviva)…
  expect(dopo.top).toBeLessThan(prima.top);
  // …ma è ancora sotto al punto cliccato: ribaltandosi finirebbe sopra, e
  // schizzerebbe via da sotto la mano di chi sta per cliccare.
  expect(dopo.top).toBeGreaterThan(y - dopo.altezza);
  // Scivolata del minimo: appoggiato al bordo basso, non più su.
  expect(dopo.bottom).toBeGreaterThanOrEqual(dopo.vh - 12);
});

test('#500 un riquadro che ci sta già non si sposta di un pixel quando cresce', async ({ openTab, testServer }) => {
  const page = await paginaFresca(openTab, testServer);

  await apriRiquadro(page, 0.05);
  const prima = await geometria(page);
  await rispostaArriva(page);
  await page.waitForTimeout(400);
  const dopo = await geometria(page);
  expect(dopo.top).toBe(prima.top);
  expect(dopo.bottom).toBeLessThanOrEqual(dopo.vh);
});

test('#500 la risposta si accorcia: il riquadro non si tiene addosso una barra che non serve', async ({ openTab, testServer }) => {
  const page = await paginaFresca(openTab, testServer);

  await apriRiquadro(page, 0.5);
  await rispostaArriva(page, 40);
  await attendiRientro(page);

  // "NESSUNA SPIEGAZIONE": la risposta si riduce a una riga.
  await page.evaluate(() => {
    const t = document.querySelector('.sn-popup .sn-msg-assistant .sn-msg-text');
    t.textContent = 'Niente da spiegare.';
  });
  await expect.poll(async () => (await geometria(page)).corpoScorrevole, { timeout: 5000 }).toBe(false);
  const g = await geometria(page);
  expect(g.top).toBeGreaterThanOrEqual(0);
  expect(g.bottom).toBeLessThanOrEqual(g.vh);
  await expect(page.locator('.sn-popup')).toBeVisible();
});

// --- trascinato a mano: la posa è dell'utente ------------------------------

// Trascina il riquadro per la fascia in alto fino a `y`.
async function trascinaA(page, y) {
  const h = await page.evaluate(() => {
    const r = document.querySelector('.sn-popup').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
  });
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x, y + 12, { steps: 8 });
  await page.mouse.up();
}

test('#500 dopo che l\'utente l\'ha trascinato, il riquadro non si sposta più da solo', async ({ openTab, testServer }) => {
  const page = await paginaFresca(openTab, testServer);

  await apriRiquadro(page, 0.1);
  const bersaglio = await page.evaluate(() => Math.round(window.innerHeight * 0.55));
  await trascinaA(page, bersaglio);
  const messo = await geometria(page);
  expect(Math.abs(messo.top - bersaglio)).toBeLessThanOrEqual(4);

  await rispostaArriva(page, 40);
  await page.waitForTimeout(500);

  const dopo = await geometria(page);
  // Non gli si muove sotto le dita: sta dove l'utente l'ha messo…
  expect(dopo.top).toBe(messo.top);
  // …e ci resta dentro perché scorre, non perché è stato spostato.
  expect(dopo.bottom).toBeLessThanOrEqual(dopo.vh);
  expect(dopo.corpoScorrevole).toBe(true);

  // La riga del modello e il campo della domanda sono ancora lì.
  const g = await geometria(page);
  expect(g.metaBottom).toBeLessThanOrEqual(g.vh);
  const campo = page.locator('.sn-popup-input');
  await campo.click({ timeout: 3000 });
  await campo.fill('e adesso?');
  await expect(campo).toHaveValue('e adesso?');
});
