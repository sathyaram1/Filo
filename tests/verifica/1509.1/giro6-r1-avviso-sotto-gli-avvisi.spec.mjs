// Verifica #1509.1 giro 6, rilievo 1: con un avviso della barra in basso a destra (un download finito), l'avviso di
// un riquadro di Filo aperto sopra un sito («Grazie! Feedback inviato») deve salire sopra di lui, come quando il
// riquadro stava nella pagina; nello strato resta in fondo e finisce coperto dalla carta del download.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, nelloStrato, statoDi, clicca, conta, paginaDelloStrato } from '../../helpers/riquadri.mjs';

test('r1 feedback inviato da un sito con un download appena finito: il grazie si vede sopra la carta del download', async ({ app, shell, avvisi, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.submit = async (payload) => ({ id: 'test_' + (payload && payload.submissionId), failed: [] });
  });
  const p = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;padding:40px"><p>Una pagina qualunque.</p></body></html>');
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'report.pdf' })).toHaveCount(1);

  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  const sopra = await paginaDelloStrato(app, p);
  await clicca(app, p, '.sn-fb-text');
  await sopra.keyboard.insertText('una prova di invio dal sito');
  await clicca(app, p, '.sn-fb-send');
  await expect.poll(() => conta(app, p, '.sn-fb-modal'), { timeout: 15_000 }).toBe(0);

  const GRAZIE = () => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    const tutti = T ? T.trovaTutti('.sn-toast') : document.querySelectorAll('.sn-toast');
    const el = [...tutti].find((x) => /Feedback inviato/.test(x.textContent || ''));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  };
  let grazie = null;
  let inStrato = false;
  await expect.poll(async () => {
    grazie = await nelMondoDiFilo(app, p, GRAZIE);
    inStrato = false;
    if (!grazie) { grazie = await nelloStrato(app, p, GRAZIE); inStrato = !!grazie; }
    return !!grazie;
  }, { timeout: 8000 }).toBe(true);
  await p.waitForTimeout(600);
  grazie = inStrato ? await nelloStrato(app, p, GRAZIE) : await nelMondoDiFilo(app, p, GRAZIE);

  // Tutto in px della finestra: la vista della scheda (o dello strato) e la carta del download.
  const { scheda, carta } = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const v = w.contentView.children.find((c) => { try { return c.webContents.getURL().includes('avvisi.html'); } catch (_) { return false; } });
    return { scheda: t.view.getBounds(), carta: v.getBounds() };
  });
  const fondo = grazie.bottom + scheda.y;
  const destra = grazie.right + scheda.x;
  expect(fondo <= carta.y + 1 || destra <= carta.x + 1,
    `il grazie (fondo ${fondo}, destra ${destra}) sta sotto la vista degli avvisi della barra (${JSON.stringify(carta)})`).toBe(true);
});
