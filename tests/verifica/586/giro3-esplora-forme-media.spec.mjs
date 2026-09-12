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

async function memoria(app) {
  return app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
}

test('esplorazione: audio del computer + webcam nella stessa chiamata', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');

  const p = page.evaluate(() => window.__audioDesktopPiuWebcam()).catch((e) => 'esploso:' + e.message);
  await shell.waitForTimeout(3000);
  const c = await chip.count();
  const t = c ? (await chip.allTextContents())[0] : '(nessuna domanda)';
  if (c) await chip.first().locator('.perm-chip-allow').click();
  const e = await p;
  console.log('[586 g3] AUDIO DESKTOP + WEBCAM → domanda:', JSON.stringify(t), 'esito:', JSON.stringify(e));
  await shell.waitForTimeout(800);
  console.log('[586 g3] memoria:', JSON.stringify(await memoria(app)));
  expect(true).toBe(true);
});

test('esplorazione: getDisplayMedia chiedendo anche l\'audio', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');

  const p = page.evaluate(() => window.__displayConAudio()).catch((e) => 'esploso:' + e.message);
  await shell.waitForTimeout(3000);
  const c = await chip.count();
  const t = c ? (await chip.allTextContents())[0] : '(nessuna domanda)';
  if (c) await chip.first().locator('.perm-chip-allow').click();
  const box = shell.locator('.perm-source');
  let testoBox = '(nessun riquadro)';
  await shell.waitForTimeout(1500);
  if (await box.count()) {
    testoBox = (await box.first().textContent()) || '';
    await box.first().locator('.perm-source-item').first().click();
  }
  const e = await p;
  console.log('[586 g3] DISPLAY CON AUDIO → domanda:', JSON.stringify(t),
    'riquadro:', JSON.stringify(testoBox), 'esito:', JSON.stringify(e));
  await shell.waitForTimeout(800);
  console.log('[586 g3] memoria:', JSON.stringify(await memoria(app)));
  console.log('[586 g3] segno ripresa:', await shell.locator('.perm-live').count());
  expect(true).toBe(true);
});

test('esplorazione: solo audio del computer, strada vecchia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');

  const p = page.evaluate(() => window.__soloAudioDesktop()).catch((e) => 'esploso:' + e.message);
  await shell.waitForTimeout(3000);
  const c = await chip.count();
  const t = c ? (await chip.allTextContents())[0] : '(nessuna domanda)';
  if (c) await chip.first().locator('.perm-chip-allow').click();
  const e = await p;
  console.log('[586 g3] SOLO AUDIO DESKTOP → domanda:', JSON.stringify(t), 'esito:', JSON.stringify(e));
  await shell.waitForTimeout(800);
  console.log('[586 g3] memoria:', JSON.stringify(await memoria(app)));
  expect(true).toBe(true);
});
