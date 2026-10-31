// Esplorazione giro 2: il yt-dlp vero (2026.10.26) su un DASH locale lento, dentro Filo. Non resta nel ramo.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const S = '/tmp/claude-0/-home-user-Filo/68bf8829-f6d0-5652-87bb-8e7197216a51/scratchpad';
test.use({ envInPiu: { FILO_YTDLP_COMANDO: JSON.stringify([join(S, 'venv/bin/yt-dlp')]), FILO_FFMPEG: '/usr/bin/ffmpeg' } });

let srv; let porta;
test.beforeAll(async () => {
  srv = createServer(async (req, res) => {
    const f = join(S, 'srv', decodeURIComponent(req.url.split('?')[0]));
    if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
    const b = readFileSync(f);
    res.writeHead(200, { 'Content-Length': b.length });
    for (let i = 0; i < b.length; i += 32 * 1024) { res.write(b.subarray(i, i + 32 * 1024)); await new Promise((r) => setTimeout(r, 40)); }
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  porta = srv.address().port;
});
test.afterAll(() => srv && srv.close());

const PAGINA = (mpd) => `<!doctype html><html><head><title>Concerto dal vivo - YouTube</title>
  <meta property="og:video" content="${mpd}"></head>
  <body style="margin:0;padding:24px"><video id="v" width="480" height="270" style="background:#222"></video>
  <script>const ms = new MediaSource(); document.getElementById('v').src = URL.createObjectURL(ms);</script></body></html>`;

test('esplora: il programma vero salva un DASH a pezzi', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA(`http://127.0.0.1:${porta}/dash2/manifest.mpd`));
  await page.locator('#v').click({ button: 'right', position: { x: 40, y: 40 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Salva video come' }).click();
  const dl = await openTab('filo://downloads/downloads.html');
  const viste = [];
  const fine = Date.now() + 150_000;
  let ultima = '';
  mkdirSync(join(process.cwd(), 'tests', '.shots'), { recursive: true });
  let foto = 0;
  for (;;) {
    const items = ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
    const v = items.find((x) => x.via === 'streaming');
    const meta = await dl.locator('.dl-item .dl-meta').first().textContent().catch(() => '');
    if (meta !== ultima) { viste.push(`${v?.state}|${v?.receivedBytes}/${v?.totalBytes}|${meta}`); ultima = meta; }
    if (foto < 3 && v && v.receivedBytes > (foto + 1) * 1e6) { await dl.screenshot({ path: join(process.cwd(), 'tests', '.shots', `g2-reale-${foto}.png`) }); foto++; }
    if ((v && /completed|interrupted|failed|cancelled/.test(v.state)) || Date.now() > fine) break;
    await page.waitForTimeout(150);
  }
  console.log(viste.join('\n'));
  console.log('cartella', readdirSync(dir));
  await dl.screenshot({ path: join(process.cwd(), 'tests', '.shots', 'g2-reale-fine.png') });
});
