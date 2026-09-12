// Verifica #586, giro 3 — ESPLORAZIONE (non è una guardia): che forma ha una
// richiesta media quando la pagina chiede l'audio del computer, e cosa arriva
// in mano a chi dice sì. Serve a capire dove guardare; le guardie vere stanno
// negli altri spec del giro.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p>prova</p>
<script>
  const descrivi = (s) => s.getTracks().map((t) => ({ kind: t.kind, label: t.label }));
  const chiedi = (v) => navigator.mediaDevices.getUserMedia(v).then(
    (s) => { const d = descrivi(s); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'),
  );
  window.__soloAudioDesktop = () => chiedi({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
  });
  window.__audioDesktopPiuWebcam = () => chiedi({
    audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: true,
  });
  window.__displayConAudio = () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(
    (s) => { const d = descrivi(s); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'),
  );
</script></body></html>`;

test('esplorazione: forme di richiesta e cosa arriva', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);

  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');

  // 1 — solo audio del computer, strada vecchia
  const p1 = page.evaluate(() => window.__soloAudioDesktop());
  await page.waitForTimeout(2500);
  const c1 = await chip.count();
  const t1 = c1 ? (await chip.allTextContents())[0] : '(nessuna domanda)';
  if (c1) await chip.first().locator('.perm-chip-allow').click();
  const e1 = await p1;
  console.log('[586 g3] SOLO AUDIO DESKTOP → domanda:', JSON.stringify(t1), 'esito:', JSON.stringify(e1));

  await page.waitForTimeout(500);
  const dopo1 = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  console.log('[586 g3] memoria dopo solo-audio:', JSON.stringify(dopo1));

  // Ripuliamo la memoria per la prova dopo.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ security: { sitePermissions: {} } });
    require('./services/permessiSito').configureFromSettings(await globalThis.SN_STORAGE.getSettings());
  }).catch(() => {});

  // 2 — audio del computer + webcam nella stessa chiamata
  const p2 = page.evaluate(() => window.__audioDesktopPiuWebcam());
  await page.waitForTimeout(2500);
  const c2 = await chip.count();
  const t2 = c2 ? (await chip.allTextContents())[0] : '(nessuna domanda)';
  if (c2) await chip.first().locator('.perm-chip-allow').click();
  const e2 = await p2;
  console.log('[586 g3] AUDIO DESKTOP + WEBCAM → domanda:', JSON.stringify(t2), 'esito:', JSON.stringify(e2));

  const dopo2 = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  console.log('[586 g3] memoria dopo audio+webcam:', JSON.stringify(dopo2));

  // 3 — getDisplayMedia con audio: cosa dice il riquadro della scelta, e cosa
  // arriva (una traccia audio di sistema sarebbe "anche ti ascolto").
  const p3 = page.evaluate(() => window.__displayConAudio());
  await page.waitForTimeout(2500);
  const c3 = await chip.count();
  const t3 = c3 ? (await chip.allTextContents())[0] : '(nessuna domanda)';
  if (c3) await chip.first().locator('.perm-chip-allow').click();
  const box = shell.locator('.perm-source');
  let testoBox = '(nessun riquadro)';
  if (await box.count()) {
    testoBox = (await box.first().textContent()) || '';
    await box.first().locator('.perm-source-item').first().click();
  }
  const e3 = await p3;
  console.log('[586 g3] DISPLAY CON AUDIO → domanda:', JSON.stringify(t3),
    'riquadro:', JSON.stringify(testoBox), 'esito:', JSON.stringify(e3));

  expect(true).toBe(true);
});
