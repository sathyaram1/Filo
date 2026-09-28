// Verifica #591, giro 14 — chi naviga dietro un proxy della rete locale (ufficio, casa con un filtro) vede ogni sito
// come «rete di casa»: l'indirizzo da cui la pagina ha risposto è quello del proxy, e i controlli sui siti pericolosi
// (elenco delle truffe, età del dominio, modello, finestra nascosta) non partono più per nessun sito.
// Serve un indirizzo privato della macchina per il proxy: se non c'è, la prova guarda solo l'indirizzo annotato.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer, request } from 'node:http';
import { networkInterfaces } from 'node:os';

const PRIVATO = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
function indirizzoPrivato() {
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && PRIVATO.test(i.address)) return i.address;
  }
  return null;
}

// Un proxy HTTP minimo: inoltra la richiesta con indirizzo assoluto al server di prova.
async function avviaProxy(host, versoPorta) {
  const proxy = createServer((req, res) => {
    const u = new URL(req.url);
    const fw = request({ host: '127.0.0.1', port: versoPorta, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    fw.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(fw);
  });
  await new Promise((ok) => proxy.listen(0, host, ok));
  return proxy;
}

const PAGINA = '<!doctype html><title>Accedi</title><form><input type="email"><input type="password"><button>Entra</button></form>';

async function controlliPartiti(app, openTab, url, proxyRules) {
  await app.evaluate(async ({ webContents, session }, regole) => {
    globalThis.__g14 = { fuori: [], annotati: [] };
    const SB = globalThis.SN_SAFEBROWSE;
    for (const c of Object.values(SB._caches || {})) if (c && c.m) c.m.clear();
    SB.setProviders({
      gsb: async (u) => { globalThis.__g14.fuori.push('elenco truffe ' + u); return null; },
      rdap: async (r) => { globalThis.__g14.fuori.push('età ' + r); return null; },
      ct: async (r) => { globalThis.__g14.fuori.push('certificati ' + r); return null; },
      llm: async (m) => { globalThis.__g14.fuori.push('modello ' + m.host); return null; },
      sandbox: async (u) => { globalThis.__g14.fuori.push('finestra nascosta ' + u); return null; },
    });
    const Nav = globalThis.SN_URL_NAV;
    if (!Nav.__g14) {
      const orig = Nav.noteHostAddress;
      Nav.noteHostAddress = (h, ip) => { globalThis.__g14.annotati.push(`${h} ${ip}`); return orig(h, ip); };
      Nav.__g14 = true;
    }
    const sessioni = new Set([session.defaultSession, ...webContents.getAllWebContents().map((w) => w.session)]);
    for (const s of sessioni) await s.setProxy(regole ? { proxyRules: regole } : { mode: 'direct' });
  }, proxyRules);
  const page = await openTab(url);
  await page.waitForTimeout(1500);
  const esito = await app.evaluate(() => globalThis.__g14);
  await page.close().catch(() => {});
  return esito;
}

test('dietro un proxy della rete locale un sito di internet riceve ancora i controlli', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html(PAGINA, { pubblico: true });
  const porta = Number(new URL(testServer.origin).port);
  const host = new URL(url).hostname;

  const diretto = await controlliPartiti(app, openTab, url, null);
  expect(diretto.fuori.length, 'caso di riscontro: senza proxy il sito riceve i controlli').toBeGreaterThan(0);

  const privato = indirizzoPrivato();
  const proxy = await avviaProxy(privato || '127.0.0.1', porta);
  try {
    const regole = `http=${privato || '127.0.0.1'}:${proxy.address().port}`;
    const dietro = await controlliPartiti(app, openTab, url.replace(/\/(\d+)$/, '/$1?via=proxy'), regole);
    const annotato = dietro.annotati.filter((r) => r.startsWith(host + ' ')).pop() || '';
    expect.soft(annotato.endsWith(' ' + (privato || '127.0.0.1')),
      `l'indirizzo annotato per ${host} non deve essere quello del proxy (${annotato})`).toBe(false);
    if (privato) {
      expect(dietro.fuori.length, `dietro il proxy ${privato} lo stesso sito di internet non riceve nessun controllo`).toBeGreaterThan(0);
    }
  } finally {
    await new Promise((ok) => proxy.close(ok));
  }
});

// La stessa causa lascia un segno che resta: la scheda chiusa dietro il proxy finisce in archivio come «di casa»,
// quindi non viene mai riassunta né indicizzata, e la ricerca per significato non la trova neanche dopo.
async function archiviataComeCasa(app, shell, openTab, url, proxyRules) {
  await app.evaluate(async ({ webContents, session }, regole) => {
    const sessioni = new Set([session.defaultSession, ...webContents.getAllWebContents().map((w) => w.session)]);
    for (const s of sessioni) await s.setProxy(regole ? { proxyRules: regole } : { mode: 'direct' });
  }, proxyRules);
  await openTab(url);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (tid) => window.filoShell.tabs.close(tid), id);
  let voce = null;
  const fine = Date.now() + 8000;
  while (!voce && Date.now() < fine) {
    voce = await app.evaluate(async (_e, u) => ((await globalThis.SN_ARCHIVED_TABS.list()) || []).find((t) => t.url === u) || null, url);
    if (!voce) await new Promise((ok) => setTimeout(ok, 200));
  }
  await new Promise((ok) => setTimeout(ok, 800));
  voce = await app.evaluate(async (_e, u) => ((await globalThis.SN_ARCHIVED_TABS.list()) || []).find((t) => t.url === u) || null, url);
  return voce ? Boolean(voce.casa) : null;
}

test('una scheda di internet chiusa dietro un proxy della rete locale non finisce in archivio come pagina di casa', async ({ app, shell, openTab, testServer }) => {
  const privato = indirizzoPrivato();
  test.skip(!privato, 'serve un indirizzo privato della macchina su cui mettere il proxy');
  const porta = Number(new URL(testServer.origin).port);
  const pagina = '<!doctype html><title>Ricetta della focaccia</title><p>Farina, acqua, olio, sale.</p>';

  expect(await archiviataComeCasa(app, shell, openTab, testServer.html(pagina, { pubblico: true }), null),
    'caso di riscontro: senza proxy la scheda non è di casa').toBe(false);

  const proxy = await avviaProxy(privato, porta);
  try {
    const regole = `http=${privato}:${proxy.address().port}`;
    expect(await archiviataComeCasa(app, shell, openTab, testServer.html(pagina, { pubblico: true }), regole),
      `dietro il proxy ${privato} la stessa scheda viene archiviata come rete di casa`).toBe(false);
  } finally {
    await new Promise((ok) => proxy.close(ok));
  }
});
