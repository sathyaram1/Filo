// I contatori della navigazione (#1469) nell'app vera: pagine d'errore e «Riprova», siti bloccati e «Apri comunque»,
// blocco per paese e instradamenti, banner dei cookie e «Mostra il banner», riquadri rotti, scaricamenti e domande dei
// programmi, pulizia dei cookie all'uscita. Si conta nell'ora in corso, e mai un indirizzo o un nome di file.
// Forma, spedizione e regole: tests/unit/contatoriNavigazione.test.mjs e firestoreRulesContatori.test.mjs.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { confermaSopraPagina, aspettaConfermaPronta, mouseClickConfirm } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Le ore di oggi sommate, misura per misura: un test che passa da un'ora all'altra legge lo stesso totale.
const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const m of globalThis.SN_CONTATORI.MISURE_NAVIGAZIONE) {
      for (const [chiave, conti] of Object.entries(ora[m] || {})) {
        const a = ((out[m] = out[m] || {})[chiave] = (out[m] || {})[chiave] || conti.map(() => 0));
        conti.forEach((n, i) => { a[i] += n; });
      }
    }
  }
  return out;
});
const voce = async (app, misura, chiave) => ((await oggi(app))[misura] || {})[chiave] || null;
const statoContatori = (app) => app.evaluate(async () => JSON.stringify(await globalThis.SN_CONTATORI_MAIN.letto()));
const schedaDavanti = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w ? w._filoTabs.activeId : null;
});
const naviga = (app, id, url) => app.evaluate(({ BrowserWindow }, [i, u]) => {
  BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.navigate(i, u);
}, [id, url]);

async function server(gestisci, porta = 0) {
  const s = createServer(gestisci);
  await new Promise((r, no) => { s.once('error', no); s.listen(porta, '127.0.0.1', r); });
  return {
    porta: s.address().port,
    async chiudi() {
      try { s.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => s.close(r));
    },
  };
}
const pagina = (titolo) => (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>${titolo}</title><p id="ok">${titolo}</p>`);
};

test('una pagina d’errore conta il codice di Chromium; «Riprova» e la ricarica contano se poi la pagina arriva', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await openTab(testServer.html('<!doctype html><title>partenza</title><p>partenza</p>'));
  const id = await schedaDavanti(app);
  // Una porta chiusa: la connessione viene rifiutata (-102), poi sulla stessa porta il sito torna.
  const spento = await server(pagina('x'));
  const porta = spento.porta;
  await spento.chiudi();
  const url = `http://127.0.0.1:${porta}/pagina-di-mario-rossi?conto=42`;
  await naviga(app, id, url);
  await expect(page.locator('#err-retry')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => voce(app, 'navFallite', '-102'), { timeout: 10_000 }).toEqual([1, 0]);

  // «Riprova» sulla pagina: il sito è ancora giù.
  await page.locator('#err-retry').click();
  await expect.poll(() => voce(app, 'navRiprove', '-102'), { timeout: 15_000 }).toEqual([0, 1]);
  await expect.poll(() => voce(app, 'navFallite', '-102'), { timeout: 10_000 }).toEqual([2, 0]);
  // La ricarica della barra su una pagina d'errore ritenta il sito: è lo stesso «Riprova».
  await expect(page.locator('#err-retry')).toBeVisible({ timeout: 15_000 });
  await app.evaluate(({ BrowserWindow }, i) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.reload(i);
  }, id);
  await expect.poll(() => voce(app, 'navRiprove', '-102'), { timeout: 15_000 }).toEqual([0, 2]);

  // Il sito torna: «Riprova» apre la pagina.
  const acceso = await server(pagina('tornato'), porta);
  try {
    await expect(page.locator('#err-retry')).toBeVisible({ timeout: 15_000 });
    await page.locator('#err-retry').click();
    await expect(page.locator('#ok')).toHaveText('tornato', { timeout: 15_000 });
    await expect.poll(() => voce(app, 'navRiprove', '-102'), { timeout: 10_000 }).toEqual([1, 2]);
  } finally {
    await acceso.chiudi();
  }
  const tutto = await statoContatori(app);
  for (const x of ['mario', 'conto', String(porta)]) expect(tutto).not.toContain(x);
});

