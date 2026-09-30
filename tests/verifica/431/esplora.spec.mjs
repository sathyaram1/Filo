// Verifica #431 (esplorazione): avviso audio sulla scheda come in Chrome.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/verifica-431';
mkdirSync(SHOTS, { recursive: true });

const FAV = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');

async function patch(app, patchById) {
  return app.evaluate(({ BrowserWindow }, patchById) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    for (const t of w._filoTabs.tabs) if (patchById[t.id]) Object.assign(t, patchById[t.id]);
    w._filoTabs._broadcast();
  }, patchById);
}
async function webIds(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || '')).map((t) => t.id);
  });
}
function geo(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('.tab')].map((tab) => {
    const r = tab.getBoundingClientRect();
    const figli = [...tab.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => {
      const q = c.getBoundingClientRect();
      return { cls: c.className.split(' ')[0], left: Math.round(q.left - r.left), w: Math.round(q.width), color: getComputedStyle(c).color, op: getComputedStyle(c).opacity };
    });
    return { id: tab.dataset.id, active: tab.classList.contains('active'), w: Math.round(r.width), figli, color: getComputedStyle(tab).color };
  }));
}
const frame = (shell) => shell.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('scheda YouTube che suona, chiaro e scuro', async ({ app, shell, openTab, testServer }) => {
  for (const t of ['YouTube', 'Rick Astley - Never Gonna Give You Up (Official Music Video) - YouTube', 'Gmail']) {
    await openTab(testServer.html(`<title>${t}</title><link rel="icon" href="${FAV}"><h1>x</h1>`));
  }
  const ids = await webIds(app);
  await patch(app, { [ids[0]]: { audible: true, favicon: FAV }, [ids[1]]: { audible: true, favicon: FAV }, [ids[2]]: { muted: true, favicon: FAV } });
  await expect(shell.locator('.tab .tab-alert')).toHaveCount(3, { timeout: 10_000 });
  await frame(shell);
  for (const scheme of ['light', 'dark']) {
    await shell.emulateMedia({ colorScheme: scheme });
    await frame(shell);
    await shell.screenshot({ path: `${SHOTS}/normale-${scheme}.png`, clip: { x: 0, y: 0, width: 1100, height: 48 } });
    const g = await geo(shell);
    console.log(scheme, JSON.stringify(g, null, 0));
    for (const s of g.filter((x) => ids.includes(x.id))) {
      const ordine = s.figli.map((f) => f.cls);
      expect(ordine.slice(0, 1)).toEqual(['favicon']);
      expect(ordine.indexOf('tab-alert')).toBeGreaterThan(ordine.indexOf('title'));
      const a = s.figli.find((f) => f.cls === 'tab-alert');
      const ti = s.figli.find((f) => f.cls === 'title');
      expect(a.color).toBe(ti.color);
    }
  }
  // attiva la YouTube che suona: colore del sito e scritte per contrasto
  await patch(app, { [ids[1]]: { color: 'rgb(255,0,0)', identityColor: 'rgb(255,0,0)' } });
  await shell.locator(`.tab[data-id="${ids[1]}"] .title`).click();
  await expect(shell.locator(`.tab[data-id="${ids[1]}"]`)).toHaveClass(/active/);
  await frame(shell);
  await shell.screenshot({ path: `${SHOTS}/attiva-rossa.png`, clip: { x: 0, y: 0, width: 1100, height: 48 } });
  const s = (await geo(shell)).find((x) => x.id === ids[1]);
  console.log('attiva', JSON.stringify(s));
  expect(s.figli.find((f) => f.cls === 'tab-alert').color).toBe(s.figli.find((f) => f.cls === 'title').color);
});

