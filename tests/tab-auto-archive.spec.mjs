// Auto-archiviazione / riordino tab (spec §2.1, §2.3) — orchestrazione.
//
// La decisione LLM viene STUBBATA (niente chiave/rete nei test): verifichiamo
// che, date le decisioni, il TabManager archivi le tab giuste, NON tocchi la
// scheda attiva, le metta nell'archivio e mostri il toast. Più: il ripristino
// dello scroll alla riapertura dall'archivio.

import { test, expect } from './fixtures/electron.mjs';

const mk = (title, color, h = 1500) =>
  `<!doctype html><html><head><title>${title}</title>${color ? `<meta name="theme-color" content="${color}">` : ''}</head>`
  + `<body style="margin:0"><div style="height:${h}px;background:#fff"></div></body></html>`;

test('runAutoTriage archivia le tab decise, tiene la attiva e mostra il toast', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Alpha', 'rgb(200,40,40)'));
  await testServer.openReady(openTab, mk('Bravo', 'rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Charlie', '')); // ultima → attiva

  // Stub della decisione LLM nel main: archivia SOLO il primo candidato.
  const res = await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: i === 0 ? 'archive' : 'keep', reason: 'test' })),
    });
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.runAutoTriage({ trigger: 'test' });
  });
  expect(res.archived).toBe(1);

  // Il primo candidato web non-attivo è "Alpha": ora non è più tra le tab aperte.
  const titles = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.map((t) => t.title);
  });
  expect(titles).not.toContain('Alpha');
  expect(titles).toContain('Bravo');
  expect(titles).toContain('Charlie');

  // È finita nell'archivio.
  const archived = await app.evaluate(async () => await globalThis.SN_ARCHIVED_TABS.list());
  expect(archived.some((x) => /Alpha/.test(x.title || ''))).toBe(true);

  // La scheda attiva è ancora aperta (mai archiviata).
  const activeTitle = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const a = s.tabs.find((t) => t.id === s.activeId);
    return a ? a.title : null;
  });
  expect(activeTitle).toBe('Charlie');

  // Toast §2.3 mostrato nella shell.
  await expect.poll(() => shell.evaluate(() => {
    const el = document.getElementById('shell-toast');
    return !!(el && el.classList.contains('show') && /cronologia/i.test(el.textContent || ''));
  }), { timeout: 6_000 }).toBe(true);
});

test('riaprire una scheda dall’archivio ripristina la posizione di scroll', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mk('Lunga', '', 4000));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);

  // Scrolla in fondo → scrollPct alto.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => shell.evaluate(async (i) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => x.id === i);
    return t ? t.scrollPct : 0;
  }, id), { timeout: 8_000 }).toBeGreaterThan(50);

  // Chiudi (→ archiviata con la sua scrollPosition) e ottieni l'URL salvato.
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  const url = await app.evaluate(async ({ BrowserWindow }) => {
    const list = await globalThis.SN_ARCHIVED_TABS.list();
    const e = list.find((x) => /Lunga/.test(x.title || ''));
    if (!e) return null;
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.openTab(e.url, { activate: true, restoreScrollPct: e.scrollPosition });
    return e.url;
  });
  expect(url).toBeTruthy();

  // La pagina riaperta torna scrollata (non da capo).
  await expect.poll(async () => {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (!p) return 0;
    try { return await p.evaluate(() => window.scrollY); } catch (_) { return 0; }
  }, { timeout: 10_000 }).toBeGreaterThan(100);
});

test('l’agente può lanciare la pulizia su richiesta (RUN_TAB_TRIAGE)', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Uno', 'rgb(200,40,40)'));
  await testServer.openReady(openTab, mk('Due', 'rgb(40,80,200)'));
  // La pagina dalla quale parte la richiesta (dashboard) diventa attiva e interna.
  const dash = await openTab('filo://newtab/');

  // Stub: archivia tutti i candidati (le due tab web).
  await app.evaluate(async () => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
  });

  // L'agente, dopo conferma, manda RUN_TAB_TRIAGE: lo simuliamo dalla pagina.
  const res = await dash.evaluate(async () =>
    await chrome.runtime.sendMessage({ type: 'run_tab_triage' }));
  expect(res.ok).toBe(true);
  expect(res.archived).toBeGreaterThanOrEqual(2);

  // Le due tab web non ci sono più; la dashboard (attiva, interna) resta.
  const titles = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.map((t) => t.title);
  });
  expect(titles).not.toContain('Uno');
  expect(titles).not.toContain('Due');
});
