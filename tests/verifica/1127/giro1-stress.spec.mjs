// Verifica #1127 giro 1: la coda della riapertura sotto stress (chiusura a metà, clic in fretta, scheda in vista chiusa
// o morta).
import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function serverLento(ritardo) {
  const richieste = [];
  const server = createServer((req, res) => {
    const m = /^\/p\/(\d+)$/.exec(req.url);
    if (!m) { res.writeHead(404); res.end(); return; }
    const r = { n: Number(m[1]), inizio: Date.now(), fine: null };
    richieste.push(r);
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><title>Pagina ${r.n}</title><body><h1>pagina ${r.n}</h1></body>`);
      r.fine = Date.now();
    }, ritardo);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: (n) => `${origin}/p/${n}`,
    richieste,
    prima: (n) => richieste.find((r) => r.n === n) || null,
    chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

function scriviSessione(dati, tabs, attiva) {
  writeFileSync(join(dati, 'storage.json'), JSON.stringify({
    filo_onboarding: { done: true },
    sn_open_tabs: { tabs, colors: tabs.map(() => null), activeIndex: attiva },
  }));
}

const lancia = (dati) => electron.launch({
  args: [...argomentiScala, '.'],
  cwd: APP_ROOT,
  env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test' },
});

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  const tm = win && win._filoTabs;
  return tm ? { attiva: tm.activeId, schede: tm.tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, loading: t.loading })) } : { attiva: null, schede: [] };
});

const caricate = async (app) => (await schede(app)).schede.filter((t) => /^Pagina \d+$/.test(t.title) && !t.loading).length;

test('chiusa a metà coda, Filo riapre tutte le schede e la stessa in vista', async () => {
  test.setTimeout(120_000);
  const srv = await serverLento(1500);
  const dati = cartellaTemporanea('filo-v1127-');
  const urls = Array.from({ length: 12 }, (_, i) => srv.url(i));
  scriviSessione(dati, urls, 7);
  let app = await lancia(dati);
  try {
    await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    await expect.poll(async () => (await schede(app)).schede.length, { timeout: 20_000 }).toBe(12);
    await expect.poll(() => srv.richieste.length >= 2, { timeout: 20_000 }).toBe(true);
    expect(srv.richieste.length).toBeLessThan(12);
    await new Promise((r) => setTimeout(r, 1200));
    await chiudiApp(app);
    const salvata = JSON.parse(readFileSync(join(dati, 'storage.json'), 'utf8')).sn_open_tabs;
    expect(salvata.tabs).toEqual(urls);
    expect(salvata.activeIndex).toBe(7);

    srv.richieste.length = 0;
    app = await lancia(dati);
    await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    await expect.poll(() => caricate(app), { timeout: 60_000 }).toBe(12);
    const s = await schede(app);
    expect(s.schede.map((t) => t.url)).toEqual(urls);
    expect(s.schede.find((t) => t.id === s.attiva).url).toBe(srv.url(7));
    expect(srv.richieste[0].n).toBe(7);
  } finally {
    await chiudiApp(app).catch(() => {});
    await srv.chiudi();
    rmSync(dati, { recursive: true, force: true });
  }
});

test('clic in fretta su tre schede in coda: ognuna mostra la sua pagina, e alla fine sono caricate tutte', async () => {
  test.setTimeout(120_000);
  const srv = await serverLento(1000);
  const dati = cartellaTemporanea('filo-v1127-');
  scriviSessione(dati, Array.from({ length: 10 }, (_, i) => srv.url(i)), 0);
  const app = await lancia(dati);
  try {
    const shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    await expect.poll(async () => (await schede(app)).schede.length, { timeout: 20_000 }).toBe(10);
    const { schede: lista } = await schede(app);
    for (const n of [9, 6, 8]) await shell.locator(`.tab[data-id="${lista[n].id}"]`).click();
    await expect.poll(() => [9, 6, 8].every((n) => srv.prima(n)), { timeout: 5000 }).toBe(true);
    const pagina = await aspettaFinestra(app, (w) => w.url() === srv.url(8), 'la scheda cliccata per ultima non ha una pagina');
    await expect(pagina.locator('h1')).toHaveText('pagina 8');
    await expect.poll(() => caricate(app), { timeout: 60_000 }).toBe(10);
    expect(srv.richieste.length).toBe(10);
  } finally {
    await chiudiApp(app).catch(() => {});
    await srv.chiudi();
    rmSync(dati, { recursive: true, force: true });
  }
});

test('la scheda in vista chiusa mentre carica non ferma la coda', async () => {
  test.setTimeout(120_000);
  const srv = await serverLento(2500);
  const dati = cartellaTemporanea('filo-v1127-');
  scriviSessione(dati, Array.from({ length: 8 }, (_, i) => srv.url(i)), 3);
  const app = await lancia(dati);
  try {
    const shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    await expect.poll(() => Boolean(srv.prima(3)), { timeout: 20_000 }).toBe(true);
    const s = await schede(app);
    await shell.evaluate((id) => window.filoShell.tabs.close(id), s.attiva);
    await expect.poll(async () => (await schede(app)).schede.length).toBe(7);
    await expect.poll(() => caricate(app), { timeout: 60_000 }).toBe(7);
  } finally {
    await chiudiApp(app).catch(() => {});
    await srv.chiudi();
    rmSync(dati, { recursive: true, force: true });
  }
});

test('la scheda in vista su un sito spento non tiene ferme le altre', async () => {
  test.setTimeout(120_000);
  const srv = await serverLento(300);
  const morto = createServer();
  await new Promise((r) => morto.listen(0, '127.0.0.1', r));
  const portaMorta = morto.address().port;
  await new Promise((r) => morto.close(r));
  const dati = cartellaTemporanea('filo-v1127-');
  const urls = [srv.url(0), `http://127.0.0.1:${portaMorta}/giu`, srv.url(2), srv.url(3), srv.url(4)];
  scriviSessione(dati, urls, 1);
  const app = await lancia(dati);
  try {
    await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    const t0 = Date.now();
    await expect.poll(() => caricate(app), { timeout: 30_000 }).toBe(4);
    expect(Date.now() - t0, 'le altre non aspettano il tetto di 15 s').toBeLessThan(12_000);
  } finally {
    await chiudiApp(app).catch(() => {});
    await srv.chiudi();
    rmSync(dati, { recursive: true, force: true });
  }
});
