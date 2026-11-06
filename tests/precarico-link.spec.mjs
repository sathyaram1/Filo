// Il precarico dei link (#1985): al passaggio del mouse (livello 1) e a rete ferma i link a schermo (livello 2).
// Un sito finto conta le richieste: chi ha l'intestazione Sec-Purpose: prefetch è un precarico.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const ALTRO = 'altro-sito.test';
const WWW = 'www.sito-precarico.test';
const BLOG = 'blog.sito-precarico.test';
test.use({ hostInPiu: [ALTRO, WWW, BLOG] });

// `lente`: indirizzi che rispondono dopo tanto, per vedere un precarico ancora in corso. `scarico`: un file che scende
// piano finché la prova non lo finisce.
async function sitoCheConta({ lente = [], csp = '', ritardoLente = 15_000 } = {}) {
  const richieste = [];
  let finisciScarico = null;
  const server = createServer((req, res) => {
    const r = { url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || ''), chiusaPrima: false };
    richieste.push(r);
    const html = (body, extra = {}) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...(csp ? { 'Content-Security-Policy': csp } : {}), ...extra });
      res.end(`<!doctype html><meta charset="utf-8"><title>${req.url}</title><body style="margin:0">${body}</body>`);
    };
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (req.url === '/scarico.bin') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="scarico.bin"', 'Content-Length': 2048 });
      res.write(Buffer.alloc(1024));
      finisciScarico = () => res.end(Buffer.alloc(1024));
      return;
    }
    if (req.url.startsWith('/indice')) {
      const porta = server.address().port;
      // In cima i link che non si precaricano mai, poi trenta link dello stesso sito alti 18 px: ne stanno a schermo
      // più del tetto.
      const esclusi = [
        '<a id="q" href="/p/cerca?x=1">query</a>',
        '<a id="logout" href="/account/logout">esci</a>',
        `<a id="altro" href="http://${ALTRO}:${porta}/p/fuori">altro sito</a>`,
        '<a id="mail" href="mailto:qualcuno@example.com">mail</a>',
        '<a id="ancora" href="#sotto">ancora</a>',
        '<a id="nofollow" rel="nofollow" href="/p/nofollow">nofollow</a>',
        '<a id="dl" download href="/p/scarica">scarica</a>',
        '<a id="js" href="javascript:void 0">js</a>',
      ].join(' ');
      const links = Array.from({ length: 30 }, (_, i) => `<a id="l${i}" style="display:block;height:18px" href="/p/${i}">link ${i}</a>`).join('');
      html(`<div style="height:20px">${esclusi}</div>${links}<div style="height:3000px"></div><a id="giu" href="/p/giu">in fondo</a>`);
      return;
    }
    const lenta = lente.includes(req.url);
    res.on('close', () => { if (!res.writableEnded) r.chiusaPrima = true; });
    setTimeout(() => { if (!res.destroyed) html(`<h1 id="arrivato">${req.url}</h1>`); }, lenta ? 15_000 : 0);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    richieste,
    precarichi: () => richieste.filter((r) => r.prefetch).map((r) => r.url),
    finisciScarico: () => finisciScarico && finisciScarico(),
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

async function precaricoVisibili(app, acceso) {
  await app.evaluate(async (_e, v) => { await globalThis.SN_STORAGE.updateSettings({ precarico: { visibili: v } }); }, acceso);
}

const LINK_ESCLUSI = ['/p/cerca?x=1', '/account/logout', '/p/fuori', '/p/nofollow', '/p/scarica', '/indice'];

test('il mouse fermo su un link lo precarica, e il clic usa quel precarico senza chiederlo di nuovo', async ({ app, openTab }) => {
  const sito = await sitoCheConta();
  try {
    await precaricoVisibili(app, false);
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    // Spento il livello dei link a schermo, a pagina ferma non parte niente.
    await page.waitForTimeout(2500);
    expect(sito.precarichi()).toEqual([]);

    await page.hover('#l3');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/3']);
    await page.click('#l3');
    await expect(page.locator('#arrivato')).toHaveText('/p/3');
    expect(sito.richieste.filter((r) => r.url === '/p/3').length).toBe(1);
  } finally { await sito.chiudi(); }
});

