// Esplorazione: quale indirizzo arriva al programma (riquadro incorporato, navigazione da SPA).
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const base = cartellaTemporanea('filo-esplora-1488-');
mkdirSync(base, { recursive: true });
const caso = join(base, 'caso.json');
const registro = join(base, 'registro.jsonl');
writeFileSync(caso, JSON.stringify({ titolo: 'X', pausaMs: 20, passi: 2 }));
test.use({ envInPiu: {
  FILO_YTDLP_COMANDO: JSON.stringify([require('electron'), join(process.cwd(), 'tests', 'helpers', 'ytdlpFinto.mjs')]),
  FILO_YTDLP_FINTO_CASO: caso, FILO_YTDLP_FINTO_REGISTRO: registro,
} });
const ultimoUrl = () => { if (!existsSync(registro)) return ''; const r = readFileSync(registro, 'utf8').trim().split('\n'); const a = JSON.parse(r[r.length - 1]).argv; return a[a.length - 1]; };

test('riquadro incorporato', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><title>Top</title><iframe id="f" src="http://127.0.0.1:8765/mse.html" width="400" height="300"></iframe>');
  const f = page.frameLocator('#f');
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  const fr = page.frames().find((x) => x.url().includes('8765'));
  await expect.poll(() => fr.evaluate(() => document.getElementById('v').src.startsWith('blob:'))).toBe(true);
  await f.locator('#v').click({ button: 'right', position: { x: 40, y: 40 } });
  const voce = menuDi(fr).locator('.sn-menu button', { hasText: 'Salva video come' });
  await expect(voce).toBeVisible();
  await voce.click();
  await expect.poll(ultimoUrl, { timeout: 15000 }).not.toBe('');
  console.log('URL IFRAME', ultimoUrl());
});

test('navigazione da SPA', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Home</title><video id="v" width="480" height="270" style="background:#222"></video>
    <script>const ms = new MediaSource(); document.getElementById('v').src = URL.createObjectURL(ms);</script>`);
  await page.evaluate(() => history.pushState({}, '', location.pathname + '?v=ABCDEF'));
  await expect.poll(() => page.evaluate(() => document.getElementById('v').src.startsWith('blob:'))).toBe(true);
  await page.locator('#v').click({ button: 'right', position: { x: 40, y: 40 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Salva video come' }).click();
  await expect.poll(ultimoUrl, { timeout: 15000 }).toContain('v=ABCDEF');
});
