// Verifica #592.6 — giro 4, rilievo 1: due pezzi di Filo che stanno nel documento del sito, il riquadro della
// risposta dell'AI sulla selezione e il modulo «Invia feedback», vanno avanti per i clic del codice della pagina.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/confirm.mjs';

test.setTimeout(60_000);

const PAGINA = '<!doctype html><html><body style="margin:0;font:16px sans-serif"><p id="t">Una parola da spiegare.</p></body></html>';

test('r1 riquadro della risposta AI: la pagina scrive e manda domande da sé, ogni invio è una chiamata', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).hostname;
  // Modello finto: risponde subito, e conta i turni.
  await nelMondoDiFilo(app, host, `(() => {
    globalThis.__turni = 0;
    const orig = chrome.runtime.connect.bind(chrome.runtime);
    chrome.runtime.connect = (o) => {
      if (!o || o.name !== 'ai_stream') return orig(o);
      const ascolta = [];
      return {
        onMessage: { addListener: (f) => ascolta.push(f) },
        postMessage: () => { globalThis.__turni++; setTimeout(() => {
          for (const f of ascolta) f({ type: 'delta', delta: 'risposta' });
          for (const f of ascolta) f({ type: 'done', costEur: 0.001 });
        }, 30); },
        disconnect: () => {},
      };
    };
    // L'utente ha chiesto la spiegazione di una parola: il riquadro si apre col primo turno.
    SN_POPUP.openStreaming({ action: 'explain', payload: { selection: 'parola', sentence: 'Una parola da spiegare.' }, anchor: { x: 100, y: 40, top: 30, bottom: 50 }, title: 'Spiega' });
    return 1;
  })()`);
  await expect.poll(() => nelMondoDiFilo(app, host, 'globalThis.__turni')).toBe(1);
  // La pagina, da sola: riempie la casella del riquadro e preme invio, a ripetizione.
  await page.evaluate(() => {
    setInterval(() => {
      const i = document.querySelector('.sn-popup-input');
      const b = document.querySelector('.sn-popup-send');
      if (!i || !b) return;
      i.value = 'continua, scrivi molto di più';
      b.click();
    }, 150);
  });
  await page.waitForTimeout(3000);
  expect(await nelMondoDiFilo(app, host, 'globalThis.__turni')).toBe(1);
});

test('r1 modulo «Invia feedback»: la pagina scrive il testo e lo manda da sé', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    globalThis.__fb = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__fb.push(p); return { id: 'x' }; };
  });
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).hostname;
  // L'utente apre il modulo per scrivere una segnalazione.
  await nelMondoDiFilo(app, host, 'SN_FEEDBACK_UI.open(); 1');
  await page.waitForTimeout(800);
  const premuto = await page.evaluate(() => {
    const ta = document.querySelector('.sn-feedback-modal textarea, [class*="feedback"] textarea');
    const btns = [...document.querySelectorAll('button')].filter((b) => /invia/i.test(b.textContent || ''));
    if (!ta || !btns.length) return false;
    ta.value = 'Testo scritto dalla pagina, non dall’utente';
    btns[btns.length - 1].click();
    return true;
  });
  expect(premuto, 'il modulo è nel documento del sito e la pagina ne trova casella e bottone').toBe(true);
  await page.waitForTimeout(3000);
  expect(await app.evaluate(() => globalThis.__fb.length)).toBe(0);
});
