// #584, settimo giro — la riga sotto «Ha funzionato?» prometteva di pubblicare
// anche là dove il sesto giro ha deciso che non si pubblica.
//
// Il terzo giro ha messo sotto la domanda una riga che dice cosa succede se
// rispondi: «Rispondendo condividi i passi di questo percorso con chi userà
// Filo su questo sito». Era giusto, ed è l'unico punto in cui l'utente lo legge
// nel momento in cui sceglie.
//
// Il sesto giro ha poi deciso che da certi siti non si raccoglie niente: il
// router, il disco di rete, il server di prova sulla propria macchina,
// l'intranet dell'ufficio, le pagine interne di Filo. Lì la riga era rimasta
// quella, e prometteva una cosa che non succedeva: chi la leggeva rispondeva
// per aiutare gli altri, vedeva «Grazie!», e non era partito niente.
//
// GIRATE dopo la correzione di questo stesso giro: dove non si raccoglie, la
// domanda non si fa. Il riquadro e la raccolta si fanno la stessa domanda alla
// stessa porta, quindi non possono più divergere.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

test('su una pagina interna di Filo il riquadro non viene nemmeno offerto', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForFunction(
    () => typeof window.__filoSidebarTest?.percorsoRaccoglibile === 'function',
    null, { timeout: 8000 },
  );

  // La porta che decide se chiedere: la stessa che usa la raccolta.
  expect(await page.evaluate(() => window.__filoSidebarTest.percorsoRaccoglibile())).toBe(false);

  // E quello che succederebbe se si rispondesse, sulla stessa pagina.
  const esito = await app.evaluate(async ({ app: _a }, { rawUrl }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    C._reset(); C._setAuto(false);
    const chiamate = [];
    const r = await C.collectAndSave({
      session: {
        rawUrl,
        rawSteps: [{ selector: '[aria-label="Avanzate"]', action: 'click' }],
        rawUserMessages: ['dove sono le impostazioni?'],
        success: true,
      },
      invokeAI: async ({ action }) => {
        chiamate.push(action);
        return action === 'help_intent_guess' ? { text: 'aprire le impostazioni' } : { text: '{"ok": true}' };
      },
    });
    const inCoda = C._peek().length;
    C._reset();
    return { r, inCoda, chiamate };
  }, { rawUrl: 'filo://newtab/index.html' });

  expect(esito.r.saved).toBe(false);
  expect(esito.r.reason).toMatch(/privato o locale/);
  expect(esito.inCoda).toBe(0);
  expect(esito.chiamate).toEqual([]);
});

test('la stessa porta dice no anche sul server di prova, sull’intranet e sul disco di rete', async ({ app }) => {
  const esiti = await app.evaluate(async ({ app: _a }, { urls }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    C._reset(); C._setAuto(false);
    const out = [];
    for (const rawUrl of urls) out.push({ rawUrl, porta: await C.raccoglibile(rawUrl) });
    C._reset();
    return out;
  }, { urls: ['http://127.0.0.1:8080/pannello', 'https://portale.intranet/hr/ferie', 'https://nas-rossi.local/files'] });

  for (const e of esiti) {
    expect(e.porta.ok, `${e.rawUrl}: non si chiede e non si pubblica`).toBe(false);
    expect(e.porta.reason).toMatch(/privato o locale/);
  }
});

test('e su un sito vero il riquadro resta quello che era: la riga si legge e i pulsanti pubblicano', async ({ app, openTab }) => {
  const risposta = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    C._reset(); C._setAuto(false);
    const porta = await C.raccoglibile('https://negoziofelice.it/account/ordini');
    C._reset();
    return porta;
  });
  expect(risposta.ok, 'da un sito vero si chiede ancora').toBe(true);

  // Il riquadro, disegnato, è rimasto intero: la riga sta sopra i pulsanti e si
  // legge (le prove dei giri 4, 5 e 6 la guardano nel dettaglio).
  const page = await openTab(NEWTAB);
  await page.waitForFunction(
    () => typeof window.__filoSidebarTest?.renderFeedbackPrompt === 'function',
    null, { timeout: 8000 },
  );
  await page.evaluate(() => {
    window.SN_SIDEBAR.open();
    window.__filoSidebarTest.renderFeedbackPrompt();
  });
  await page.waitForSelector('.sn-sidebar-feedback', { timeout: 8000 });
  const nota = ((await page.locator('.sn-sidebar-feedback-nota').textContent()) || '').toLowerCase();
  expect(nota).toContain('condividi');
  expect(nota).toContain('su questo sito');
  await page.screenshot({ path: 'tests/.shots/584-giro7-riquadro-dove-si-condivide.png' });
});
