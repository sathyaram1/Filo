// #1127 — alla riapertura di Filo la scheda in vista si carica per prima e da sola, poi le altre al massimo due alla
// volta partendo dalle vicine; una scheda cliccata mentre aspetta si carica subito; alla fine si sono caricate tutte.
import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const N = 10;

// Ogni pagina risponde dopo `ritardo` ms: il server vede quante ne sono in caricamento nello stesso momento.
async function serverLento(ritardo) {
  const richieste = [];
  let inVolo = 0;
  let picco = 0;
  const server = createServer((req, res) => {
    const m = /^\/p\/(\d+)$/.exec(req.url);
    if (!m) { res.writeHead(404); res.end(); return; }
    const n = Number(m[1]);
    const r = { n, inizio: Date.now(), fine: null };
    richieste.push(r);
    inVolo++;
    picco = Math.max(picco, inVolo);
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><title>Pagina ${n}</title><body><h1>pagina ${n}</h1></body>`);
      inVolo--;
      r.fine = Date.now();
    }, ritardo);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: (n) => `${origin}/p/${n}`,
    richieste,
    picco: () => picco,
    prima: (n) => richieste.find((r) => r.n === n) || null,
    chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

async function apriConSessione(srv, attiva) {
  const dati = cartellaTemporanea('filo-riapertura-');
  const tabs = Array.from({ length: N }, (_, i) => srv.url(i));
  writeFileSync(join(dati, 'storage.json'), JSON.stringify({
    filo_onboarding: { done: true },
    sn_open_tabs: { tabs, colors: tabs.map(() => null), activeIndex: attiva },
  }));
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test' },
  });
  // Dal main, ogni 20 ms: quante schede del server stanno caricando, e quando ognuna ha finito.
  await app.evaluate(({ BrowserWindow }, origin) => {
    const g = globalThis.__riapertura = { picco: 0, finite: {} };
    g.timer = setInterval(() => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      if (!win) return;
      let caricano = 0;
      for (const t of win._filoTabs.tabs) {
        const wc = t.view && t.view.webContents;
        if (!wc || wc.isDestroyed()) continue;
        const u = wc.getURL() || '';
        if (!u.startsWith(origin)) continue;
        if (wc.isLoading()) caricano++;
        else if (!g.finite[u]) g.finite[u] = Date.now();
      }
      g.picco = Math.max(g.picco, caricano);
    }, 20);
  }, srv.origin);
  return { app, dati };
}

const statoMain = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  const tm = win && win._filoTabs;
  return {
    picco: globalThis.__riapertura.picco,
    finite: globalThis.__riapertura.finite,
    attiva: tm ? tm.activeId : null,
    schede: tm ? tm.tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, loading: t.loading })) : [],
  };
});

test('riapertura con 10 schede: prima quella in vista, poi le vicine due alla volta, e alla fine tutte caricate', async () => {
  test.setTimeout(90_000);
  const srv = await serverLento(700);
  const { app, dati } = await apriConSessione(srv, 4);
  try {
    const shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    await expect.poll(async () => (await statoMain(app)).schede.length, { timeout: 20_000 }).toBe(N);

    // Mentre aspetta, la scheda più lontana porta il nome del sito, non «Nuova scheda».
    const { schede } = await statoMain(app);
    const lontana = schede.find((t) => t.url === srv.url(9));
    const host = new URL(srv.origin).host;
    await expect(shell.locator(`.tab[data-id="${lontana.id}"] .title`)).toHaveText(host);
    // Non sta caricando: niente rotella, che farebbe sembrare di nuovo tutte le schede in caricamento insieme.
    await expect(shell.locator(`.tab[data-id="${lontana.id}"] .spinner`)).toHaveCount(0);
    expect(srv.prima(9), 'la scheda più lontana non è ancora partita').toBeNull();
    mkdirSync(SHOTS, { recursive: true });
    await shell.screenshot({ path: join(SHOTS, 'riapertura-coda-in-attesa.png') });

    await expect.poll(async () => {
      const s = await statoMain(app);
      return s.schede.filter((t) => /^Pagina \d$/.test(t.title) && !t.loading).length;
    }, { timeout: 60_000, message: 'tutte e 10 le schede si caricano' }).toBe(N);

    const fine = await statoMain(app);
    const attiva = fine.schede.find((t) => t.id === fine.attiva);
    expect(attiva.url).toBe(srv.url(4));
    expect(srv.richieste.length).toBe(N);
    expect(new Set(srv.richieste.map((r) => r.n)).size).toBe(N);

    // La scheda in vista va da sola: è la prima chiesta al server, e le altre partono dopo che ha finito.
    const ordine = srv.richieste.map((r) => r.n);
    expect(ordine[0]).toBe(4);
    const fineAttiva = fine.finite[srv.url(4)];
    expect(fineAttiva).toBeTruthy();
    for (let n = 0; n < N; n++) {
      if (n === 4) continue;
      expect(srv.prima(n).inizio, `la pagina ${n} parte dopo la fine di quella in vista`).toBeGreaterThanOrEqual(srv.prima(4).fine);
      expect(fine.finite[srv.url(n)], `la pagina ${n} finisce dopo quella in vista`).toBeGreaterThan(fineAttiva);
    }
    // Dalle vicine verso i bordi.
    expect(new Set(ordine.slice(1, 3))).toEqual(new Set([3, 5]));
    expect(new Set(ordine.slice(-3, -1))).toEqual(new Set([0, 8]));
    expect(ordine[N - 1]).toBe(9);

    expect(srv.picco(), 'mai più di due pagine chieste insieme').toBeLessThanOrEqual(2);
    expect(fine.picco, 'mai più di due schede in caricamento insieme').toBeLessThanOrEqual(2);
    expect(fine.picco).toBe(2);
  } finally {
    await chiudiApp(app).catch(() => {});
    await srv.chiudi();
    rmSync(dati, { recursive: true, force: true });
  }
});

test('una scheda cliccata mentre aspetta in coda si carica subito, prima di quelle che la precedevano', async () => {
  test.setTimeout(90_000);
  const srv = await serverLento(1200);
  const { app, dati } = await apriConSessione(srv, 0);
  try {
    const shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    // In volo la prima coppia dopo quella in vista: la 9 è l'ultima della coda.
    await expect.poll(() => Boolean(srv.prima(1) && srv.prima(2)), { timeout: 30_000 }).toBe(true);
    const { schede } = await statoMain(app);
    const nona = schede.find((t) => t.url === srv.url(9));
    expect(srv.prima(9)).toBeNull();
    const clic = Date.now();
    await shell.locator(`.tab[data-id="${nona.id}"]`).click();

    await expect.poll(() => Boolean(srv.prima(9)), { timeout: 5000, message: 'la scheda cliccata parte subito' }).toBe(true);
    expect(srv.prima(9).inizio - clic).toBeLessThan(1000);
    expect(srv.prima(3), 'la cliccata non aspetta quelle che la precedevano').toBeNull();

    const pagina = await aspettaFinestra(app, (w) => w.url() === srv.url(9), 'la scheda cliccata non ha una pagina');
    await expect(pagina.locator('h1')).toHaveText('pagina 9');
    await expect(shell.locator(`.tab[data-id="${nona.id}"]`)).toHaveClass(/active/);

    await expect.poll(async () => {
      const s = await statoMain(app);
      return s.schede.filter((t) => /^Pagina \d$/.test(t.title) && !t.loading).length;
    }, { timeout: 60_000, message: 'alla fine tutte e 10 le schede si caricano' }).toBe(N);
    // Finché la cliccata carica non ne parte un'altra: la 3 arriva solo dopo che la 9 ha avuto la sua pagina.
    expect(srv.prima(3).inizio).toBeGreaterThanOrEqual(srv.prima(9).fine);
    expect(srv.richieste.length).toBe(N);
  } finally {
    await chiudiApp(app).catch(() => {});
    await srv.chiudi();
    rmSync(dati, { recursive: true, force: true });
  }
});
