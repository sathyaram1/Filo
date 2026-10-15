// #1128 dopo il riallineamento con #1127: con la home pronta accesa, la riapertura a coda carica ancora prima la scheda
// in vista e poi le altre due alla volta; la home pronta non entra fra le schede né nella coda, e Ctrl+T la consegna.
import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const N = 6;

async function serverLento(ritardo) {
  const richieste = [];
  let inVolo = 0;
  let picco = 0;
  const server = createServer((req, res) => {
    const m = /^\/p\/(\d+)$/.exec(req.url);
    if (!m) { res.writeHead(404); res.end(); return; }
    const r = { n: Number(m[1]), inizio: Date.now(), fine: null };
    richieste.push(r);
    inVolo++;
    picco = Math.max(picco, inVolo);
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><title>Pagina ${r.n}</title><body><h1>pagina ${r.n}</h1></body>`);
      inVolo--;
      r.fine = Date.now();
    }, ritardo);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: (n) => `${origin}/p/${n}`,
    richieste,
    picco: () => picco,
    prima: (n) => richieste.find((r) => r.n === n) || null,
    chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const r = tm.riserva;
  const wc = r && r.webContents();
  return {
    attiva: tm.activeId,
    schede: tm.tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, loading: t.loading, wcId: t.view.webContents.id })),
    sessione: tm.sessionState().tabs,
    riserva: wc ? { wcId: wc.id, url: wc.getURL(), caricando: wc.isLoading() } : null,
  };
});

test('riapertura con la home pronta accesa: coda intatta, riserva fuori dalle schede, Ctrl+T la consegna', async () => {
  test.setTimeout(120_000);
  const srv = await serverLento(600);
  const dati = cartellaTemporanea('filo-1128-coda-');
  const tabs = Array.from({ length: N }, (_, i) => srv.url(i));
  writeFileSync(join(dati, 'storage.json'), JSON.stringify({
    filo_onboarding: { done: true },
    sn_open_tabs: { tabs, colors: tabs.map(() => null), activeIndex: 2 },
  }));
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test', FILO_RISERVA_NUOVA_SCHEDA: '1' },
  });
  try {
    const shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    await expect.poll(async () => {
      const s = await stato(app);
      return s.schede.filter((t) => /^Pagina \d$/.test(t.title) && !t.loading).length;
    }, { timeout: 60_000, message: 'tutte le schede si caricano' }).toBe(N);

    expect(srv.richieste[0].n, 'la scheda in vista è la prima chiesta').toBe(2);
    for (let n = 0; n < N; n++) {
      if (n === 2) continue;
      expect(srv.prima(n).inizio).toBeGreaterThanOrEqual(srv.prima(2).fine);
    }
    expect(srv.picco()).toBeLessThanOrEqual(2);
    expect(srv.richieste.length).toBe(N);

    let s = null;
    await expect.poll(async () => {
      s = await stato(app);
      return !!(s.riserva && s.riserva.url === 'filo://newtab/' && !s.riserva.caricando);
    }, { timeout: 20_000, message: 'la home pronta c\'è anche dopo la riapertura' }).toBe(true);
    expect(s.schede).toHaveLength(N);
    expect(s.sessione).toEqual(tabs);
    expect(s.schede.some((t) => t.wcId === s.riserva.wcId)).toBe(false);
    await expect(shell.locator('#tabs .tab')).toHaveCount(N);

    const riservaWc = s.riserva.wcId;
    await shell.keyboard.press('Control+t');
    await expect.poll(async () => {
      const x = await stato(app);
      const a = x.schede.find((t) => t.id === x.attiva);
      return a && a.wcId;
    }, { timeout: 5_000, message: 'Ctrl+T consegna la home pronta' }).toBe(riservaWc);
    await expect.poll(async () => {
      const x = await stato(app);
      return !!(x.riserva && x.riserva.wcId !== riservaWc && x.riserva.url === 'filo://newtab/');
    }, { timeout: 20_000, message: 'la home pronta rinasce' }).toBe(true);
    await expect(shell.locator('#tabs .tab')).toHaveCount(N + 1);
  } finally {
    await chiudiApp(app).catch(() => {});
    await srv.chiudi();
    rmSync(dati, { recursive: true, force: true });
  }
});
