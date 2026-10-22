// #1509 — Un avviso nato nel main che non riguarda la pagina (qui: allegati del feedback non saliti) arrivava al sito in
// primo piano, che lo scriveva nel suo documento: il sito leggeva i nomi dei file. Ora sta nella barra di Filo e dice solo
// quanti. Sentinella: tests/unit/avvisiDiFiloNellaBarra.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;

const SPIA = `<script>
  window.__visti = [];
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) window.__visti.push(n.outerHTML || n.textContent || '');
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
</script>`;

test('un allegato del feedback che non sale: l\'avviso compare nella barra di Filo col numero, e la pagina davanti non lo vede', async ({ app, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><p>Davanti.</p>${SPIA}</body></html>`);
  const url = page.url();
  await app.evaluate(({ webContents }, { u, mondo }) => {
    const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL() === u);
    return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code: `
      globalThis.__avvisi1509 = [];
      chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'show_toast') globalThis.__avvisi1509.push(m.text); });
      true;` }]);
  }, { u: url, mondo: MONDO_CONTENT_SCRIPT });

  // La coda finta: il server prende il feedback ma due allegati non salgono.
  await app.evaluate(async () => {
    globalThis.SN_FEEDBACK.submit = async () => ({ id: 'prova-1509', seq: 1509, failed: [{ name: 'estratto-conto.pdf' }, { name: 'busta-paga.png' }] });
    await globalThis.SN_FEEDBACK_OUTBOX.enqueue({ text: 'Il tasto indietro non va', name: 'Tasto indietro' });
  });

  const vista = await avvisi();
  const notifica = vista.locator('.shell-notif', { hasText: 'Feedback inviato, ma non sono riuscito a caricare 2 allegati' });
  await expect(notifica).toBeVisible({ timeout: 10_000 });
  await expect(notifica).not.toContainText('estratto-conto');

  const nellaPagina = await page.evaluate(() => document.documentElement.outerHTML + window.__visti.join(' '));
  expect(nellaPagina).not.toContain('non sono riuscito a caricare');
  expect(nellaPagina).not.toContain('estratto-conto');
  const arrivati = await app.evaluate(({ webContents }, { u, mondo }) => {
    const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL() === u);
    return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code: 'globalThis.__avvisi1509' }]);
  }, { u: url, mondo: MONDO_CONTENT_SCRIPT });
  expect(arrivati, 'l\'avviso è arrivato alla scheda del sito').toEqual([]);
});