test('un passaggio di traverso non precarica, la pressione sì anche senza fermarsi', async ({ app, openTab }) => {
  const sito = await sitoCheConta();
  try {
    await precaricoVisibili(app, false);
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    // Il mouse attraversa dieci link senza fermarsi: nessuno parte.
    const box = await page.locator('#l0').boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + 5, box.y + 18 * 10, { steps: 10 });
    await page.mouse.move(box.x + 5, box.y + 18 * 33);
    await page.waitForTimeout(800);
    expect(sito.precarichi()).toEqual([]);

    // Il link escluso non parte nemmeno premuto.
    await page.dispatchEvent('#logout', 'pointerdown', { button: 0, pointerType: 'mouse' });
    await page.dispatchEvent('#l7', 'pointerdown', { button: 0, pointerType: 'mouse' });
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/7']);
  } finally { await sito.chiudi(); }
});

test('a rete ferma partono i link a schermo dello stesso sito, fino al tetto, mai quelli esclusi', async ({ openTab }) => {
  const sito = await sitoCheConta();
  try {
    const page = await openTab(`${sito.origin}/indice`);
    await expect.poll(() => sito.precarichi().length, { timeout: 30_000, intervals: [500] }).toBe(20);
    await page.waitForTimeout(2500);
    const fatti = sito.precarichi();
    expect(fatti.length).toBe(20);
    // Dal primo in alto, in ordine.
    expect(fatti).toEqual(Array.from({ length: 20 }, (_, i) => `/p/${i}`));
    for (const u of LINK_ESCLUSI) expect(fatti).not.toContain(u);
    // Il link in fondo alla pagina non è a schermo.
    expect(fatti).not.toContain('/p/giu');
    expect(sito.richieste.filter((r) => r.url === '/p/fuori').length).toBe(0);

    // Oltre il tetto il link resta al passaggio del mouse.
    await page.hover('#l25');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toContain('/p/25');
  } finally { await sito.chiudi(); }
});

test('con uno scaricamento in corso i link a schermo aspettano, e partono quando finisce', async ({ openTab }) => {
  const sito = await sitoCheConta();
  try {
    const prima = await openTab(`${sito.origin}/indice?scarico`);
    await prima.evaluate(() => { const a = document.createElement('a'); a.href = '/scarico.bin'; document.body.append(a); a.click(); });
    await expect.poll(() => sito.richieste.some((r) => r.url === '/scarico.bin'), { timeout: 5000 }).toBe(true);
    // La pagina dello scaricamento ha avuto il tempo di precaricare qualcosa prima del clic: si conta da qui.
    const giaFatti = sito.precarichi().length;
    const page = await openTab(`${sito.origin}/indice?dopo`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.waitForTimeout(4000);
    expect(sito.precarichi().length).toBe(giaFatti);

    sito.finisciScarico();
    await expect.poll(() => sito.precarichi().length, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(giaFatti);
  } finally { await sito.chiudi(); }
});

test('il clic su un altro link ferma i precarichi ancora in corso', async ({ app, openTab }) => {
  const sito = await sitoCheConta({ lente: ['/p/2', '/p/4'] });
  try {
    await precaricoVisibili(app, false);
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.hover('#l2');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/2']);
    await page.hover('#l4');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/2', '/p/4']);
    await page.click('#l9');
    await expect(page.locator('#arrivato')).toHaveText('/p/9');
    await expect.poll(() => sito.richieste.filter((r) => r.prefetch && r.chiusaPrima).map((r) => r.url).sort(), { timeout: 5000 })
      .toEqual(['/p/2', '/p/4']);
  } finally { await sito.chiudi(); }
});

test('l\'interruttore delle Preferenze spegne i link a schermo, e il passaggio del mouse resta', async ({ app, openTab }) => {
  const sito = await sitoCheConta();
  try {
    const pref = await openTab('filo://preferences/preferences.html');
    const casella = pref.locator('#precaricoVisibili');
    await expect(casella).toBeChecked({ timeout: 15_000 });
    await pref.locator('#sec-funzioni').scrollIntoViewIfNeeded();
    await pref.screenshot({ path: 'tests/.shots/1985/preferenze.png' });
    await casella.uncheck();
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).precarico), { timeout: 10_000 })
      .toEqual({ visibili: false });

    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.waitForTimeout(3000);
    expect(sito.precarichi()).toEqual([]);
    await page.hover('#l1');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/1']);
  } finally { await sito.chiudi(); }
});

