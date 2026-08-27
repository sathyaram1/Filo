// #502 — "La finestra della spiegazione approfondita esce dal fondo dello
// schermo quando la risposta arriva": il riquadro `.sn-popup` si apre vuoto
// sopra la selezione, poi il testo in streaming lo allunga fino al suo tetto e
// nessuno lo rimisura. Chi seleziona una parola nella metà bassa della finestra
// si ritrova la riga per scrivere la domanda successiva fuori dallo schermo, e
// da lì non può più chiedere niente.
//
// Qui giriamo lo scenario vero: selezione a tre quarti dell'altezza, risposta
// lunga che arriva a pezzi, e asseriamo il SUCCESSO dal punto di vista
// dell'utente — a risposta finita la riga per scrivere è dentro lo schermo E
// cliccabile (il punto sotto il cursore è davvero la casella di testo), e non
// è mai uscita nemmeno per un istante mentre la risposta arrivava.
//
// Senza il fix: il riquadro cresce da ~210px al tetto restando ancorato dov'era
// stato posato da vuoto, il fondo scende sotto il bordo e l'assert sulla
// casella di testo dentro il viewport diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

// Provider finto: manda una risposta lunga a pezzi, con una pausa fra uno e
// l'altro. La lunghezza serve a portare il riquadro al suo tetto d'altezza; le
// pause servono a poterlo guardare MENTRE cresce, che è il momento del difetto.
// Il corpo della funzione gira nel processo main, dove le variabili del file di
// test non arrivano: i pezzi si costruiscono lì dentro.
async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = Array.from({ length: 12 }, (_, i) =>
      `Paragrafo ${i + 1}: una spiegazione distesa della parola selezionata, con abbastanza testo da far crescere il riquadro fino al suo tetto di altezza. `);
    globalThis.__origGemPose = globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__origGemPose,
      streamComplete: async ({ onDelta }) => {
        // Attesa iniziale come quella vera di un modello: è la finestra in cui
        // il riquadro sta aperto e vuoto, e in cui l'utente può spostarlo.
        await new Promise((r) => setTimeout(r, 1200));
        for (const p of pezzi) {
          onDelta(p);
          await new Promise((r) => setTimeout(r, 40));
        }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  });
}

async function ripristinaProvider(app) {
  await app.evaluate(() => {
    if (globalThis.__origGemPose) globalThis.SN_PROVIDER_GEMINI = globalThis.__origGemPose;
  });
}

// L'apertura ha una sua animazione (dissolvenza con 2px di scivolata): non è la
// posa, è l'ingresso. Chi misura prima che finisca legge una posizione che
// nessuno ha deciso. Aspettiamo che sia finita e poi guardiamo.
const attendiIngresso = async (page) => {
  await page.evaluate(async () => {
    const root = document.querySelector('.sn-popup');
    if (!root?.getAnimations) return;
    await Promise.all(root.getAnimations().map((a) => a.finished.catch(() => {})));
  });
};

// Legge la posa corrente: ingombro del riquadro e della riga per scrivere.
const misura = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return null;
  const input = root.querySelector('.sn-popup-input');
  const r = root.getBoundingClientRect();
  const i = input.getBoundingClientRect();
  return {
    vh: window.innerHeight,
    vw: window.innerWidth,
    top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
    inputTop: i.top, inputBottom: i.bottom, inputLeft: i.left, inputRight: i.right,
  };
};

