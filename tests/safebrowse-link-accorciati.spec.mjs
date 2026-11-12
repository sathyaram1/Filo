// Il puntatore fermo su un link accorciato ne prepara il verdetto prima del clic (#966): lista nera e finestra nascosta
// che si ferma alla destinazione. Gli altri link, e un passaggio veloce, non mandano niente in rete.
// Regole e casi di logica: tests/unit/safebrowseLinkAccorciati.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const CORTO = 'bit.ly';
const TRUFFA = 'conto-truffa966.com';
const ALTRO = 'altro-sito966.com';
test.use({ hostInPiu: [CORTO, TRUFFA, ALTRO] });

// Un accorciatore, la sua destinazione «pericolosa» e una pagina coi link, tutti sul loopback; conta ogni visita.
async function siti(t) {
  const visite = [];
  let porta = 0;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const u = new URL(req.url, 'http://x');
    visite.push(host + u.pathname);
    const html = (b) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(b); };
    if (host === CORTO) {
      const vai = () => { res.writeHead(302, { Location: `http://${TRUFFA}:${porta}/accesso${u.pathname.replace(/^\//, '?da=')}` }); res.end(); };
      if (u.pathname.startsWith('/lento')) setTimeout(vai, 1500);
      else vai();
      return;
    }
    if (host === TRUFFA) return html('<title>Accedi</title><p>Accedi al tuo conto</p>');
    const blocco = 'style="display:block;width:320px;height:60px;margin:10px 0;background:#eee"';
    if (u.pathname === '/lunga') {
      return html('<title>Lunga966</title><body style="margin:0"><div style="height:1200px"></div>'
        + `<a id="corto" style="display:block;width:600px;height:80px;background:#eee" href="http://${CORTO}:${porta}/x7k">link corto</a>`
        + '<div style="height:2000px"></div></body>');
    }
    html('<title>Pagina966</title>'
      + `<a id="corto" ${blocco} href="http://${CORTO}:${porta}/x7k">link corto</a>`
      + `<a id="normale" ${blocco} href="http://${ALTRO}:${porta}/pagina">link normale</a>`
      + [1, 2, 3].map((i) => `<a id="lento${i}" ${blocco} href="http://${CORTO}:${porta}/lento${i}">lento ${i}</a>`).join('')
      + `<a id="fuori" ${blocco}>niente</a>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  porta = server.address().port;
  t.after = () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); });
  return {
    porta,
    pagina: `http://sito-pubblico.test:${porta}/pagina`,
    lunga: `http://sito-pubblico.test:${porta}/lunga`,
    destinazione: `http://${TRUFFA}:${porta}/accesso?da=x7k`,
    quante: (p) => visite.filter((v) => v.startsWith(p)).length,
  };
}

// La lista nera finta risponde dopo 4 s, come una rete lenta, e ricorda le risposte come quella vera.
const listaNeraLenta = (app) => app.evaluate((_e, truffa) => {
  globalThis.__gsb966 = [];
  const visti = new Map();
  globalThis.SN_SAFEBROWSE.setProviders({
    gsb: async (url, norm) => {
      globalThis.__gsb966.push(url);
      await new Promise((r) => setTimeout(r, 4000));
      const v = norm.host === truffa ? { listed: true, category: 'phishing' } : { listed: false };
      visti.set(url, v);
      return v;
    },
    gsbPeek: (url) => visti.get(url),
    rdap: null, ct: null, llm: null,
  });
  // Il picco di finestre nascoste vive, campionato finché la prova gira.
  globalThis.__picco966 = 0;
  clearInterval(globalThis.__campiona966);
  globalThis.__campiona966 = setInterval(() => {
    const live = globalThis.SN_SAFEBROWSE.sandbox.stats().live;
    if (live > globalThis.__picco966) globalThis.__picco966 = live;
  }, 10);
}, TRUFFA);
const chiesteAllaLista = (app) => app.evaluate(() => globalThis.__gsb966.slice());
const finito = (app) => app.evaluate(() => globalThis.SN_SAFEBROWSE._settled());

