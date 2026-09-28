// Verifica #586 giro 13, rilievo 5: prima di ogni scelta il sito legge «negato» invece di «da chiedere».
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><title>Guarda</title></head><body>
<script>
  window.stato = async () => {
    const out = { notifiche: Notification.permission };
    for (const n of ['camera', 'microphone', 'geolocation']) {
      try { out[n] = (await navigator.permissions.query({ name: n })).state; } catch (e) { out[n] = 'err'; }
    }
    return out;
  };
</script></body></html>`;

test('un sito a cui nessuno ha mai risposto legge «da chiedere», non «negato»', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const s = await page.evaluate(() => window.stato());
  expect(s, 'il sito legge già negato quello che nessuno ha negato').toEqual({
    notifiche: 'default', camera: 'prompt', microphone: 'prompt', geolocation: 'prompt',
  });
});
