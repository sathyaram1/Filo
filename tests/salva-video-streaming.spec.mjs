// #1488 — «Salva video come…» su un video in streaming (un <video> che legge da MediaSource, come YouTube) salva il
// video invece di dire che non c'è un file. Il programma è un yt-dlp finto (tests/helpers/ytdlpFinto.mjs): quello
// vero non gira nelle prove, e non si è potuto provare su YouTube vero. Logica e programmi: tests/unit/ytdlp*.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const SHOTS = join(process.cwd(), 'tests', '.shots');
const base = cartellaTemporanea('filo-ytdlp-finto-');
const caso = join(base, 'caso.json');
const registro = join(base, 'registro.jsonl');
const ilCaso = (c) => writeFileSync(caso, JSON.stringify(c));

test.use({
  envInPiu: {
    // L'Electron delle prove fa da Node per lo script finto, come quello di Filo fa da runtime per yt-dlp.
    FILO_YTDLP_COMANDO: JSON.stringify([require('electron'), join(process.cwd(), 'tests', 'helpers', 'ytdlpFinto.mjs')]),
    FILO_YTDLP_FINTO_CASO: caso,
    FILO_YTDLP_FINTO_REGISTRO: registro,
  },
});

// Il lettore dei grandi siti: il <video> legge da un MediaSource, e il suo src è un blob: che fetch non apre.
const PAGINA = `<!doctype html><html><head><title>(2) Canzone della segnalazione - YouTube</title></head>
  <body style="margin:0;padding:24px;font:16px sans-serif">
  <video id="v" width="480" height="270" style="background:#222"></video>
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

test.beforeAll(() => { mkdirSync(base, { recursive: true }); mkdirSync(SHOTS, { recursive: true }); });

test('dal tasto destro il video in streaming arriva nella cartella, col titolo del video', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  ilCaso({ titolo: 'Canzone della segnalazione', pausaMs: 120, passi: 12 });
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);

  // Mentre scende, la pagina Download dice cosa sta facendo, con la percentuale.
  const dl = await openTab('filo://downloads/downloads.html');
  const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'Canzone della segnalazione' }) });
  await expect(riga.locator('.dl-meta')).toHaveText(/(In corso|Unisco video e audio) · \d+% · /, { timeout: 15000 });
  await dl.screenshot({ path: join(SHOTS, 'salva-video-streaming-in-corso.png') });

  await expect.poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 30000 }).toContain('Canzone della segnalazione.mp4');
  expect(statSync(join(dir, 'Canzone della segnalazione.mp4')).size).toBe(360 * 1024);
  await expect(page.locator('.sn-toast', { hasText: 'Video salvato' })).toBeVisible({ timeout: 15000 });
  const v = (await elenco(shell)).find((x) => x.filename === 'Canzone della segnalazione.mp4');
  expect(v.state).toBe('completed');
  expect(v.via).toBe('streaming');
  expect(v.url).toBe(page.url());
  await expect(riga.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible();
  // Niente cartelle di lavoro dimenticate fra i Download dell'utente.
  expect(readdirSync(dir).filter((n) => n.startsWith('.filo-video-'))).toEqual([]);
});

test('un video con limite d\'età dice perché non si salva, e da «Riprova» riparte nella stessa riga', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  ilCaso({ errore: 'Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication.' });
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);
  const avviso = page.locator('.sn-toast', { hasText: 'limite d\'età' });
  await expect(avviso).toBeVisible({ timeout: 15000 });
  await expect(avviso).toContainText('non usa il tuo account');
  await expect(avviso).toContainText('Google');
  await page.screenshot({ path: join(SHOTS, 'salva-video-streaming-eta.png') });

  const dl = await openTab('filo://downloads/downloads.html');
  const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'Canzone della segnalazione' }) });
  await expect(riga.locator('.dl-meta')).toContainText('Interrotto · Il video ha un limite d\'età');
  await dl.screenshot({ path: join(SHOTS, 'salva-video-streaming-riga-eta.png') });

  // Il video torna disponibile (per esempio il sito toglie il limite): «Riprova» lo salva, senza aprire la pagina.
  ilCaso({ titolo: 'Canzone della segnalazione', pausaMs: 20 });
  const prima = (await elenco(shell)).filter((x) => x.via === 'streaming').length;
  await riga.locator('.dl-btn', { hasText: 'Riprova' }).click();
  await expect(riga.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible({ timeout: 20000 });
  expect(statSync(join(dir, 'Canzone della segnalazione.mp4')).size).toBe(360 * 1024);
  expect((await elenco(shell)).filter((x) => x.via === 'streaming').length).toBe(prima);
});

test('«Annulla» dai Download ferma il salvataggio e non lascia file', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  ilCaso({ titolo: 'Video lunghissimo', pausaMs: 200, passi: 300 });
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);
  const dl = await openTab('filo://downloads/downloads.html');
  const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'Video lunghissimo' }) });
  await expect(riga.locator('.dl-meta')).toHaveText(/In corso · \d+% · /, { timeout: 15000 });
  await riga.locator('.dl-btn', { hasText: 'Annulla' }).click();
  await expect.poll(async () => (await elenco(shell)).find((x) => x.filename === 'Video lunghissimo.mp4')?.state, { timeout: 10000 }).toBe('cancelled');
  await expect.poll(() => readdirSync(dir).filter((n) => n.startsWith('.filo-video-') || n.startsWith('Video lunghissimo')), { timeout: 10000 }).toEqual([]);
  // Nessun avviso d'errore per un annullo voluto.
  await expect(page.locator('.sn-toast', { hasText: 'Non sono riuscito' })).toHaveCount(0);
});
