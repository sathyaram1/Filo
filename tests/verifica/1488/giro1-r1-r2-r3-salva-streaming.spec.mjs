// Verifica #1488 giro 1: «Salva video come…» su un video in streaming, col programma finto che parla come il vero.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const base = cartellaTemporanea('filo-verifica-1488-');
const caso = join(base, 'caso.json');
const registro = join(base, 'registro.jsonl');
const ilCaso = (c) => { mkdirSync(base, { recursive: true }); writeFileSync(caso, JSON.stringify(c)); writeFileSync(registro, ''); };
const righe = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((r) => JSON.parse(r)) : []);

test.use({
  envInPiu: {
    FILO_YTDLP_COMANDO: JSON.stringify([require('electron'), join(process.cwd(), 'tests', 'verifica', '1488', 'ytdlpComeIlVero.mjs')]),
    FILO_YTDLP_FINTO_CASO: caso,
    FILO_YTDLP_FINTO_REGISTRO: registro,
  },
});
test.afterAll(() => { togliCartella(base); });

const PAGINA = (dentro = '') => `<!doctype html><html><head><title>(2) Canzone della segnalazione - YouTube</title></head>
  <body style="margin:0;padding:24px;font:16px sans-serif"><div id="movie_player">
  <video id="v" width="480" height="270" style="background:#222"></video>${dentro}</div>
  <script>const ms = new MediaSource(); document.getElementById('v').src = URL.createObjectURL(ms);</script>
  </body></html>`;

async function salvaDalMenu(page) {
  await expect.poll(() => page.evaluate(() => document.getElementById('v').src.startsWith('blob:'))).toBe(true);
  await page.locator('#v').click({ button: 'right', position: { x: 40, y: 40 } });
  const voce = menuDi(page).locator('.sn-menu button', { hasText: 'Salva video come' });
  await expect(voce).toBeVisible();
  await voce.click();
}
const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };

test('r1 la percentuale di un video a pezzi separati non arriva al 100% per poi tornare indietro', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  ilCaso({ titolo: 'Canzone della segnalazione', pausaMs: 120, passi: 10, pausaFraPezzi: 1500 });
  const page = await testServer.openReady(openTab, PAGINA());
  await salvaDalMenu(page);
  const viste = [];
  const fine = Date.now() + 40_000;
  for (;;) {
    const v = (await elenco(shell)).find((x) => x.via === 'streaming');
    if (v && v.totalBytes > 0 && v.state === 'progressing') viste.push(Math.round((100 * v.receivedBytes) / v.totalBytes));
    if ((v && v.state === 'completed') || Date.now() > fine) break;
    await page.waitForTimeout(80);
  }
  expect(viste.length).toBeGreaterThan(3);
  const cali = viste.filter((p, i) => i > 0 && p < viste[i - 1] - 1);
  expect(cali, `percentuali viste: ${viste.join(' ')}`).toEqual([]);
});

test('r2 chiudere Filo mentre un video in streaming scende ferma il programma e non lascia cartelle nei Download', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  ilCaso({ titolo: 'Video lunghissimo', pausaMs: 200, passi: 300 });
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA());
  await salvaDalMenu(page);
  await expect.poll(async () => (await elenco(shell)).find((x) => x.via === 'streaming')?.receivedBytes || 0, { timeout: 15000 }).toBeGreaterThan(0);
  const pid = righe().find((r) => r.pid)?.pid;
  expect(pid).toBeTruthy();
  await app.close();
  try {
    await expect.poll(() => vivo(pid), { timeout: 8000, message: 'il programma scarica ancora dopo la chiusura di Filo' }).toBe(false);
    expect(readdirSync(dir).filter((n) => n.startsWith('.filo-video-'))).toEqual([]);
  } finally {
    if (vivo(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
  }
});

test('r3 il video di un canale salva quel video, senza scorrere tutto il canale', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  ilCaso({ lista: 30, pausaMs: 30, passi: 3 });
  const page = await testServer.openReady(openTab, PAGINA('<a class="ytp-title-link" href="/watch?v=TRAILER">Il trailer del canale</a>'));
  await page.evaluate(() => history.pushState({}, '', '/@canale'));
  await salvaDalMenu(page);
  await expect.poll(async () => (await elenco(shell)).find((x) => x.via === 'streaming')?.state, { timeout: 30000 }).toMatch(/completed|interrupted|failed/);
  await page.waitForTimeout(1500);
  const voci = righe().filter((r) => r.voce).length;
  expect(voci, 'video del canale letti dal programma').toBeLessThanOrEqual(1);
});
