// Verifica #586, giro 1 — «condividi lo schermo» e cosa si consente davvero.
//
// Prima della correzione, chi premeva «condividi lo schermo» si vedeva
// comparire «vuole usare la fotocamera e il microfono»: Chromium manda al
// browser una richiesta audio/video con la lista dei tipi vuota prima di
// passare alla cattura vera, e Filo la leggeva come una richiesta di webcam e
// microfono. Consentendo, quei due sensori restavano concessi per SEMPRE, e da
// lì il sito li accendeva senza che comparisse più niente.
//
// Qui si asserisce il comportamento giusto:
//   • una domanda sola, e dice lo schermo;
//   • non resta scritto niente (lo schermo si richiede ogni volta);
//   • la webcam resta da chiedere;
//   • si sceglie cosa condividere.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0">
<button id="b" style="font:16px sans-serif;padding:20px">condividi lo schermo</button>
<script>
  document.getElementById('b').addEventListener('click', () => {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} window.__r = 'ok'; },
      (e) => { window.__r = (e && e.name) ? e.name : 'errore'; },
    );
  });
  window.__webcam = () => {
    window.__cam = navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'ok'; },
            (e) => (e && e.name) ? e.name : 'errore');
  };
  window.__stato = async (n) => {
    try { return (await navigator.permissions.query({ name: n })).state; } catch (_) { return 'n/d'; }
  };
</script>
</body></html>`;

test('chiedere lo schermo chiede lo schermo, e non lascia scritto niente', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, HTML);
  const origine = new URL(page.url()).origin;
  const chip = shell.locator('.perm-chip');

  await page.click('#b');
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  const scritta = (await chip.allTextContents())[0];
  // eslint-disable-next-line no-console
  console.log('[586] domanda comparsa per «condividi lo schermo»:', JSON.stringify(scritta));
  expect(scritta, 'la domanda deve parlare dello schermo, non di fotocamera e microfono').toContain('schermo');
  expect(scritta).not.toContain('fotocamera');

  await chip.locator('.perm-chip-allow').click();

  // Dopo il consenso si sceglie COSA: tutto lo schermo o una finestra sola.
  const scelta = shell.locator('.perm-source');
  await expect(scelta).toHaveCount(1, { timeout: 15_000 });
  const voci = await scelta.locator('.perm-source-item').count();
  // eslint-disable-next-line no-console
  console.log('[586] cose fra cui scegliere:', voci);
  expect(voci, 'niente fra cui scegliere: si consegnerebbe sempre lo schermo intero').toBeGreaterThan(0);

  // Nessuna seconda domanda, e nessuna traccia di fotocamera o microfono.
  await expect(chip).toHaveCount(0, { timeout: 8_000 });
  await scelta.locator('.perm-source-cancel').click();
  await expect(scelta).toHaveCount(0, { timeout: 8_000 });
  await page.waitForTimeout(1000);

  const ricordato = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  // eslint-disable-next-line no-console
  console.log('[586] cosa resta scritto:', JSON.stringify(ricordato[origine] || null));
  expect(
    ricordato[origine],
    'dopo una condivisione dello schermo non deve restare scritto niente: nemmeno lo schermo, '
    + 'che si richiede ogni volta, e men che meno fotocamera e microfono',
  ).toBeUndefined();

  // La webcam è ancora tutta da chiedere.
  expect(await page.evaluate(() => window.__stato('camera'))).toBe('prompt');
  await page.evaluate(() => window.__webcam());
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await expect(chip).toContainText('fotocamera');
});
