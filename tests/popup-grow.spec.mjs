// Feedback #502 — il RIQUADRO DELLA RISPOSTA di Filo, quello che si apre
// chiedendo di spiegare (Alt+E) o tradurre, non ha un'altezza definitiva quando
// viene posato. Filo lo posa mentre è ancora vuoto, alto un paio di centinaia di
// pixel; poi la risposta arriva, il riquadro cresce fino al suo tetto e nessuno
// lo rimisura. Aprendolo nella metà bassa della finestra il fondo finisce sotto
// il bordo: la riga col modello e il costo resta tagliata a metà e il campo dove
// si scrive la domanda successiva finisce tutto fuori — la conversazione si
// interrompe lì, e per rimediare bisogna chiudere tutto e rifare la selezione
// più in alto nella pagina.
//
// Stesso difetto, stessa cura del menu del tasto destro (#500): la posa non è un
// fatto solo, si ripete a ogni cambio d'altezza. Vedi PATTERNS.md § "Un riquadro
// che si riempie dopo va rimisurato dopo".
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
async function paginaFresca(openTab) {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  // La scheda di una pagina interna viene RIUSATA: i riquadri lasciati aperti
  // da un test precedente sono ancora nel documento, e sarebbero loro i primi a
  // farsi trovare cercando `.sn-popup`.
  await page.evaluate(() => {
    for (let i = 0; i < 20 && document.querySelector('.sn-popup'); i++) window.SN_POPUP.closeTopmost();
    document.querySelectorAll('.sn-popup').forEach((n) => n.remove());
  });
  await expect(page.locator('.sn-popup')).toHaveCount(0);
  return page;
}

// Il riquadro pieno arriva a 480px, quello vuoto sta sotto i 210: se il punto
// cliccato si sceglie come FRAZIONE dell'altezza, che il fondo esca o no dipende
// da quanto è alta la finestra — su una finestra generosa (le macchine di prova
// ne aprono di ogni misura) lo stesso caso non sfora, e la prova diventa verde
// anche senza la cura. Quindi il punto si sceglie a partire dal BORDO BASSO:
// `spazioSotto` è quanto resta sotto al punto cliccato, e decide da solo se il
// riquadro pieno ci sta o no, su qualunque finestra.
//   300 → il riquadro vuoto ci sta, quello pieno no: è il caso della
//         segnalazione (#502);
//   600 → ci sta anche pieno: serve a provare che chi non deve muoversi
//         non si muove.
const SPAZIO_STRETTO = 300;
const SPAZIO_LARGO = 600;

// Apre il riquadro come fa "Spiega" dal menu del tasto destro.
async function apriRiquadro(page, spazioSotto = SPAZIO_STRETTO) {
  const y = await page.evaluate((s) => {
    const yy = Math.max(8, Math.round(window.innerHeight - s));
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 260, y: yy },
      title: 'Spiega',
    });
    return yy;
  }, spazioSotto);
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

