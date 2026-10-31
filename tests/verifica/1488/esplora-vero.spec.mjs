// Esplorazione: il yt-dlp e l'ffmpeg veri, su una pagina con un <video> da MediaSource e un og:video DASH.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const S = process.env.ESPLORA_DIR;
test.use({ envInPiu: { FILO_YTDLP_COMANDO: JSON.stringify([join(S, 'pv', 'yt-dlp-767ba9dce705')]), FILO_FFMPEG: join(S, 'pv', 'ffmpeg-b6.1.1') } });

test('vero: dal tasto destro il video arriva', async ({ app, openTab, testServer, avvisi }) => {
  test.setTimeout(90_000);
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>(3) Canzone vera - YouTube</title>
    <meta property="og:video" content="http://127.0.0.1:8765/dash/out.mpd"></head><body>
    <video id="v" width="480" height="270" style="background:#222"></video>
    <script>const ms = new MediaSource(); document.getElementById('v').src = URL.createObjectURL(ms);</script></body></html>`);
  await expect.poll(() => page.evaluate(() => document.getElementById('v').src.startsWith('blob:'))).toBe(true);
  await page.locator('#v').click({ button: 'right', position: { x: 40, y: 40 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Salva video come' }).click();
  await expect.poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 60000 }).toContain('Canzone vera.mp4');
  console.log('FILES', readdirSync(dir), statSync(join(dir, 'Canzone vera.mp4')).size);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif', { hasText: 'Scaricato' }).last()).toBeVisible({ timeout: 15000 });
});