test('tante schede, finestra ridimensionata', async ({ app, shell, testServer }) => {
  for (let i = 0; i < 22; i++) {
    const u = testServer.html(`<title>Scheda numero ${i} con un titolo lungo</title><link rel="icon" href="${FAV}">`);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), u);
  }
  await expect.poll(async () => (await webIds(app)).length, { timeout: 20_000 }).toBe(22);
  const ids = await webIds(app);
  const suonano = [ids[0], ids[5], ids[21]];
  const p = {};
  for (const id of ids) p[id] = { favicon: FAV, loading: false };
  for (const id of suonano) p[id].audible = true;
  p[ids[10]].muted = true;
  await patch(app, p);
  await expect(shell.locator('.tab .tab-alert')).toHaveCount(4, { timeout: 10_000 });
  for (const W of [1600, 1280, 1000, 800, 640]) {
    await app.evaluate(({ BrowserWindow }, W) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      w.setSize(W, 700);
    }, W);
    await frame(shell); await frame(shell);
    await new Promise((r) => setTimeout(r, 300));
    await shell.screenshot({ path: `${SHOTS}/tante-${W}.png`, clip: { x: 0, y: 0, width: Math.min(W, 1600), height: 48 } });
    const g = await geo(shell);
    const conAvviso = g.filter((s) => s.figli.some((f) => f.cls === 'tab-alert'));
    console.log(W, JSON.stringify(conAvviso.map((s) => [s.w, s.active, s.figli.map((f) => `${f.cls}@${f.left}/${f.w}`).join(' ')])));
    for (const s of conAvviso) {
      const a = s.figli.find((f) => f.cls === 'tab-alert');
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.left + a.w).toBeLessThanOrEqual(s.w);
      expect(a.w).toBe(16);
      const fav = s.figli.find((f) => f.cls === 'favicon');
      if (s.w >= 56) expect(!!fav, JSON.stringify(s)).toBe(true);
    }
  }
});

test('clic sull\'avviso di una scheda in secondo piano: muta senza portarla davanti', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html(`<title>Musica</title>`));
  await openTab(testServer.html(`<title>Lavoro</title>`));
  const ids = await webIds(app);
  await patch(app, { [ids[0]]: { audible: true } });
  const tab = shell.locator(`.tab[data-id="${ids[0]}"]`);
  await expect(tab.locator('.audio-ind')).toHaveCount(1, { timeout: 10_000 });
  await expect(tab).not.toHaveClass(/active/);
  await tab.locator('.audio-ind').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return !!w._filoTabs.tabs.find((x) => x.id === id).muted;
  }, ids[0]), { timeout: 10_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 300));
  await expect(tab).not.toHaveClass(/active/);
});

test('passando sull\'avviso il suggerimento di Filo dice cosa fa il clic', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(({ ipcMain }) => {
    globalThis.__tips431 = [];
    ipcMain.on('shell:tooltip-show', (_e, d) => globalThis.__tips431.push(d && d.text));
  });
  await openTab(testServer.html(`<title>Musica di sottofondo</title>`));
  const ids = await webIds(app);
  await patch(app, { [ids[0]]: { audible: true } });
  const tab = shell.locator(`.tab[data-id="${ids[0]}"]`);
  await expect(tab.locator('.audio-ind')).toHaveCount(1, { timeout: 10_000 });
  await shell.mouse.move(5, 80);
  await tab.locator('.audio-ind').hover();
  await new Promise((r) => setTimeout(r, 900));
  const tips = await app.evaluate(() => globalThis.__tips431);
  const nativo = await tab.locator('.audio-ind').getAttribute('title');
  console.log('tips', JSON.stringify(tips), 'nativo', nativo);
  expect(tips[tips.length - 1]).toMatch(/Silenzia/);
});

test('stress: titoli strani, caricamento, accendi e spegni in fretta', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html(`<title>x</title>`));
  await openTab(testServer.html(`<title>b</title>`));
  const ids = await webIds(app);
  for (let i = 0; i < 30; i++) await patch(app, { [ids[0]]: { audible: i % 2 === 0 } });
  await patch(app, { [ids[0]]: { audible: true, title: '🎵🎶 <b>ciao</b> مرحبا بالعالم '.repeat(8), loading: true } });
  await patch(app, { [ids[1]]: { audible: true, title: '', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
  await expect(shell.locator('.tab .tab-alert')).toHaveCount(2, { timeout: 10_000 });
  await frame(shell);
  await shell.screenshot({ path: `${SHOTS}/stress.png`, clip: { x: 0, y: 0, width: 1100, height: 48 } });
  const g = await geo(shell);
  console.log('stress', JSON.stringify(g));
  for (const s of g.filter((x) => ids.includes(x.id))) {
    const ordine = s.figli.map((f) => f.cls);
    expect(ordine.indexOf('tab-alert')).toBeGreaterThan(ordine.indexOf('title'));
    const a = s.figli.find((f) => f.cls === 'tab-alert');
    expect(a.left + a.w).toBeLessThanOrEqual(s.w);
  }
  await expect(shell.locator('.tab b')).toHaveCount(0);
});
