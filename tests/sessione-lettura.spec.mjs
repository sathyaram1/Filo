// #349.1 — un articolo lasciato a metà resta a metà dopo un riavvio di Filo: la sessione salva fin dove era arrivata la
// lettura, la pagina riaperta riparte da lì e la pulizia della riapertura riceve quella posizione.

import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paragrafi = Array.from({ length: 120 }, (_, i) => `<p>Paragrafo ${i + 1} dell'articolo lungo, letto con calma.</p>`).join('');
const ARTICOLO = `<title>Articolo lungo</title><body style="margin:0;font:18px serif">${paragrafi}</body>`;

const lancia = (userData) => electron.launch({
  args: [...argomentiScala, '.'],
  cwd: RADICE,
  env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
});

const statoScheda = (app, host) => app.evaluate(async ({ BrowserWindow }, h) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)?._filoTabs;
  const t = tm && tm.tabs.find((x) => { try { return new URL(x.url).hostname === h; } catch (_) { return false; } });
  if (!t) return null;
  const [giudizio] = await tm._gatherTriageInput([t]);
  return { scrollPct: t.scrollPct, alGiudizio: giudizio.scrollPct, rinviata: !!t._rinviata };
}, host);

test('un articolo letto a metà riparte da lì dopo il riavvio, e la pulizia lo sa', async ({ testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html(ARTICOLO);
  const host = new URL(url).hostname;
  const userData = cartellaTemporanea('filo-lettura-');
  let app;
  try {
    app = await lancia(userData);
    const shell = await primaFinestra(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const pagina = await aspettaFinestra(app, (w) => new URL(w.url()).hostname === host, 'la pagina dell’articolo');
    await pagina.waitForLoadState('load');
    await pagina.mouse.move(200, 200);
    const meta = await pagina.evaluate(() => (document.documentElement.scrollHeight - innerHeight) / 2);
    for (let fatto = 0; fatto < meta; fatto += 400) await pagina.mouse.wheel(0, Math.min(400, meta - fatto));
    await expect.poll(async () => (await statoScheda(app, host))?.scrollPct, { message: 'Filo deve sapere che è a metà' })
      .toBeGreaterThanOrEqual(40);
    const letta = (await statoScheda(app, host)).scrollPct;
    expect(letta).toBeLessThanOrEqual(60);
    // Un'altra scheda in primo piano, come nei passi della segnalazione: l'articolo resta dietro.
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    await new Promise((r) => setTimeout(r, 1000));
    await chiudiApp(app);
    app = null;

    app = await lancia(userData);
    await primaFinestra(app);
    // Prima che la pagina riaperta si carichi, il giudizio ha già la lettura salvata.
    await expect.poll(() => statoScheda(app, host), { timeout: 30_000 }).not.toBeNull();
    expect((await statoScheda(app, host)).alGiudizio).toBe(letta);

    await app.evaluate(({ BrowserWindow }, h) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.activate(tm.tabs.find((x) => new URL(x.url).hostname === h).id);
    }, host);
    const riaperta = await aspettaFinestra(app, (w) => new URL(w.url()).hostname === host, 'l’articolo riaperto');
    await riaperta.waitForLoadState('load');
    await expect.poll(() => riaperta.evaluate(() => Math.round(scrollY / (document.documentElement.scrollHeight - innerHeight) * 100)),
      { message: 'l’articolo deve ripartire dal punto in cui era' }).toBeGreaterThanOrEqual(letta - 3);
    expect(await riaperta.evaluate(() => Math.round(scrollY / (document.documentElement.scrollHeight - innerHeight) * 100)))
      .toBeLessThanOrEqual(letta + 3);
    expect((await statoScheda(app, host)).alGiudizio).toBe(letta);

    // Toccata dall'utente, la posizione che conta torna quella vera.
    await riaperta.mouse.move(200, 200);
    for (let i = 0; i < 30; i++) await riaperta.mouse.wheel(0, -400);
    await expect.poll(async () => (await statoScheda(app, host)).alGiudizio).toBeLessThan(5);
  } finally {
    if (app) await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});
