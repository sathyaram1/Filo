// Verifica #591, giro 14 — chi naviga dietro un proxy della rete locale (ufficio, casa con un filtro) vede ogni sito
// come «rete di casa»: l'indirizzo da cui la pagina ha risposto è quello del proxy, e i controlli sui siti pericolosi
// (elenco delle truffe, età del dominio, modello, finestra nascosta) non partono più per nessun sito.
// Il proxy sta su un indirizzo privato della macchina (quello della LAN); nel contenitore delle routine, che non ne ha,
// la prova ne aggiunge uno al loopback (10.99.0.1), altrimenti si salta.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer, request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';

const PRIVATO = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
function trovaPrivato() {
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && PRIVATO.test(i.address)) return i.address;
  }
  return null;
}
const ALIAS = `import socket,fcntl,struct
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
fcntl.ioctl(s.fileno(),0x8916,struct.pack('16sH2s4s8s',b'lo:1',socket.AF_INET,b'\\0'*2,socket.inet_aton('10.99.0.1'),b'\\0'*8))`;
function indirizzoPrivato() {
  const c = trovaPrivato();
  if (c || process.platform !== 'linux' || !process.env.FILO_ROUTINE || process.getuid?.() !== 0) return c;
  try { execFileSync('python3', ['-c', ALIAS], { stdio: 'ignore' }); } catch (_) {}
  return trovaPrivato();
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
    globalThis.__g14 = { fuori: [] };
    const SB = globalThis.SN_SAFEBROWSE;
    for (const c of Object.values(SB._caches || {})) if (c && c.m) c.m.clear();
    SB.setProviders({
      gsb: async (u) => { globalThis.__g14.fuori.push('elenco truffe ' + u); return null; },
      rdap: async (r) => { globalThis.__g14.fuori.push('età ' + r); return null; },
      ct: async (r) => { globalThis.__g14.fuori.push('certificati ' + r); return null; },
      llm: async (m) => { globalThis.__g14.fuori.push('modello ' + m.host); return null; },
      sandbox: async (u) => { globalThis.__g14.fuori.push('finestra nascosta ' + u); return null; },
    });
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
  const privato = indirizzoPrivato();
  test.skip(!privato, 'serve un indirizzo privato della macchina su cui mettere il proxy');
  const url = testServer.html(PAGINA, { pubblico: true });
  const porta = Number(new URL(testServer.origin).port);

  const diretto = await controlliPartiti(app, openTab, url, null);
  expect(diretto.fuori.length, 'caso di riscontro: senza proxy il sito riceve i controlli').toBeGreaterThan(0);

  const proxy = await avviaProxy(privato, porta);
  try {
    const regole = `http=${privato}:${proxy.address().port}`;
    const dietro = await controlliPartiti(app, openTab, url + '?via=proxy', regole);
    expect(dietro.fuori.length, `dietro il proxy ${privato} lo stesso sito di internet non riceve nessun controllo`).toBeGreaterThan(0);
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
