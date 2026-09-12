// Verifica #586, giro 1 — «condividi lo schermo» e cosa si consente davvero.
//
// Un sito che chiede di riprendere lo schermo fa comparire una domanda. Due
// cose da controllare:
//   a) la domanda dice la cosa giusta? Chi legge sta per dare una cosa sola, e
//      deve essere quella scritta;
//   b) cosa resta scritto dopo il «Consenti»: se resta un «sempre», la volta
//      dopo il sito riprende lo schermo senza che compaia niente — e una
//      ripresa dello schermo, a differenza della webcam accesa, non si vede.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0">
<button id="b" style="font:16px sans-serif;padding:20px">condividi lo schermo</button>
<script>
  window.__n = 0;
  document.getElementById('b').addEventListener('click', () => {
    window.__n += 1;
    const i = window.__n;
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} window['__r' + i] = 'ok'; },
      (e) => { window['__r' + i] = (e && e.name) ? e.name : 'errore'; },
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

test('chiedere lo schermo fa comparire una domanda su fotocamera e microfono', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, HTML);
  const origine = new URL(page.url()).origin;
  const chip = shell.locator('.perm-chip');

  await page.click('#b');
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  const scritta = (await chip.allTextContents())[0];
  // eslint-disable-next-line no-console
  console.log('[586] domanda comparsa per «condividi lo schermo»:', JSON.stringify(scritta));

  // Si preme «Consenti» pensando di dare quello che c'è scritto.
  await chip.locator('.perm-chip-allow').click();
  await expect(chip).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(1500);

  const ricordato = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  // eslint-disable-next-line no-console
  console.log('[586] cosa resta scritto:', JSON.stringify(ricordato[origine]));

  // Da qui: il sito può accendere webcam e microfono senza che compaia niente?
  await page.evaluate(() => window.__webcam());
  await page.waitForTimeout(1500);
  const domandeWebcam = await chip.count();
  const esitoWebcam = await page.evaluate(() => window.__cam);
  const statoCam = await page.evaluate(() => window.__stato('camera'));
  // eslint-disable-next-line no-console
  console.log('[586] dopo il consenso — webcam:', esitoWebcam, 'stato camera:', statoCam,
    'domande comparse:', domandeWebcam);

  expect(
    scritta,
    'il sito ha chiesto di riprendere lo schermo e la domanda parla di fotocamera e microfono: '
    + 'chi legge sta consentendo una cosa diversa da quella che gli viene mostrata',
  ).toContain('schermo');

  expect(
    ricordato[origine],
    'dopo aver consentito una condivisione dello schermo restano scritti come «sempre» '
    + 'la fotocamera e il microfono: da lì il sito può accenderli quando vuole senza chiedere',
  ).not.toHaveProperty('fotocamera', 'allow');
});
