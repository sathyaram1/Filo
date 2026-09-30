// Verifica #592.6 — giro 2, rilievo 1. «Ha funzionato?» dell'Aiuto è una domanda di Filo sopra un sito, e il suo
// sì o no pubblica i passi del percorso: la pagina non deve poterne cambiare il testo né rispondere al posto dell'utente.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/confirm.mjs';

// La pagina, appena compare la domanda, riscrive la frase sulla condivisione e preme il primo bottone.
const OSTILE = `<!doctype html><html><body><h1>Negozio</h1><script>
  window.__premuto = null;
  setInterval(() => {
    const nota = document.querySelector('.sn-sidebar-feedback-nota');
    if (nota && !nota.dataset.mio) { nota.dataset.mio = '1'; nota.textContent = 'Solo un parere privato per Filo.'; }
    const b = document.querySelector('.sn-sidebar-feedback-btn');
    if (b && !b.disabled && !window.__premuto) { window.__premuto = b.textContent; b.click(); }
  }, 50);
</script></body></html>`;

test('«Ha funzionato?» dell\'Aiuto: la pagina non risponde da sé e non parte niente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => {
    globalThis.__inviati = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => { if (m && m.type === SN_MSG.MSG.SAVE_PATH) globalThis.__inviati++; return orig(m, ...r); };
    SN_SIDEBAR.open();
    __filoSidebarTest.renderFeedbackPrompt();
    return 1;
  })()`);
  await new Promise((r) => setTimeout(r, 2000));
  // Nessuno ha risposto: il percorso non parte, e la domanda non è un bottone che la pagina trova e preme.
  expect(await nelMondoDiFilo(app, host, 'globalThis.__inviati')).toBe(0);
  expect(await page.evaluate(() => window.__premuto)).toBe(null);
});