test('la pagina «Sei offline» che si riapre da sola al ritorno della rete non è un «Riprova» premuto', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<!doctype html><title>partenza</title><p>partenza</p>'));
  const bersaglio = testServer.html('<!doctype html><title>tornato</title><p id="ok">tornato</p>');
  // La pagina che il main mette dopo un ERR_INTERNET_DISCONNECTED, nella stessa scheda.
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    tm.tabs.find((t) => t.id === tm.activeId).view.webContents.loadURL(globalThis.SN_NET_ERROR.buildUrl(u, -106, 'ERR_INTERNET_DISCONNECTED'));
  }, bersaglio);
  await expect(page.locator('#err-retry')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#ok')).toHaveText('tornato', { timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(await voce(app, 'navRiprove', '-106')).toBeNull();
});

test('un sito bloccato si conta per lista, dalla pagina o dalla notifica, e «Apri comunque» sulla sua pagina anche', async ({ app, shell, openTab, testServer }) => {
  // Un sito aperto che entra nella lista: la scheda passa alla pagina «Sito bloccato».
  const url = testServer.html('<!doctype html><title>dietro</title><p id="ok">dietro il blocco</p>').replace('127.0.0.1', 'blocked.test');
  await openTab(url);
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: ['blocked.test', 'mario-rossi.test'] } } },
  }));
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://error/') && w.url().includes('code=blocked'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 15_000 }).toBe(true);
  await expect(page.locator('#err-retry')).toHaveText('Apri comunque', { timeout: 15_000 });
  await expect.poll(() => voce(app, 'sitiBloccati', 'lista_utente'), { timeout: 10_000 }).toEqual([1, 0]);
  await page.locator('#err-retry').click();
  await expect(page.locator('#ok')).toHaveText('dietro il blocco', { timeout: 15_000 });
  await expect.poll(() => voce(app, 'sitiBloccati', 'lista_utente'), { timeout: 10_000 }).toEqual([1, 1]);
  // Una scheda chiesta per un sito in lista non nasce: resta la notifica, ed è un blocco anche quello.
  const nata = await shell.evaluate(() => window.filoShell.tabs.open('http://mario-rossi.test/profilo'));
  expect(nata && nata.id).toBeFalsy();
  await expect.poll(() => voce(app, 'sitiBloccati', 'lista_utente'), { timeout: 10_000 }).toEqual([2, 1]);
  expect(await voce(app, 'sitiBloccati', 'liste')).toBe(null);
  const tutto = await statoContatori(app);
  for (const x of ['blocked.test', 'mario', 'profilo']) expect(tutto).not.toContain(x);
});

test('il blocco per paese conta la fonte e la decisione; un instradamento senza fornitore si conta fallito, per paese', async ({ app, openTab }) => {
  const srv = await server((req, res) => {
    res.writeHead(451, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>GEO_451</title><h1>Unavailable For Legal Reasons</h1>');
  });
  try {
    await openTab(`http://127.0.0.1:${srv.porta}/video-di-mario`);
    await expect.poll(() => voce(app, 'geoRilevati', 'http_451'), { timeout: 15_000 }).toEqual([1]);
    // Nessun fornitore configurato nei test: Filo non ha niente da proporre, e lo dice il conto.
    await expect.poll(() => voce(app, 'geoDecisioni', 'not_configured'), { timeout: 10_000 }).toEqual([1]);
    const id = await schedaDavanti(app);
    const esiti = await app.evaluate(async ({ BrowserWindow }, i) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      return [await tm.setTabProxy(i, 'jp'), await tm.setTabProxy(i, 'it', { tier: 'residential' })];
    }, id);
    expect(esiti.map((r) => r.error)).toEqual(['not_configured', 'not_configured']);
    await expect.poll(() => voce(app, 'geoProxy', 'jp|datacenter'), { timeout: 10_000 }).toEqual([0, 1]);
    await expect.poll(() => voce(app, 'geoProxy', 'altro|residential'), { timeout: 10_000 }).toEqual([0, 1]);
    expect(await statoContatori(app)).not.toContain('mario');
  } finally {
    await srv.chiudi();
  }
});

const SOLO_ACCETTA = `<!doctype html><title>SOLO_ACCETTA</title>
  <style>body{margin:0;overflow:hidden} .page{height:4000px}</style>
  <div class="page">contenuto lungo</div>
  <div class="velo" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000"></div>
  <div id="cookie-notice" style="position:fixed;left:0;right:0;bottom:0;height:160px;background:#fff;z-index:1001;padding:16px">
    <p>Questo sito usa i cookie per la pubblicità: accetta, oppure abbonati.</p>
    <button onclick="window.__accepted=true">Accetta e continua</button>
    <button onclick="window.__subscribe=true">Rifiuta e abbonati</button>
  </div>`;