// Quanto dopo il clic la scheda ha l'avviso «pericoloso», misurato nel main.
async function cliccaEMisura(app, page, sel, opzioni = {}) {
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__clic966 = Date.now();
    globalThis.__avviso966 = null;
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    clearInterval(globalThis.__guarda966);
    globalThis.__guarda966 = setInterval(() => {
      const tab = win._filoTabs.tabs.find((t) => t.sbAvviso && t.sbAvviso.level === 'pericoloso');
      if (tab && globalThis.__avviso966 === null) {
        globalThis.__avviso966 = Date.now() - globalThis.__clic966;
      }
    }, 10);
  });
  await page.click(sel, opzioni);
  await expect.poll(() => app.evaluate(() => globalThis.__avviso966), { timeout: 10_000 }).not.toBeNull();
  return app.evaluate(() => { clearInterval(globalThis.__guarda966); return globalThis.__avviso966; });
}

async function vistaAvviso(app, ms = 8000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la vista dell\'avviso non è nata');
}

test('puntatore fermo su un link accorciato verso una pagina in lista nera: al clic l\'avviso è già pronto', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNeraLenta(app);
    const page = await openTab(s.pagina);
    await page.hover('#corto');
    await expect.poll(() => s.quante(`${CORTO}/x7k`), { timeout: 5_000 }).toBe(1);
    await finito(app);
    // La finestra nascosta si è fermata alla destinazione: il sito d'arrivo non ha ricevuto visite prima del clic.
    expect(s.quante(`${TRUFFA}/`)).toBe(0);
    expect(await chiesteAllaLista(app)).toEqual(expect.arrayContaining([`http://${CORTO}:${s.porta}/x7k`, s.destinazione]));
    const ms = await cliccaEMisura(app, page, '#corto');
    // Senza il controllo prima del clic la lista nera risponderebbe dopo 4 s.
    expect(ms).toBeLessThan(2000);
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 5_000 });
    await expect(avviso.getByText(new RegExp(`classifica ${TRUFFA.replace(/\./g, '\\.')}`))).toBeVisible();
    expect(s.quante(`${TRUFFA}/accesso`)).toBe(1);
  } finally {
    await app.evaluate(() => clearInterval(globalThis.__campiona966)).catch(() => {});
    await t.after();
  }
});

test('lo stesso link aperto in una scheda nuova col clic centrale: anche lì l\'avviso è già pronto', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNeraLenta(app);
    const page = await openTab(s.pagina);
    await page.hover('#corto');
    await expect.poll(() => s.quante(`${CORTO}/x7k`), { timeout: 5_000 }).toBe(1);
    await finito(app);
    const ms = await cliccaEMisura(app, page, '#corto', { button: 'middle' });
    expect(ms).toBeLessThan(2000);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
      .filter((x) => x.sbAvviso).map((x) => x.sbAvviso.url))).toEqual([expect.stringContaining(TRUFFA)]);
  } finally {
    await app.evaluate(() => clearInterval(globalThis.__campiona966)).catch(() => {});
    await t.after();
  }
});

test('puntatore che passa veloce su un link accorciato, o fermo su un link normale: nessuna richiesta di rete', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNeraLenta(app);
    const page = await openTab(s.pagina);
    // La pagina stessa si controlla all'apertura, come sempre: da qui in poi conta solo il puntatore.
    await finito(app);
    await app.evaluate(() => { globalThis.__gsb966.length = 0; });
    await page.hover('#corto');
    await page.waitForTimeout(150);
    await page.hover('#fuori');
    await page.hover('#normale');
    await page.waitForTimeout(1500);
    await finito(app);
    expect(await chiesteAllaLista(app)).toEqual([]);
    expect(s.quante(`${CORTO}/`)).toBe(0);
    expect(s.quante(`${ALTRO}/`)).toBe(0);
  } finally {
    await app.evaluate(() => clearInterval(globalThis.__campiona966)).catch(() => {});
    await t.after();
  }
});

