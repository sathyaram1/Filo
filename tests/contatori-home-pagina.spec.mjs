// I contatori della home e degli automatismi sulla pagina (#1473) nell'app vera: i comandi della barra della home, la
// ricerca nel filo, i «risali» di fila, l'intervista rifatta, le proposte sulla pagina e gli automatismi fatti e disfatti.
// Si conta nell'ora in corso, e mai quello che si scrive, un sito o un paese. Forma e regole: tests/unit/contatoriHomePagina.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { confermaSopraPagina, aspettaConfermaPronta } from './helpers/confirm.mjs';

// Le ore di oggi sommate, misura per misura.
const homePagina = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`) || !ora.homePagina) continue;
    for (const [m, conti] of Object.entries(ora.homePagina)) {
      for (const [chiave, n] of Object.entries(conti || {})) (out[m] = out[m] || {})[chiave] = ((out[m] || {})[chiave] || 0) + n;
    }
  }
  return out;
});
const voce = async (app, misura, chiave) => ((await homePagina(app))[misura] || {})[chiave] || 0;
const conInizio = async (app, misura, prefisso) => Object.entries((await homePagina(app))[misura] || {})
  .filter(([k]) => k.startsWith(prefisso)).reduce((n, [, v]) => n + v, 0);
const statoContatori = (app) => app.evaluate(async () => JSON.stringify(await globalThis.SN_CONTATORI_MAIN.letto()));
const BARRA = { url: 'filo://shell/shell.html', isShell: true };
const evento = (app, msg, mittente) => app.evaluate(
  (_e, [m, s]) => globalThis.SN_HANDLE_MESSAGE({ ...m, type: globalThis.SN_MSG.MSG.CONTATORI_EVENTO }, s),
  [msg, mittente],
);
const schedaCon = (shell, pezzo) => shell.evaluate(async (p) => {
  const s = await window.filoShell.tabs.snapshot();
  const t = (s.tabs || []).find((x) => String(x.url || '').includes(p));
  return t ? t.id : null;
}, pezzo);

// Eventi del filo scritti come li scrive chi salva (come in home-coda-del-filo.spec.mjs).
async function semina(app, chats) {
  await app.evaluate(async (_e, lista) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = [];
    for (const c of lista) {
      ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat: c.id }, { ts: c.ts, dispositivo: qui }));
      ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: c.id, msg: { role: 'user', text: c.text } }, { ts: c.ts, dispositivo: qui, autore: 'utente' }));
      ev.push(E.crea(E.TIPI.CHAT_CHIUSA, { chat: c.id }, { ts: c.ts, dispositivo: qui }));
    }
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, chats);
}

test('la barra della home conta il nome del comando, «/sito», il «/qualcosa» per Filo e la scelta sul sito che non si trova', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('net:resolves');
    ipcMain.handle('net:resolves', async (_e, { host } = {}) => ({ resolves: !String(host || '').includes('inesistente') }));
  });
  let page = await openTab('filo://newtab/');
  const scrivi = async (p, t) => { const i = p.locator('#input'); await i.fill(t); await i.press('Enter'); };

  await scrivi(page, '/help');
  await expect.poll(() => voce(app, 'comando_home', 'help')).toBe(1);
  await scrivi(page, '/sito-esistente-filo.test');
  await expect.poll(() => voce(app, 'comando_home', 'sito_diretto')).toBe(1);

  // «Apri comunque» sull'avviso: una scelta, e il bottone premuto di nuovo non conta.
  await scrivi(page, '/sito-inesistente-uno.test');
  const avviso = page.locator('.dash-bubble-filo', { hasText: 'sito-inesistente-uno.test' });
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await avviso.locator('.dash-action-btn', { hasText: 'Apri comunque' }).click();
  await expect.poll(() => voce(app, 'comando_home', 'sito_non_risolto:apri_lo_stesso')).toBe(1);

  // Un avviso lasciato: l'invio dopo è la scelta di non aprirlo.
  await scrivi(page, '/sito-inesistente-due.test');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'sito-inesistente-due.test' })).toBeVisible({ timeout: 8_000 });
  expect(await voce(app, 'comando_home', 'sito_non_risolto:lascia')).toBe(0);
  await scrivi(page, '/help');
  await expect.poll(() => voce(app, 'comando_home', 'sito_non_risolto:lascia')).toBe(1);
  expect(await voce(app, 'comando_home', 'help')).toBe(2);

  // E uno lasciato chiudendo la scheda, che alla pagina non dà nessun evento: lo conta il main.
  await scrivi(page, '/sito-inesistente-tre.test');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'sito-inesistente-tre.test' })).toBeVisible({ timeout: 8_000 });
  const id = await schedaCon(shell, 'newtab');
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  await expect.poll(() => voce(app, 'comando_home', 'sito_non_risolto:lascia')).toBe(2);

  page = await openTab('filo://newtab/');
  await scrivi(page, '/qwertyuiop filo');
  await expect.poll(() => voce(app, 'comando_home', 'sconosciuto_inviato')).toBe(1);
  const tutto = await homePagina(app);
  expect(Object.keys(tutto.comando_home).sort()).toEqual(['help', 'sconosciuto_inviato', 'sito_diretto', 'sito_non_risolto:apri_lo_stesso', 'sito_non_risolto:lascia']);
  const stato = await statoContatori(app);
  for (const ago of ['qwertyuiop', 'inesistente', 'esistente']) expect(stato).not.toContain(ago);
});

test('la ricerca nel filo conta risultati, cosa si apre, a che posto e dopo quanto; e i «risali» di fila una volta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const chats = [];
  for (let i = 0; i < 200; i++) {
    chats.push({ id: `c${i}`, ts: new Date(Date.now() - (200 - i) * 3600000).toISOString(), text: i === 150 ? 'come cacciano le orche?' : `domanda numero ${i}` });
  }
  await semina(app, chats);
  const page = await openTab('filo://newtab/');
  const campo = page.locator('#cercaInput');
  await campo.fill('zzqqxx');
  await expect(page.locator('#cercaRisultati')).toContainText('Niente nel filo', { timeout: 8_000 });
  await expect.poll(() => voce(app, 'ricerca_home', 'risultati:r0'), { timeout: 8_000 }).toBe(1);
  // Entro dieci secondi un'altra ricerca: chi non ha trovato niente riprova.
  await campo.fill('orche');
  const msg = page.locator('#cercaRisultati .dash-cerca-msg', { hasText: 'come cacciano le orche?' });
  await expect(msg).toBeVisible({ timeout: 8_000 });
  await msg.click();
  await expect.poll(() => conInizio(app, 'ricerca_home', 'aperto:messaggio:p1:')).toBe(1);
  expect(await voce(app, 'ricerca_home', 'risultati:r1_3')).toBe(1);
  expect(await voce(app, 'ricerca_home', 'vuota_ripetuta')).toBe(1);
  expect(Object.values((await homePagina(app)).ricerca_home).reduce((a, b) => a + b, 0), 'le parole a metà non sono ricerche').toBe(4);

  // Due «risali», poi un'altra cosa nella home: una serie da due pezzi.
  const risali = page.locator('.dash-risali-btn');
  for (let i = 0; i < 2; i++) {
    await expect(risali).toHaveText('risali il filo', { timeout: 8_000 });
    await expect(risali).toBeEnabled();
    await page.evaluate(() => document.querySelector('.dash-risali-btn').click());
    await expect(risali).toBeEnabled({ timeout: 8_000 });
  }
  expect((await homePagina(app)).risali || {}).toEqual({});
  await page.locator('#input').fill('/help');
  await page.locator('#input').press('Enter');
  await expect.poll(() => voce(app, 'risali', 'n2_3')).toBe(1);
  const stato = await statoContatori(app);
  for (const ago of ['orche', 'zzqqxx']) expect(stato).not.toContain(ago);
});

test('l’intervista rifatta dalle Preferenze conta la riapertura e il passo dove si ferma, fuori da quelli della prima volta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const primaVolta = () => app.evaluate(async () => {
    const s = await globalThis.SN_CONTATORI_MAIN.letto();
    return Object.values(s.ore || {}).map((o) => o.intervista || {}).filter((x) => Object.keys(x).length);
  });
  const prima = await primaVolta();
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#restartOnboarding').click();
  await expect.poll(() => voce(app, 'intervista_rifatta', 'riaperta')).toBe(1);
  let intervista = null;
  await expect.poll(() => {
    intervista = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    return Boolean(intervista);
  }, { timeout: 15_000 }).toBe(true);
  await expect(intervista.locator('#skipOnboarding')).toBeVisible({ timeout: 15_000 });
  await intervista.locator('#skipOnboarding').click();
  await expect.poll(() => voce(app, 'intervista_rifatta', 'fine:profilo'), { timeout: 15_000 }).toBe(1);
  expect(await primaVolta(), 'la rifatta non entra nei contatori della prima volta').toEqual(prima);
});

async function dueSiti() {
  const s = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${req.headers.host}</title><p style="font-size:40px">${req.url}</p>`);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const porta = s.address().port;
  return { a: `http://127.0.0.1:${porta}`, b: `http://sito-pubblico.test:${porta}`, chiudi: () => new Promise((r) => s.close(r)) };
}
const schedaWeb = (app, fn, arg) => app.evaluate(({ BrowserWindow }, [codice, a]) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  const tab = tm.tabs.find((t) => t.id === tm.activeId);
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'tab', 'a', codice)(tm, tab, a);
}, [fn, arg]);

