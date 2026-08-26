// VERIFICA #502 — "La finestra della spiegazione approfondita esce dal fondo
// dello schermo quando la risposta arriva".
//
// Passi dell'utente: seleziona una parola nella metà bassa della finestra,
// chiede la spiegazione approfondita, aspetta che la risposta finisca di
// arrivare. Il riquadro si posa quando è ancora vuoto (~210px), poi il testo in
// streaming lo allunga fino al tetto di 480px e nessuno rimisura: il fondo —
// dove c'è la riga per scrivere la domanda successiva — finisce fuori schermo.
//
// SUCCESSO dal punto di vista dell'utente: a risposta finita la riga per
// scrivere è ancora dentro lo schermo e ci si può cliccare dentro. Questo spec
// asserisce QUELLO, non l'assenza di un errore.

import { test, expect } from './fixtures/electron.mjs';

test('#502 — a risposta finita la riga per scrivere resta dentro lo schermo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );

  // Provider finto che stream a una risposta lunga: è il testo in arrivo che
  // allunga il riquadro, esattamente come nell'uso vero.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const orig = globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...orig,
      streamComplete: async ({ onDelta }) => {
        const par = 'Questa è una spiegazione approfondita abbastanza lunga da riempire il riquadro fino al suo tetto di altezza, come succede con una risposta vera. ';
        let full = '';
        for (let i = 0; i < 12; i++) {
          onDelta(par);
          full += par;
          await new Promise((r) => setTimeout(r, 20));
        }
        return { text: full, usage: {} };
      },
    };
  });

  // Ancora a tre quarti dell'altezza della finestra, come descritto.
  const geom = await page.evaluate(() => {
    const y = Math.round(window.innerHeight * 0.75);
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'entropia', sentence: 'una frase che parla di entropia' },
      anchor: { x: 120, y },
      title: 'Spiegazione approfondita',
    });
    return { vh: window.innerHeight, vw: window.innerWidth, anchorY: y };
  });
  console.log('[#502] viewport', geom);

  // Misura subito dopo l'apertura, con il corpo ancora vuoto.
  const vuoto = await page.evaluate(() => {
    const r = document.querySelector('.sn-popup')?.getBoundingClientRect();
    return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null;
  });
  console.log('[#502] riquadro vuoto', vuoto);

  // Aspetta che la risposta sia FINITA (il costo in footer segna il turno chiuso).
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });
  await page.waitForTimeout(500);

  const dopo = await page.evaluate(() => {
    const pop = document.querySelector('.sn-popup');
    const compose = document.querySelector('.sn-popup-compose');
    const input = document.querySelector('.sn-popup-input');
    const pr = pop.getBoundingClientRect();
    const cr = compose.getBoundingClientRect();
    const vh = window.innerHeight;
    // La riga per scrivere è raggiungibile col mouse? Chiediamolo al documento:
    // chi risponde al punto centrale della riga di scrittura.
    const cx = Math.round(cr.left + cr.width / 2);
    const cy = Math.round(cr.top + cr.height / 2);
    const hit = (cy >= 0 && cy < vh) ? document.elementFromPoint(cx, cy) : null;
    return {
      vh,
      popup: { top: Math.round(pr.top), bottom: Math.round(pr.bottom), h: Math.round(pr.height) },
      compose: { top: Math.round(cr.top), bottom: Math.round(cr.bottom) },
      fuoriSchermo: Math.max(0, Math.round(pr.bottom - vh)),
      composeDentro: cr.bottom <= vh && cr.top >= 0,
      composeCliccabile: !!(hit && (hit === input || compose.contains(hit))),
    };
  });
  console.log('[#502] dopo la risposta', dopo);

  try { await page.screenshot({ path: 'tests/.shots/verifica-502-popup.png' }); } catch (_) {}

  // SUCCESSO: il riquadro sta dentro lo schermo…
  expect(dopo.fuoriSchermo, `il riquadro esce dal fondo di ${dopo.fuoriSchermo}px`).toBe(0);
  // …e la riga per scrivere la domanda successiva è visibile e cliccabile.
  expect(dopo.composeDentro, 'la riga per scrivere è fuori dallo schermo').toBe(true);
  expect(dopo.composeCliccabile, 'la riga per scrivere non è raggiungibile col mouse').toBe(true);
});
