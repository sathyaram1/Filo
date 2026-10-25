// Verifica #1273 giro 1, porte provate e chiuse: voci di prima (icona come indirizzo), incognito, copie che se ne vanno
// con la voce. Restano come guardia per le correzioni dei giri dopo.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOMI = ['negozio.test', 'blog.test', 'dal-proxy.test', 'img.piattaforma.test'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC', 'base64');

async function sitiFinti() {
  const richieste = [];
  const s = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    richieste.push({ r: `${host}${req.url}`, cookie: req.headers.cookie || '' });
    if (host === 'img.piattaforma.test' || req.url === '/favicon.ico') {
      res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${host}</title><link rel="icon" href="http://img.piattaforma.test:${s.address().port}/${host}.png"><body>${host}</body>`);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { porta: s.address().port, richieste, close: () => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }) };
}

async function avvia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=${NOMI.map((n) => `MAP ${n} 127.0.0.1`).join(', ')}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

async function apri(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => Boolean(page = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } })),
    { timeout: 20_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

const copie = (userData) => { try { return readdirSync(join(userData, 'icone')).filter((n) => /^[0-9a-f]{40}\./.test(n)); } catch (_) { return []; } };

test('voci di prima: l\'icona si chiede una volta senza cookie, quella da proxy mai; riavviato, niente', async () => {
  test.setTimeout(180_000);
  const siti = await sitiFinti();
  const P = siti.porta;
  const userData = cartellaTemporanea('filo-ver1273-');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    savedPages: [
      { id: 's1', url: `http://negozio.test:${P}/dischi`, title: 'Negozio vecchio', favicon: `http://img.piattaforma.test:${P}/negozio-vecchio.png`, savedAt: '2026-09-01T10:00:00.000Z' },
    ],
    archivedTabs: [
      { id: 'a1', url: `http://dal-proxy.test:${P}/pagina`, title: 'Proxy vecchia', favicon: `http://img.piattaforma.test:${P}/proxy-vecchia.png`, proxy: { country: 'us', tier: null }, closedAt: '2026-09-02T10:00:00.000Z', openedAt: '2026-09-02T09:00:00.000Z' },
      { id: 'a2', url: `http://blog.test:${P}/ricetta`, title: 'Blog vecchio', favicon: `http://img.piattaforma.test:${P}/blog-vecchio.png`, proxy: null, closedAt: '2026-09-03T10:00:00.000Z', openedAt: '2026-09-03T09:00:00.000Z' },
    ],
  }), 'utf8');
  let app = null;
  try {
    let shell;
    ({ app, shell } = await avvia(userData));
    const home = await apri(app, shell, 'filo://home/home.html');
    await expect(home.locator('.sn-card', { hasText: 'Negozio vecchio' })).toBeVisible({ timeout: 15_000 });
    await app.evaluate(() => globalThis.__filoIconeVecchie.completa());
    await app.evaluate(() => globalThis.__filoIconeVecchie.completa());
    const icone = siti.richieste.filter((x) => x.r.startsWith('img.piattaforma.test/'));
    expect(icone.map((x) => x.r).sort()).toEqual(['img.piattaforma.test/blog-vecchio.png', 'img.piattaforma.test/negozio-vecchio.png']);
    expect(icone.every((x) => !x.cookie)).toBe(true);
    expect(siti.richieste.filter((x) => x.r.startsWith('dal-proxy.test'))).toEqual([]);
    const voci = await app.evaluate(async () => [...await globalThis.SN_SAVED_PAGES.list(), ...await globalThis.SN_ARCHIVED_TABS.list()]
      .map((v) => ({ id: v.id, favicon: v.favicon, da: v.faviconDaChiedere || '' })));
    expect(voci.find((v) => v.id === 's1').favicon).toMatch(/^filo:\/\/icone\//);
    expect(voci.find((v) => v.id === 'a2').favicon).toMatch(/^filo:\/\/icone\//);
    expect(voci.find((v) => v.id === 'a1')).toEqual({ id: 'a1', favicon: '', da: '' });
    await home.reload();
    await expect(home.locator('.sn-card', { hasText: 'Negozio vecchio' }).locator('.sn-card-domain img')).toHaveAttribute('src', /^filo:\/\/icone\//, { timeout: 10_000 });
    await app.evaluate(async () => { await globalThis.__filoStorage.whenSettled(); globalThis.__filoStorage.flushSync(); });
    await chiudiApp(app);
    app = null;
    const prima = siti.richieste.length;

    ({ app, shell } = await avvia(userData));
    const h2 = await apri(app, shell, 'filo://home/home.html');
    await expect(h2.locator('.sn-card', { hasText: 'Negozio vecchio' }).locator('.sn-card-domain img')).toHaveAttribute('src', /^filo:\/\/icone\//, { timeout: 10_000 });
    const nt = await apri(app, shell, 'filo://newtab/');
    const chip = async (id, url) => {
      await nt.evaluate(({ id, url }) => {
        const el = document.createElement('div'); el.id = id; document.body.appendChild(el);
        window.__filoDashActions.renderActions(el, [{ type: 'NAVIGA', url }]);
      }, { id, url });
    };
    await chip('c1', `http://dal-proxy.test:${P}/altra`);
    await chip('c2', `http://blog.test:${P}/altra`);
    await expect(nt.locator('#c2 img')).toHaveAttribute('src', /^data:image\/png/, { timeout: 10_000 });
    await app.evaluate(() => globalThis.__filoIconeVecchie.completa());
    await nt.waitForTimeout(1500);
    expect(siti.richieste.slice(prima).map((x) => x.r)).toEqual([]);
  } finally {
    if (app) await chiudiApp(app);
    await siti.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('incognito: salvata per dopo, l\'icona resta in memoria e non va su disco', async () => {
  test.setTimeout(120_000);
  const siti = await sitiFinti();
  const userData = cartellaTemporanea('filo-ver1273i-');
  let app = null;
  try {
    let shell;
    ({ app, shell } = await avvia(userData));
    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
    const url = `http://negozio.test:${siti.porta}/privata`;
    await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)._filoTabs.openTab(u), url);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const t = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)._filoTabs.tabs.find((x) => /negozio/.test(x.url || ''));
      return /^data:image/.test((t && t.favicon) || '');
    }), { timeout: 15_000 }).toBe(true);
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs);
      const tab = win._filoTabs.tabs.find((x) => /negozio/.test(x.url || ''));
      await globalThis.__filoShortcuts.saveForLater(win, tab);
    });
    await new Promise((r) => setTimeout(r, 1500));
    expect(copie(userData)).toEqual([]);
    const normali = await app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).length);
    expect(normali).toBe(0);
  } finally {
    if (app) await chiudiApp(app);
    await siti.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('la copia se ne va con la voce: tolta la pagina salvata e svuotato l\'archivio, la cartella torna vuota', async () => {
  test.setTimeout(120_000);
  const siti = await sitiFinti();
  const userData = cartellaTemporanea('filo-ver1273c-');
  let app = null;
  try {
    let shell;
    ({ app, shell } = await avvia(userData));
    const negozio = `http://negozio.test:${siti.porta}/a`;
    const blog = `http://blog.test:${siti.porta}/b`;
    await apri(app, shell, negozio);
    await apri(app, shell, blog);
    const iconaDi = (h) => app.evaluate(({ BrowserWindow }, h) => {
      const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.find((x) => (x.url || '').includes(h));
      return (t && t.favicon) || '';
    }, h);
    await expect.poll(() => iconaDi('negozio.test'), { timeout: 15_000 }).toMatch(/^data:image/);
    await expect.poll(() => iconaDi('blog.test'), { timeout: 15_000 }).toMatch(/^data:image/);
    const dato = await iconaDi('negozio.test');
    await app.evaluate(async (_e, { url, dato }) => globalThis.SN_SAVED_PAGES.save({ url, title: 'N', favicon: dato }), { url: negozio, dato });
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      const t = tm.tabs.find((x) => (x.url || '').includes('blog.test'));
      tm.closeTab(t.id);
    });
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => /blog/.test(t.url) && /^filo:/.test(t.favicon)).length), { timeout: 10_000 }).toBe(1);
    // Il negozio e il blog hanno lo stesso PNG: una copia sola.
    expect(copie(userData).length).toBe(1);
    const id = await app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list())[0].id);
    await app.evaluate(async (_e, id) => globalThis.SN_SAVED_PAGES.remove(id), id);
    await new Promise((r) => setTimeout(r, 2500));
    expect(copie(userData).length, 'l\'archivio usa ancora la stessa copia').toBe(1);
    await app.evaluate(async () => globalThis.SN_ARCHIVED_TABS.clear());
    await expect.poll(() => copie(userData).length, { timeout: 8_000 }).toBe(0);
  } finally {
    if (app) await chiudiApp(app);
    await siti.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