test('lo zoom che Filo ritrova su un sito si conta quando torna, e riportato al 100% si conta disfatto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const siti = await dueSiti();
  try {
    await openTab(`${siti.a}/uno`);
    expect(await voce(app, 'automatismo_fatto', 'zoom_ricordato'), 'la prima visita non ha uno zoom da ritrovare').toBe(0);
    await schedaWeb(app, 'tab.view.webContents.setZoomLevel(2);');
    await schedaWeb(app, 'tm.navigate(tab.id, a);', `${siti.b}/due`);
    await expect.poll(() => schedaWeb(app, 'return tab.view.webContents.getURL();')).toContain('sito-pubblico.test');
    // Un'altra pagina dello stesso sito, nella stessa visita, non è uno zoom ritrovato.
    await schedaWeb(app, 'tm.navigate(tab.id, a);', `${siti.a}/tre`);
    await expect.poll(() => voce(app, 'automatismo_fatto', 'zoom_ricordato'), { timeout: 8_000 }).toBe(1);
    await schedaWeb(app, 'tm.navigate(tab.id, a);', `${siti.a}/quattro`);
    await expect.poll(() => schedaWeb(app, 'return tab.view.webContents.getURL();')).toContain('/quattro');
    await new Promise((r) => setTimeout(r, 500));
    expect(await voce(app, 'automatismo_fatto', 'zoom_ricordato')).toBe(1);
    // «Dimensione reale» passa dalla porta dello zoom, come Ctrl+0.
    await schedaWeb(app, "tab.view.webContents.send('filo:zoom-key', 'reset');");
    await expect.poll(() => voce(app, 'automatismo_disfatto', 'zoom_ricordato'), { timeout: 8_000 }).toBe(1);
    expect(await statoContatori(app)).not.toContain('sito-pubblico');
  } finally {
    await siti.chiudi();
  }
});