test('raggiunto col tasto Tab il link accorciato si controlla come sotto il puntatore', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNeraLenta(app);
    const page = await openTab(s.pagina);
    await finito(app);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('corto');
    await expect.poll(() => s.quante(`${CORTO}/x7k`), { timeout: 5_000 }).toBe(1);
    await finito(app);
    expect(s.quante(`${TRUFFA}/`)).toBe(0);
  } finally {
    await app.evaluate(() => clearInterval(globalThis.__campiona966)).catch(() => {});
    await t.after();
  }
});

test('la rotella porta il link accorciato sotto il puntatore fermo: il controllo parte come col mouse', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNeraLenta(app);
    const page = await openTab(s.lunga);
    await finito(app);
    await page.mouse.move(300, 200);
    // Il movimento è ormai vecchio: conta solo lo scorrimento.
    await page.waitForTimeout(1500);
    await page.mouse.wheel(0, 1040);
    await expect.poll(() => page.evaluate(() => { const el = document.elementFromPoint(300, 200); return el && el.id; }), { timeout: 3_000 }).toBe('corto');
    await expect.poll(() => s.quante(`${CORTO}/x7k`), { timeout: 5_000 }).toBe(1);
    await finito(app);
    expect(s.quante(`${TRUFFA}/`)).toBe(0);
  } finally {
    await app.evaluate(() => clearInterval(globalThis.__campiona966)).catch(() => {});
    await t.after();
  }
});

test('fermo su tre link accorciati lenti uno dopo l\'altro: mai più di una finestra nascosta, e vince l\'ultimo', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNeraLenta(app);
    const page = await openTab(s.pagina);
    for (const i of [1, 2, 3]) {
      await page.hover(`#lento${i}`);
      await page.waitForTimeout(700);
    }
    await finito(app);
    expect(await app.evaluate(() => globalThis.__picco966)).toBe(1);
    expect(await app.evaluate(() => globalThis.SN_SAFEBROWSE.sandbox.stats())).toEqual({ live: 0, queued: 0 });
    const ultimo = await app.evaluate((_e, u) => {
      const v = globalThis.SN_SAFEBROWSE.preverdetto(u);
      return v && { destinazione: v.destinazione, level: v.verdetto && v.verdetto.level };
    }, `http://${CORTO}:${s.porta}/lento3`);
    expect(ultimo).toEqual({ destinazione: `http://${TRUFFA}:${s.porta}/accesso?da=lento3`, level: 'pericoloso' });
  } finally {
    await app.evaluate(() => clearInterval(globalThis.__campiona966)).catch(() => {});
    await t.after();
  }
});

test('l\'interruttore in Sicurezza si vede, e spento la finestra nascosta non parte: resta la lista nera', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    const sicurezza = await openTab('filo://security/');
    const casella = sicurezza.locator('#sec-safebrowse-sandbox');
    await expect(casella).toBeVisible({ timeout: 8_000 });
    await expect(sicurezza.locator('#sec-safebrowse-sandbox-label')).toHaveText(/link accorciati/);
    await expect(sicurezza.locator('#sec-safebrowse-sandbox-desc')).toContainText('mezzo secondo');
    await sicurezza.locator('#sec-safebrowse-sandbox-row').screenshot({ path: 'tests/.shots/966-interruttore.png' });
    await casella.uncheck();
    await expect.poll(() => app.evaluate(() => globalThis.SN_SAFEBROWSE.activeProviders().destinazione)).toBe(false);
    await listaNeraLenta(app);
    const page = await openTab(s.pagina);
    await finito(app);
    await app.evaluate(() => { globalThis.__gsb966.length = 0; });
    await page.hover('#corto');
    await page.waitForTimeout(700);
    await finito(app);
    expect(s.quante(`${CORTO}/`)).toBe(0);
    expect(await chiesteAllaLista(app)).toEqual([`http://${CORTO}:${s.porta}/x7k`]);
    await sicurezza.bringToFront();
    await casella.check();
    await expect.poll(() => app.evaluate(() => globalThis.SN_SAFEBROWSE.activeProviders().destinazione)).toBe(true);
  } finally {
    await app.evaluate(() => clearInterval(globalThis.__campiona966)).catch(() => {});
    await t.after();
  }
});