test('su una pagina che stringe gli script (CSP) il precarico al passaggio funziona lo stesso', async ({ app, openTab }) => {
  const sito = await sitoCheConta({ csp: "script-src 'none'; require-trusted-types-for 'script'" });
  try {
    await precaricoVisibili(app, false);
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.hover('#l5');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/5']);
  } finally { await sito.chiudi(); }
});

// #1985 giro 1, r1: un sito con l'accesso che chiude la sessione a un GET sul link d'uscita, come tanti siti veri.
test('aprire la pagina e passare sui link d\'uscita non fa uscire dal sito, in nessuna lingua', async ({ openTab }) => {
  const uscite = ['/konto/abmelden', '/compte/d%C3%A9connexion', '/user/doLogout', '/a/x9', '/a/v1', '/user/loginOut'];
  const sessioni = new Set();
  const richieste = [];
  let prossima = 1;
  const server = createServer((req, res) => {
    const cookie = /sess=(\d+)/.exec(req.headers.cookie || '');
    richieste.push(req.url);
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (uscite.includes(req.url)) {
      if (cookie) sessioni.delete(cookie[1]);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><p>Sei uscito.</p>');
      return;
    }
    const extra = {};
    let id = cookie && sessioni.has(cookie[1]) ? cookie[1] : '';
    if (!cookie) { id = String(prossima++); sessioni.add(id); extra['Set-Cookie'] = `sess=${id}; Path=/; HttpOnly`; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra });
    res.end(`<!doctype html><meta charset="utf-8"><body><nav>
      <a href="/area/profilo">Profilo</a> <a id="u0" href="/konto/abmelden">Abmelden</a>
      <a id="u1" href="/compte/déconnexion">Se déconnecter</a> <a id="u2" href="/user/doLogout">Esci</a>
      <a id="u3" class="btn btn-logout" href="/a/x9"><svg width="16" height="16"></svg></a>
      <a id="u4" href="/a/v1">Выйти</a> <a id="u5" href="/user/loginOut">退出登录</a></nav>
      <h1 id="stato">${id ? 'Ciao, sei dentro' : 'Accedi'}</h1></body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const page = await openTab(`http://127.0.0.1:${server.address().port}/area`);
    await expect(page.locator('#stato')).toHaveText('Ciao, sei dentro');
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    for (const id of ['#u0', '#u1', '#u2', '#u3', '#u4', '#u5']) { await page.hover(id); await page.waitForTimeout(300); }
    // Il profilo, a schermo e dello stesso sito, parte: i link d'uscita restano fermi lo stesso.
    await expect.poll(() => richieste.includes('/area/profilo'), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(2000);
    expect(richieste.filter((u) => uscite.includes(u))).toEqual([]);
    await page.reload();
    await expect(page.locator('#stato')).toHaveText('Ciao, sei dentro');
  } finally { await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }); }
});

// #1985 giro 1, r2: un clic che non porta via la pagina non spegne i link a schermo per sempre.
test('dopo il clic su un link che scarica un file, i link a schermo riprendono', async ({ openTab }) => {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || '') });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (req.url === '/report') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="report.txt"' });
      res.end('ciao');
      return;
    }
    const sotto = Array.from({ length: 10 }, (_, i) => `<a style="display:block;height:18px" href="/giu/${i}">giu ${i}</a>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0"><a id="scarica" href="/report">Scarica il resoconto</a>
      <div style="height:3000px"></div><div id="sotto">${sotto}</div></body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await openTab(`${origin}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.waitForTimeout(2000);
    await page.click('#scarica');
    await page.waitForTimeout(3000);
    expect(page.url()).toBe(`${origin}/pagina`);
    await page.locator('#sotto').scrollIntoViewIfNeeded();
    await expect.poll(() => richieste.filter((r) => r.prefetch && r.url.startsWith('/giu/')).length, { timeout: 25_000, intervals: [500] })
      .toBeGreaterThan(0);
  } finally { await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }); }
});