const SOLO_ACCETTA = `<!doctype html><title>SOLO_ACCETTA</title>
  <div style="height:4000px">contenuto lungo</div>
  <div id="cookie-notice" style="position:fixed;left:0;right:0;bottom:0;height:160px;background:#fff;z-index:1001">
    <p>Questo sito usa i cookie per la pubblicità: accetta, oppure abbonati.</p>
    <button>Accetta e continua</button>
  </div>`;

test('il banner tolto da Filo si conta una volta per scheda e sito, e «Mostra il banner» lo conta disfatto', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, SOLO_ACCETTA);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await expect.poll(() => voce(app, 'automatismo_fatto', 'banner_cookie'), { timeout: 10_000 }).toBe(1);
  await page.reload();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 1000));
  expect(await voce(app, 'automatismo_fatto', 'banner_cookie')).toBe(1);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  expect((await shell.evaluate((i) => window.filoShell.tabs.cookieBanners(i, true), id)).ok).toBe(true);
  await expect.poll(() => voce(app, 'automatismo_disfatto', 'banner_cookie'), { timeout: 10_000 }).toBe(1);
  expect(await statoContatori(app)).not.toContain('127.0.0.1');
});

// Lo stesso servizio finto di contatori-navigazione.spec.mjs: b.localhost mostra il segnaposto senza il suo cookie.
async function serviRiquadri() {
  const s = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const porta = req.socket.localPort;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': ['vista=1; Max-Age=86400; Path=/; SameSite=None; Secure'] });
    if (u.pathname === '/art') res.end(`<!doctype html><title>ARTICOLO</title><p>articolo</p><iframe id="ri" width="420" height="300" style="border:0" src="http://b.localhost:${porta}/post"></iframe>`);
    else if (/vista=1/.test(String(req.headers.cookie || ''))) res.end('<p id="ok">Il post</p>');
    else res.end('<p>Accedi per vedere il post</p>');
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { porta: s.address().port, chiudi: () => new Promise((r) => { try { s.closeAllConnections?.(); } catch (_) {} s.close(r); }) };
}
const proposteRiquadro = (app) => app.evaluate(async ({ BrowserWindow }) => {
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

test('la proposta del riquadro rotto: la pagina ricaricata senza risposta la lascia ignorata, il «No» la rifiuta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const srv = await serviRiquadri();
  try {
    await app.evaluate(() => {
      globalThis.__filoRiquadriRotti.servizioTest({ nome: 'Fotogrammi', domini: ['b.localhost'], segnaposto: ['accedi per vedere il post'] });
      globalThis.SN_URL_NAV.isHomeNetworkUrl = () => false;
    });
    const page = await openTab(`http://a.localhost:${srv.porta}/art`);
    await expect.poll(async () => (await proposteRiquadro(app)).length, { timeout: 25_000 }).toBe(1);
    await page.reload();
    await expect.poll(() => voce(app, 'proposta_sulla_pagina', 'riquadro_rotto:ignorata'), { timeout: 10_000 }).toBe(1);
    let p = null;
    await expect.poll(async () => { [p] = await proposteRiquadro(app); return Boolean(p); }, { timeout: 25_000 }).toBe(true);
    await page.mouse.click(p.no.x, p.no.y);
    await expect.poll(() => voce(app, 'proposta_sulla_pagina', 'riquadro_rotto:rifiutata'), { timeout: 10_000 }).toBe(1);
    expect(await voce(app, 'proposta_sulla_pagina', 'riquadro_rotto:ignorata')).toBe(1);
    expect(await statoContatori(app)).not.toContain('localhost');
  } finally {
    await srv.chiudi();
  }
});

const EMAIL = 'chi-usa-filo@example.com';
const MODULO = `<!doctype html><html><head><title>Accedi</title></head><body style="margin:0;padding:40px">
  <form onsubmit="return false"><input type="email" id="e" name="email" style="width:320px;height:32px"></form>
  <p><input type="text" id="altro" name="citta"></p></body></html>`;
const emailMostrata = (app) => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.propostaEmail.mostrata);
async function tasto(app, keyCode) {
  await app.evaluate(({ BrowserWindow }, k) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }, keyCode);
}