test('spiegazione approfondita su selezione in basso: la riga per scrivere resta dentro lo schermo mentre la risposta arriva', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );

  await preparaProvider(app);

  // Selezione a tre quarti dell'altezza della finestra, come nella segnalazione.
  const ancora = await page.evaluate(() => {
    const y = Math.round(window.innerHeight * 0.75);
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y },
      title: 'Approfondisci',
    });
    return { y, vh: window.innerHeight };
  });

  // Il riquadro nasce vuoto: è questa l'altezza su cui il vecchio codice posava.
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await attendiIngresso(page);
  const daVuoto = await page.evaluate(misura);
  expect(daVuoto).not.toBeNull();

  // Mentre la risposta arriva, campiona la posa: nessun istante in cui il
  // riquadro sborda dal fondo (né dagli altri bordi).
  const sconfinamenti = [];
  const finoA = Date.now() + 12_000;
  let cresciuto = daVuoto.height;
  while (Date.now() < finoA) {
    const m = await page.evaluate(misura);
    if (!m) break;
    cresciuto = Math.max(cresciuto, m.height);
    if (m.bottom > m.vh + 1 || m.top < -1 || m.left < -1 || m.right > m.vw + 1) {
      sconfinamenti.push(m);
    }
    const fatto = await page.locator('.sn-popup .sn-popup-meta').textContent().catch(() => '');
    if (fatto && fatto.includes('€')) break;
    await page.waitForTimeout(60);
  }

  // Il turno è chiuso: quello che vediamo è la risposta finale, non un fotogramma.
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 15_000 });
  await expect(page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last())
    .toContainText('Paragrafo 12', { timeout: 5000 });

  // Lo scenario è quello vero: il riquadro è cresciuto parecchio dopo l'apertura.
  expect(cresciuto).toBeGreaterThan(daVuoto.height + 100);

  const finale = await page.evaluate(misura);

  // SUCCESSO 1 — la riga per scrivere la domanda successiva è dentro lo schermo.
  expect(finale.inputBottom).toBeLessThanOrEqual(finale.vh);
  expect(finale.inputTop).toBeGreaterThanOrEqual(0);
  // E tutto il riquadro con lei.
  expect(finale.bottom).toBeLessThanOrEqual(finale.vh + 1);
  expect(finale.top).toBeGreaterThanOrEqual(-1);

  // SUCCESSO 2 — non è solo "dentro le coordinate": è CLICCABILE. Puntiamo il
  // centro della casella e sotto il cursore deve esserci la casella stessa.
  const cliccabile = await page.evaluate(() => {
    const root = document.querySelector('.sn-popup');
    const input = root.querySelector('.sn-popup-input');
    const r = input.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && (el === input || input.contains(el));
  });
  expect(cliccabile).toBe(true);

  // SUCCESSO 3 — e ci si può davvero scrivere dentro.
  await page.locator('.sn-popup .sn-popup-input').click();
  await page.locator('.sn-popup .sn-popup-input').fill('e questo cosa vuol dire?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e questo cosa vuol dire?');

  // Nessuno sconfinamento nemmeno a metà streaming.
  expect(sconfinamenti, `posa fuori dallo schermo durante lo streaming: ${JSON.stringify(sconfinamenti.slice(0, 3))}`).toEqual([]);

  // Traccia visiva della run (gitignorata).
  try { await page.screenshot({ path: 'tests/.shots/popup-pose-streaming.png' }); } catch (_) {}

  expect(ancora.y).toBeGreaterThan(0);
  await ripristinaProvider(app);
});

test('selezione a metà finestra: il riquadro si accorcia invece di sbordare, e non salta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );

  await preparaProvider(app);

  // A metà finestra il riquadro VUOTO ci sta comodo sotto la selezione: il
  // vecchio codice lo posava lì e non ci tornava più, poi la risposta lo
  // allungava e il fondo scendeva sotto il bordo. È l'altra metà del difetto —
  // dove non basta "girarlo di sopra", perché sopra lo spazio non è di più:
  // l'altezza va stretta a quella disponibile e il corpo deve scorrere.
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.5) },
      title: 'Approfondisci',
    });
  });

  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await attendiIngresso(page);
  const daVuoto = await page.evaluate(misura);

  const cime = new Set();
  const finoA = Date.now() + 12_000;
  while (Date.now() < finoA) {
    const m = await page.evaluate(misura);
    if (!m) break;
    cime.add(Math.round(m.top));
    // Nemmeno per un fotogramma: se sborda, qui il test è già rosso.
    expect(m.bottom, `riquadro fuori dal fondo a metà risposta (vh=${m.vh})`).toBeLessThanOrEqual(m.vh + 1);
    const fatto = await page.locator('.sn-popup .sn-popup-meta').textContent().catch(() => '');
    if (fatto && fatto.includes('€')) break;
    await page.waitForTimeout(60);
  }

  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 15_000 });

  const finale = await page.evaluate(misura);
  // Il lato scelto è "sotto" e non cambia: la cima non si è mai mossa, niente
  // salto a metà risposta.
  expect([...cime]).toEqual([Math.round(daVuoto.top)]);
  expect(Math.round(finale.top)).toBe(Math.round(daVuoto.top));
  // E la riga per scrivere è dentro lo schermo, cliccabile.
  expect(finale.inputBottom).toBeLessThanOrEqual(finale.vh);
  const cliccabile = await page.evaluate(() => {
    const input = document.querySelector('.sn-popup .sn-popup-input');
    const r = input.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && (el === input || input.contains(el));
  });
  expect(cliccabile).toBe(true);

  // Il testo non è andato perduto con l'altezza: il corpo scorre.
  await expect(page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last())
    .toContainText('Paragrafo 12', { timeout: 5000 });

  await ripristinaProvider(app);
});