// #1985 giro 1, r3: niente precarico in incognito né sui siti dove l'utente ha spento Filo, nemmeno al passaggio.
async function trovaPagina(app, url, tetto = 15_000) {
  const fine = Date.now() + tetto;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`pagina non trovata: ${url}`);
}

test('in incognito non parte nessun precarico, né al passaggio del mouse né a pagina ferma', async ({ app, shell }) => {
  const sito = await sitoCheConta();
  try {
    const idIncognito = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoIncognito).map((w) => w.id));
    const prima = await idIncognito();
    await shell.evaluate(() => window.filoShell.openIncognito());
    let id = null;
    await expect.poll(async () => (id = (await idIncognito()).find((x) => !prima.includes(x)) ?? null), { timeout: 15_000 }).not.toBeNull();
    const url = `${sito.origin}/indice`;
    await app.evaluate(({ BrowserWindow }, a) => { BrowserWindow.fromId(a.id)._filoTabs.openTab(a.url); }, { id, url });
    const page = await trovaPagina(app, url);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await page.hover('#l3');
    await page.dispatchEvent('#l4', 'pointerdown', { button: 0, pointerType: 'mouse' });
    await page.waitForTimeout(4000);
    expect(sito.precarichi()).toEqual([]);
  } finally { await sito.chiudi(); }
});

test('su un sito dove Filo è spento non parte nessun precarico', async ({ app, openTab }) => {
  const sito = await sitoCheConta();
  try {
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ blocklist: ['127.0.0.1'] }); });
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await page.hover('#l3');
    await page.dispatchEvent('#l4', 'pointerdown', { button: 0, pointerType: 'mouse' });
    await page.waitForTimeout(4000);
    expect(sito.precarichi()).toEqual([]);
  } finally { await sito.chiudi(); }
});

// #1985 giro 1, r4: le parti che si vedono solo sul cammino vero.
test('col portatile senza la spina i link a schermo aspettano, e partono quando torna', async ({ app, openTab }) => {
  const sito = await sitoCheConta();
  try {
    await app.evaluate(({ powerMonitor }) => { globalThis.__veroBatteria = powerMonitor.isOnBatteryPower; powerMonitor.isOnBatteryPower = () => true; });
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.waitForTimeout(4000);
    expect(sito.precarichi()).toEqual([]);
    await app.evaluate(({ powerMonitor }) => { powerMonitor.isOnBatteryPower = () => false; });
    await expect.poll(() => sito.precarichi().length, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(0);
  } finally {
    await app.evaluate(({ powerMonitor }) => { if (globalThis.__veroBatteria) powerMonitor.isOnBatteryPower = globalThis.__veroBatteria; });
    await sito.chiudi();
  }
});

test('un altro sottodominio dello stesso sito si precarica, e verso un altro sito parte solo la connessione', async ({ app, openTab }) => {
  const sito = await sitoCheConta();
  try {
    await precaricoVisibili(app, false);
    const porta = new URL(sito.origin).port;
    const page = await openTab(`http://${WWW}:${porta}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.evaluate((u) => {
      const a = document.createElement('a');
      a.id = 'blog';
      a.href = u;
      a.textContent = 'il blog';
      document.body.prepend(a);
    }, `http://${BLOG}:${porta}/articolo`);
    const regole = () => page.evaluate(() => Array.from(document.querySelectorAll('script[type="speculationrules"]'))
      .flatMap((s) => JSON.parse(s.textContent).prefetch.flatMap((r) => r.urls)));
    await page.hover('#blog');
    await expect.poll(regole, { timeout: 5000 }).toContain(`http://${BLOG}:${porta}/articolo`);

    await page.hover('#altro');
    await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll('link[rel="preconnect"]')).map((l) => l.href)), { timeout: 5000 })
      .toContain(`http://${ALTRO}:${porta}/`);
    expect((await regole()).some((u) => u.includes(ALTRO))).toBe(false);
  } finally { await sito.chiudi(); }
});