test('un banner nascosto si conta una volta per scheda e sito; «Mostra il banner» dal menu della scheda anche', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, SOLO_ACCETTA);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await expect.poll(() => voce(app, 'bannerCookie', 'hidden'), { timeout: 10_000 }).toEqual([1]);
  // Ricaricata, la stessa scheda sullo stesso sito non conta un'altra volta.
  await page.reload();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 1000));
  expect(await voce(app, 'bannerCookie', 'hidden')).toEqual([1]);
  const id = await schedaDavanti(app);
  const r = await shell.evaluate((i) => window.filoShell.tabs.cookieBanners(i, true), id);
  expect(r && r.ok).toBe(true);
  await expect.poll(() => voce(app, 'bannerCookie', 'mostra_banner'), { timeout: 10_000 }).toEqual([1]);
  expect(await statoContatori(app)).not.toContain('127.0.0.1');
});

// Lo stesso servizio finto di cookies-riquadro-rotto.spec.mjs: b.localhost mostra il segnaposto senza il suo cookie.
async function serviRiquadri() {
  return server((req, res) => {
    const u = new URL(req.url, 'http://x');
    const html = (corpo, extra = {}) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra });
      res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px sans-serif">${corpo}`);
    };
    const porta = req.socket.localPort;
    if (u.pathname === '/art') {
      html(`<title>ARTICOLO</title><p>articolo</p><iframe id="ri" width="420" height="300" style="border:0" src="http://b.localhost:${porta}/post"></iframe>`);
      return;
    }
    const conCookie = { 'Set-Cookie': ['vista=1; Max-Age=86400; Path=/; SameSite=None; Secure'] };
    if (/vista=1/.test(String(req.headers.cookie || ''))) html('<p id="ok">Il post: tramonto sul mare</p>', conCookie);
    else html('<p>Accedi per vedere il post</p>', conCookie);
  });
}

test('un riquadro rotto si conta dal riconoscimento al sì, e poi se funziona', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const srv = await serviRiquadri();
  try {
    await app.evaluate(() => {
      globalThis.__filoRiquadriRotti.servizioTest({ nome: 'Fotogrammi', domini: ['b.localhost'], segnaposto: ['accedi per vedere il post'] });
      globalThis.SN_URL_NAV.isHomeNetworkUrl = () => false;
    });
    const page = await openTab(`http://a.localhost:${srv.porta}/art`);
    let p = null;
    await expect.poll(async () => {
      const l = await app.evaluate(async ({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
            const wc = t.view && t.view.webContents;
            if (wc && !wc.isDestroyed() && wc.getURL().includes('a.localhost')) {
              return wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_RIQUADRO_COOKIE?._test?.proposte() ?? []' }]);
            }
          }
        }
        return [];
      });
      p = l[0] || null;
      return l.length;
    }, { timeout: 25_000 }).toBe(1);
    // Un servizio che non è nell'elenco del codice conta come «altro»: regola, proposta mostrata.
    const E = await app.evaluate(() => globalThis.SN_CONTATORI.EVENTI_RIQUADRO);
    const conti = (...ev) => E.map((e) => ev.filter((x) => x === e).length);
    await expect.poll(() => voce(app, 'riquadri', 'altro'), { timeout: 10_000 }).toEqual(conti('regola', 'mostrata'));
    await page.mouse.click(p.si.x, p.si.y);
    const sopra = await confermaSopraPagina(app);
    await aspettaConfermaPronta(sopra);
    await mouseClickConfirm(sopra, 'ok');
    await expect(page.frameLocator('#ri').locator('#ok')).toHaveText('Il post: tramonto sul mare', { timeout: 15_000 });
    await expect.poll(() => voce(app, 'riquadri', 'altro'), { timeout: 15_000 }).toEqual(conti('regola', 'mostrata', 'accettata', 'funziona'));
    expect(await statoContatori(app)).not.toContain('localhost');
  } finally {
    await srv.chiudi();
  }
});

