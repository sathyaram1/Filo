// #1509.1 — Quello che l'utente scrive o seleziona in un riquadro di Filo sopra un sito non lo legge il sito: né dalla
// selezione (selectionchange, getSelection), né dalla copia, né con la ricerca testuale del browser.
// Regola: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from './helpers/riquadri.mjs';

const SEGRETO = 'zibaldone-segreto-1509 del mio conto';

// Lo script del sito: annota ogni selezione e ogni copia, e cerca il testo con la ricerca del browser.
const SPIA = `<script>
  window.__letti = [];
  const leggi = () => { try { const s = String(getSelection()); if (s) window.__letti.push(s); } catch (_) {} };
  document.addEventListener('selectionchange', leggi, true);
  for (const t of ['copy', 'cut', 'selectstart', 'keyup', 'mouseup']) window.addEventListener(t, leggi, true);
  setInterval(leggi, 50);
  window.trova = (s) => { try { getSelection().removeAllRanges(); } catch (_) {} return window.find(s, false, false, true); };
</script>`;
const pagina = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p>Un sito qualunque</p>${SPIA}</body></html>`;

test('il feedback aperto su un sito: scritto, selezionato tutto e copiato, il sito non legge niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina);
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  const strato = await scrivi(app, p, '.sn-fb-text', SEGRETO);
  expect((await statoDi(app, p, '.sn-fb-text')).valore).toBe(SEGRETO);
  await strato.keyboard.press('ControlOrMeta+A');
  await strato.keyboard.press('ControlOrMeta+C');
  await p.waitForTimeout(400);
  const letti = await p.evaluate(() => window.__letti.join(' | '));
  expect(letti).not.toContain('zibaldone');
  expect(await p.evaluate((s) => window.trova(s), 'zibaldone-segreto')).toBe(false);
});
