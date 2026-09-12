// Esplorazione giro 4 — due cose che si leggono senza sensori: l'elenco dei
// caratteri installati e i nomi dei dispositivi audio/video.
import { test } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<button id="b" style="font-size:20px">premi</button>
<script>
  window.__esito = null;
  document.getElementById('b').addEventListener('click', async () => {
    const out = {};
    try { const f = await window.queryLocalFonts(); out.fonts = { n: f.length, primi: f.slice(0, 5).map((x) => x.fullName) }; }
    catch (e) { out.fonts = 'no: ' + e.name + ' ' + e.message; }
    try { const d = await navigator.mediaDevices.enumerateDevices();
      out.dispositivi = d.map((x) => x.kind + '|' + x.label + '|' + (x.deviceId || '').slice(0, 8)); }
    catch (e) { out.dispositivi = 'no: ' + e.name; }
    window.__esito = out;
  });
</script></body></html>`;

test('caratteri installati e nomi dei dispositivi, con un gesto vero', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  await page.click('#b');
  await shell.waitForTimeout(2500);
  console.log('[586 g4] pastiglie comparse:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  await page.waitForTimeout(1500);
  console.log('[586 g4] esito:', JSON.stringify(await page.evaluate(() => window.__esito)));
});
