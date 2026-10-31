// Verifica #1488 giro 2: la percentuale di un video a pezzi quando il sito non dà il peso esatto di ogni pezzo.
// Il programma finto scrive l'elenco dei pezzi e l'avanzamento come yt-dlp 2026.10.26 (provato col vero su un DASH).
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const base = cartellaTemporanea('filo-verifica-1488-g2-');
const caso = join(base, 'caso.json');
const ilCaso = (c) => { mkdirSync(base, { recursive: true }); writeFileSync(caso, JSON.stringify(c)); };

test.use({
  envInPiu: {
    FILO_YTDLP_COMANDO: JSON.stringify([require('electron'), join(process.cwd(), 'tests', 'verifica', '1488', 'ytdlpComeIlVero.mjs')]),
    FILO_YTDLP_FINTO_CASO: caso,
  },
});
test.afterAll(() => { togliCartella(base); });

const PAGINA = `<!doctype html><html><head><title>Canzone della segnalazione - YouTube</title></head>
  <body style="margin:0;padding:24px"><video id="v" width="480" height="270" style="background:#222"></video>
  <script>const ms = new MediaSource(); document.getElementById('v').src = URL.createObjectURL(ms);</script></body></html>`;

async function salvaEGuarda(shell, page) {
  await expect.poll(() => page.evaluate(() => document.getElementById('v').src.startsWith('blob:'))).toBe(true);
  await page.locator('#v').click({ button: 'right', position: { x: 40, y: 40 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Salva video come' }).click();
  const viste = [];
  const fine = Date.now() + 40_000;
  for (;;) {
    const items = ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
    const v = items.find((x) => x.via === 'streaming');
    if (v && v.totalBytes > 0 && v.state === 'progressing') viste.push({ p: Math.round((100 * v.receivedBytes) / v.totalBytes), r: v.receivedBytes });
    if ((v && v.state !== 'progressing') || Date.now() > fine) break;
    await page.waitForTimeout(60);
  }
  return viste;
}

test('r1 se il sito non dà il peso esatto del video, la barra non arriva al 100% quando ne è sceso un terzo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  ilCaso({ titolo: 'Canzone della segnalazione', pausaMs: 100, passi: 12,
    pesi: { 137: { circa: 290 * 1024 }, 140: { esatto: 60 * 1024, circa: 58 * 1024 } } });
  const page = await testServer.openReady(openTab, PAGINA);
  const viste = await salvaEGuarda(shell, page);
  expect(viste.length).toBeGreaterThan(3);
  const pieneTroppoPresto = viste.filter((v) => v.p >= 99 && v.r < 300 * 1024);
  expect(pieneTroppoPresto, `percentuali viste: ${viste.map((v) => `${v.p}%@${Math.round(v.r / 1024)}K`).join(' ')}`).toEqual([]);
});

test('r1 su un video a frammenti col peso solo stimato la percentuale non torna indietro', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  ilCaso({ titolo: 'Canzone della segnalazione', pausaMs: 100, passi: 12, stima: true, pesi: { 137: {}, 140: {} } });
  const page = await testServer.openReady(openTab, PAGINA);
  const viste = await salvaEGuarda(shell, page);
  expect(viste.length).toBeGreaterThan(3);
  const cali = viste.filter((v, i) => i > 0 && v.p < viste[i - 1].p - 1);
  expect(cali, `percentuali viste: ${viste.map((v) => v.p).join(' ')}`).toEqual([]);
});