test('gli scaricamenti contano esito, peso e durata; i programmi le due domande, per classe, mai il nome', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const corpo = Buffer.from('MZ finto' + 'z'.repeat(4096));
  const srv = await server((req, res) => {
    const nome = String(req.url || '').split('?')[0].split('/').pop();
    res.writeHead(200, {
      'Content-Type': nome.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
      'Content-Length': corpo.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(corpo);
  });
  try {
    await app.evaluate(({ shell: s }) => { globalThis.__aperti = []; s.openPath = (p) => { globalThis.__aperti.push(p); return Promise.resolve(''); }; });
    const base = `http://127.0.0.1:${srv.porta}`;
    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px">
      <a id="pdf" href="${base}/relazione-di-mario.pdf">pdf</a>
      <a id="exe" href="${base}/installa-mario.exe">exe</a>
      <a id="iso" href="${base}/disco-di-mario.iso">iso</a></body>`);
    const voceDl = async (nome) => (((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || []).find((x) => x.filename === nome) || null;

    await page.locator('#pdf').click();
    await expect.poll(async () => (await voceDl('relazione-di-mario.pdf'))?.state, { timeout: 20_000 }).toBe('completed');
    await expect.poll(() => voce(app, 'scaricamenti', 'completed'), { timeout: 10_000 }).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);

    await page.locator('#exe').click();
    await expect.poll(async () => (await voceDl('installa-mario.exe'))?.state, { timeout: 20_000 }).toBe('pending');
    const exe = await voceDl('installa-mario.exe');
    await shell.evaluate((i) => window.filoShell.downloads.confirm(i, true), exe.id);
    await expect.poll(async () => (await voceDl('installa-mario.exe'))?.state, { timeout: 20_000 }).toBe('completed');
    const primo = await shell.evaluate((i) => window.filoShell.downloads.openFile(i), exe.id);
    expect(primo.needsConfirm).toBe(true);
    await shell.evaluate((i) => window.filoShell.downloads.openFile(i, true), exe.id);
    await expect.poll(() => app.evaluate(() => globalThis.__aperti.length), { timeout: 10_000 }).toBe(1);

    await page.locator('#iso').click();
    await expect.poll(async () => (await voceDl('disco-di-mario.iso'))?.state, { timeout: 20_000 }).toBe('pending');
    await shell.evaluate(async (i) => window.filoShell.downloads.confirm(i, false), (await voceDl('disco-di-mario.iso')).id);
    await expect.poll(async () => (await voceDl('disco-di-mario.iso'))?.state, { timeout: 20_000 }).toBe('cancelled');

    const E = await app.evaluate(() => globalThis.SN_CONTATORI.EVENTI_PROGRAMMA);
    const conti = (...ev) => E.map((e) => ev.filter((x) => x === e).length);
    await expect.poll(() => voce(app, 'programmi', 'programma'), { timeout: 10_000 }).toEqual(conti('domanda', 'scaricato', 'conferma', 'aperto'));
    await expect.poll(() => voce(app, 'programmi', 'immagine_disco'), { timeout: 10_000 }).toEqual(conti('domanda', 'rifiutato'));
    const completati = await voce(app, 'scaricamenti', 'completed');
    expect(completati.slice(0, 5).reduce((a, n) => a + n, 0)).toBe(2);
    expect((await voce(app, 'scaricamenti', 'cancelled')).slice(0, 5).reduce((a, n) => a + n, 0)).toBe(1);
    const tutto = await statoContatori(app);
    for (const x of ['mario', '.pdf', '.exe', '.iso', 'relazione']) expect(tutto).not.toContain(x);
  } finally {
    await srv.chiudi();
  }
});

test('all’uscita la pulizia dei cookie si conta e arriva sul disco prima che Filo si chiuda', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-contatori-uscita-');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  try {
    await primaFinestra(app);
    await expect.poll(() => app.evaluate(() => !!globalThis.SN_CONTATORI_MAIN), { timeout: 15_000 }).toBe(true);
    const uscita = new Promise((r) => app.process().once('exit', r));
    await app.evaluate(({ app: a }) => { setTimeout(() => a.quit(), 50); });
    await uscita;
    const s = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    const ore = Object.values((s.contatoriGiornalieri && s.contatoriGiornalieri.ore) || {});
    const finite = ore.reduce((a, o) => a + (((o.puliziaCookie || {}).finita || [0])[0] || 0), 0);
    expect(finite).toBe(1);
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});