test('la proposta dell’email: Esc la rifiuta, freccia e Invio l’accettano con la tastiera, il campo lasciato la ignora', async ({ app, openTab, testServer }) => {
  await app.evaluate((_e, email) => {
    const M = process.getBuiltinModule('module');
    const ga = M._cache[Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x))].exports;
    ga.isSignedIn = () => true;
    ga.getProfile = () => ({ email, name: 'Chi Usa Filo', picture: '' });
  }, EMAIL);
  const page = await testServer.openReady(openTab, MODULO);
  await page.click('#e');
  await expect.poll(() => emailMostrata(app), { timeout: 8_000 }).toBe(true);
  await tasto(app, 'Escape');
  await expect.poll(() => voce(app, 'proposta_sulla_pagina', 'email_account:rifiutata')).toBe(1);
  await page.click('#e');
  await expect.poll(() => emailMostrata(app), { timeout: 8_000 }).toBe(true);
  await tasto(app, 'Down');
  await tasto(app, 'Return');
  await expect.poll(() => page.inputValue('#e')).toBe(EMAIL);
  await expect.poll(() => voce(app, 'proposta_sulla_pagina', 'email_account:accettata:tastiera')).toBe(1);
  // Svuotato e ripreso, poi lasciato per un altro campo: sparita senza risposta.
  await page.fill('#e', '');
  await page.click('#e');
  await expect.poll(() => emailMostrata(app), { timeout: 8_000 }).toBe(true);
  await page.click('#altro');
  await expect.poll(() => voce(app, 'proposta_sulla_pagina', 'email_account:ignorata'), { timeout: 8_000 }).toBe(1);
  const tutte = (await homePagina(app)).proposta_sulla_pagina;
  expect(tutte).toEqual({ 'email_account:rifiutata': 1, 'email_account:accettata:tastiera': 1, 'email_account:ignorata': 1 });
  expect(await statoContatori(app)).not.toContain('example.com');
});

test('restare connessi: come se ne va l’avviso è la risposta; da una pagina web arriva solo la pubblicità saltata', async ({ app }) => {
  const SITO = { url: 'https://www.youtube.com/watch?v=x' };
  for (const esito of ['azione_0', 'chiusa_x', 'scaduta', 'chiuse_tutte']) {
    await evento(app, { misura: 'notifica', tipo: 'resta_connesso_proposta', esito }, BARRA);
  }
  await evento(app, { misura: 'notifica', tipo: 'proposta_email_spenta', esito: 'chiusa_x' }, BARRA);
  expect((await evento(app, { misura: 'automatismo', tipo: 'pubblicita_saltata' }, SITO)).ok).toBe(true);
  expect((await evento(app, { misura: 'automatismo', tipo: 'banner_cookie' }, SITO)).ok, 'quello che conta il main non arriva da una pagina').toBe(false);
  await expect.poll(() => voce(app, 'automatismo_fatto', 'pubblicita_saltata')).toBe(1);
  const d = await homePagina(app);
  expect(d.proposta_sulla_pagina).toEqual({ 'resta_connesso:accettata': 1, 'resta_connesso:rifiutata': 1, 'resta_connesso:ignorata': 2 });
  expect(d.automatismo_fatto).toEqual({ pubblicita_saltata: 1 });
});