test('#502 la risposta arriva e fa crescere il riquadro: resta dentro la finestra', async ({ openTab }) => {
  const page = await paginaFresca(openTab);

  await apriRiquadro(page, SPAZIO_STRETTO);
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

test('#502 crescendo, il riquadro scivola del minimo invece di saltare sopra al cursore', async ({ openTab }) => {
  const page = await paginaFresca(openTab);

  const y = await apriRiquadro(page, SPAZIO_STRETTO);
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

test('#502 un riquadro che ci sta già non si sposta di un pixel quando cresce', async ({ openTab }) => {
  const page = await paginaFresca(openTab);

  await apriRiquadro(page, SPAZIO_LARGO);
  const prima = await geometria(page);
  await rispostaArriva(page);
  // Cresciuto per davvero, e senza essersi mosso di un pixel.
  await expect.poll(async () => (await geometria(page)).altezza, { timeout: 5000 })
    .toBeGreaterThan(prima.altezza);
  const dopo = await geometria(page);
  expect(dopo.top).toBe(prima.top);
  expect(dopo.bottom).toBeLessThanOrEqual(dopo.vh);
});

test('#502 la risposta si accorcia: il riquadro non si tiene addosso una barra che non serve', async ({ openTab }) => {
  const page = await paginaFresca(openTab);

  await apriRiquadro(page, SPAZIO_STRETTO);
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

test('#502 dopo che l\'utente l\'ha trascinato, il riquadro non si sposta più da solo', async ({ openTab }) => {
  const page = await paginaFresca(openTab);

  await apriRiquadro(page, SPAZIO_LARGO);
  // Lo si trascina dove il riquadro pieno NON ci starebbe: è lì che si vede se
  // resta dove l'utente l'ha messo invece di scappare in su.
  const bersaglio = await page.evaluate((s) => Math.max(8, Math.round(window.innerHeight - s)), SPAZIO_STRETTO);
  await trascinaA(page, bersaglio);
  const messo = await geometria(page);
  expect(Math.abs(messo.top - bersaglio)).toBeLessThanOrEqual(4);

  await rispostaArriva(page, 40);
  await attendiRientro(page);

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

// --- la FINESTRA si accorcia sotto al riquadro -----------------------------
// L'altro verso dello stesso difetto: il riquadro sta fermo ed è la finestra a
// perdere altezza. Il fondo esce dal bordo esattamente come quando è il
// riquadro a crescere, quindi il conto va rifatto uguale.

// Il ridimensionamento della finestra arriva solo alla scheda ATTIVA: una in
// secondo piano ha i bounds azzerati e continua a raccontare la misura vecchia.
// Di `filo://newtab/` ne esiste già una all'avvio, quindi la scheda che stiamo
// pilotando non è per forza quella in primo piano: la marchiamo col titolo e
// chiediamo alla shell di portarla davanti.
async function portaInPrimoPiano(shell, page) {
  const marchio = `filo-test-${Date.now()}`;
  await page.evaluate((t) => { document.title = t; }, marchio);
  await expect.poll(async () => shell.evaluate(async (t) => {
    const s = await window.filoShell.tabs.snapshot();
    const tab = s.tabs.find((x) => x.title === t);
    if (!tab) return 'scheda non trovata';
    if (s.activeId === tab.id) return 'in primo piano';
    await window.filoShell.tabs.activate(tab.id);
    return 'la sto attivando';
  }, marchio), { timeout: 5000 }).toBe('in primo piano');
}

test('#502 la finestra si accorcia sotto al riquadro: rientra e resta scrivibile', async ({ app, shell, openTab }) => {
  const page = await paginaFresca(openTab);
  await portaInPrimoPiano(shell, page);

  await apriRiquadro(page, SPAZIO_LARGO);
  await rispostaArriva(page, 14);
  await attendiRientro(page);
  const prima = await geometria(page);
  expect(prima.bottom).toBeLessThanOrEqual(prima.vh);

  const bounds = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const b = w.getBounds();
    w.setBounds({ ...b, height: Math.max(240, b.height - 340) });
    return b;
  });
  try {
    await expect
      .poll(async () => page.evaluate(() => window.innerHeight), { timeout: 5000 })
      .toBeLessThan(prima.vh);
    await attendiRientro(page);

    const dopo = await geometria(page);
    expect(dopo.top).toBeGreaterThanOrEqual(0);
    expect(dopo.bottom).toBeLessThanOrEqual(dopo.vh);
    expect(dopo.metaBottom).toBeLessThanOrEqual(dopo.vh);

    // La prova vera: la conversazione continua.
    const campo = page.locator('.sn-popup-input');
    await campo.click({ timeout: 3000 });
    await campo.fill('e in una finestra piccola?');
    await expect(campo).toHaveValue('e in una finestra piccola?');
  } finally {
    await app.evaluate(async ({ BrowserWindow }, b) => {
      BrowserWindow.getAllWindows()[0].setBounds(b);
    }, bounds);
  }
});
