import { test, expect } from './fixtures/electron.mjs';

// Feedback: su tutti i siti il colore della selezione del testo deve essere
// quello base di Filo (arancione/terracotta), non il blu di sistema.
//
// Il <link filo://style/theme.css> iniettato dal content script viene bloccato
// dalla CSP di molti siti, quindi la regola ::selection non arriva e la
// selezione resta blu. Il fix inietta il colore via webContents.insertCSS, che
// ignora la CSP. Questo test usa una pagina CON una CSP che blocca gli
// stylesheet filo://, per provare che il colore Filo arriva comunque.

const FILO_SELECTION = /\b196,\s*90,\s*59\b/; // rgb dell'accent Filo

test('selection color is Filo orange on external pages even under CSP', async ({ openTab, testServer }) => {
  const html = `<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="style-src 'self' 'unsafe-inline'; img-src *;">
    <title>CSP selection page</title></head>
    <body><p id="t" style="font-size:24px">Seleziona questo testo per favore</p></body></html>`;

  const page = await testServer.openReady(openTab, html);

  // Il content script imposta data-sn-theme su <html>; aspettiamolo così la
  // regola ::selection theme-scoped (e comunque il fallback) è in gioco.
  await page
    .waitForFunction(() => !!document.documentElement.dataset.snTheme, null, { timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(300);

  const probe = await page.evaluate(() => {
    const el = document.getElementById('t');
    const link = [...document.querySelectorAll('link[rel=stylesheet]')]
      .find((l) => /filo:\/\/style\/theme\.css/.test(l.href));
    return {
      bg: getComputedStyle(el, '::selection').backgroundColor || '',
      // Una <link> bloccata dalla CSP non espone .sheet: se è null, il colore
      // NON può venire da theme.css → deve venire dall'insertCSS del fix.
      themeLinkBlocked: !!link && link.sheet == null,
    };
  });

  expect(probe.themeLinkBlocked).toBe(true);
  expect(probe.bg).toMatch(FILO_SELECTION);
});
