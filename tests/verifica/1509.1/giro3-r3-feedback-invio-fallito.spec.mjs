// #1509.1 giro 3, r3 — Feedback su un sito con lo screenshot armato: se l'invio non riesce il riquadro resta aperto
// con l'errore, e la tastiera deve restare a lui, non passare alla pagina coperta.

import { test, expect } from '../../fixtures/electron.mjs';
import { conta, nelMondoDiFilo, neiRiquadri, clicca } from '../../helpers/riquadri.mjs';

test('r3 invio del feedback non riuscito: si continua a scrivere nel feedback', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, '<!doctype html><body><p>pagina</p><input id="campo"></body>');
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => conta(app, p, '.sn-fb-overlay')).toBe(1);
  // L'invio risponde di no (per esempio la cifratura che non si può fare).
  await neiRiquadri(app, p, () => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => (m && m.type === 'submit_feedback' ? Promise.resolve({ ok: false, error: 'rete giù' }) : orig(m, ...r));
    return true;
  });
  await clicca(app, p, '.sn-fb-text');
  await clicca(app, p, '.sn-fb-clear');
  await clicca(app, p, '.sn-fb-text');
  await clicca(app, p, '.sn-fb-send');
  await expect.poll(async () => neiRiquadri(app, p, () => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    const el = T ? T.trova('.sn-fb-status') : document.querySelector('.sn-fb-status');
    return el ? el.textContent : '';
  })).toContain('rete giù');
  await p.waitForTimeout(500);
  // La tastiera è ancora del feedback: chi riprova scrive lì, non nel campo della pagina sotto.
  const dove = await app.evaluate(({ webContents }) => String(webContents.getFocusedWebContents()?.getURL() || ''));
  expect(dove).toMatch(/^filo:\/\/riquadri\//);
});