// #1985 giro 2, r1: un precarico ancora in corso al clic va usato, non aspettato e poi buttato.
test('con un sito lento il clic dopo il passaggio usa il precarico in corso, e la pagina arriva prima', async ({ app, openTab }) => {
  const RITARDO = 2000;
  const sito = await sitoCheConta({ lente: ['/p/3'], ritardoLente: RITARDO });
  try {
    await precaricoVisibili(app, false);
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.hover('#l3');
    await page.waitForTimeout(300);
    const t0 = Date.now();
    await page.click('#l3', { noWaitAfter: true });
    await expect(page.locator('#arrivato')).toHaveText('/p/3', { timeout: 15_000 });
    const attesa = Date.now() - t0;
    expect(sito.richieste.filter((r) => r.url === '/p/3').map((r) => r.prefetch)).toEqual([true]);
    expect(attesa).toBeLessThan(RITARDO + 600);
  } finally { await sito.chiudi(); }
});

// #1985 giro 2, r2: per la pagina una scheda dietro resta «visibile»; i suoi link a schermo aspettano che torni davanti.
test('una scheda rimasta dietro non precarica i suoi link a schermo, e li precarica quando torna davanti', async ({ app, shell, openTab }) => {
  const sito = await sitoCheConta();
  try {
    const url = `${sito.origin}/indice?dietro`;
    const aperta = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    await expect.poll(() => (page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } })) != null,
      { timeout: 15_000 }).toBe(true);
    await page.waitForLoadState('load');
    await openTab(`${sito.origin}/p/davanti`);
    const prima = sito.precarichi().length;
    await new Promise((r) => setTimeout(r, 8000));
    expect(sito.precarichi().length).toBe(prima);
    await shell.evaluate((id) => window.filoShell.tabs.activate(id), aperta.id);
    await expect.poll(() => sito.precarichi().length, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(prima);
  } finally { await sito.chiudi(); }
});

// #1985 giro 2, r4: una pagina che cambia indirizzo da sé non riempie la lista oltre il tetto di Chromium.
test('in una pagina che cambia indirizzo da sola i link a schermo restano dentro il tetto, e il passaggio del mouse funziona ancora', async ({ openTab }) => {
  const sito = await sitoCheConta();
  try {
    const page = await openTab(`${sito.origin}/indice`);
    const subito = () => page.evaluate(() => Array.from(document.querySelectorAll('script[type="speculationrules"]'))
      .flatMap((s) => JSON.parse(s.textContent).prefetch.filter((r) => !r.eagerness).flatMap((r) => r.urls)).length);
    await expect.poll(() => sito.precarichi().length, { timeout: 30_000, intervals: [500] }).toBe(20);
    for (let giro = 1; giro <= 3; giro++) {
      await page.evaluate((g) => {
        history.pushState({}, '', `/indice/${g}`);
        const box = document.createElement('div');
        box.innerHTML = Array.from({ length: 20 }, (_, i) => `<a style="display:block;height:18px" href="/v${g}/${i}">v${g} ${i}</a>`).join('');
        document.body.prepend(box);
        window.scrollTo(0, 0);
        window.dispatchEvent(new Event('scroll'));
      }, giro);
      await expect.poll(() => sito.precarichi().filter((u) => u.startsWith(`/v${giro}/`)).length, { timeout: 30_000, intervals: [500] }).toBe(20);
      expect(await subito()).toBeLessThanOrEqual(20);
    }
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.id = 'nuovo';
      a.href = '/p/nuovo';
      a.textContent = 'nuovo';
      a.style.cssText = 'display:block;height:30px';
      document.body.prepend(a);
    });
    await page.hover('#nuovo');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toContain('/p/nuovo');
  } finally { await sito.chiudi(); }
});
