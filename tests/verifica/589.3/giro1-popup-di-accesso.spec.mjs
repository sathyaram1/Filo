// Verifica #589.3 — giro 1. Un popup «Accedi con…» aperto da un sito è una finestra vera
// con dentro un sito: il codice di Filo lì dentro deve ricevere gli stessi rifiuti della
// scheda del sito, coi dati veri dell'utente presenti (chat, scaricamento, intervista).

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

const MONDO_CONTENT_SCRIPT = 999;
const SEGRETO = 'SEGRETO-5893-numero-di-carta';
const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(2048));

// Chiede dal mondo dei content script della pagina principale della finestra-popup che
// porta `segno` nell'indirizzo (mai una scheda: le schede non sono finestre).
function dalPopup(app, segno) {
  return (msg) => app.evaluate(async ({ BrowserWindow }, { segno, m, mondo }) => {
    const w = BrowserWindow.getAllWindows()
      .filter((x) => !x._filoTabs && !x.isDestroyed() && String(x.webContents.getURL()).includes(segno)).pop();
    if (!w) throw new Error(`nessun popup su ${segno}`);
    const code = `chrome.runtime.sendMessage(${JSON.stringify(m)})`;
    return w.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
  }, { segno, m: msg, mondo: MONDO_CONTENT_SCRIPT });
}

async function popupPronto(app, segno) {
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }, segno) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    if (!w) return 'nessun popup';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoContentReady || "non pronto"'); } catch (_) { return 'non pronto'; }
  }, segno), { timeout: 15000 }).toBe('1');
}

async function scaricaUnFile(app, openTab, testServer) {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': 'attachment; filename="estratto-conto.pdf"' });
    res.end(PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const page = await testServer.openReady(openTab, `<a id="dl" href="http://127.0.0.1:${srv.address().port}/estratto-conto.pdf">scarica</a>`);
  await page.locator('#dl').click();
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  await expect.poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15000 }).toContain('estratto-conto.pdf');
  return { srv, dir };
}

// Tutto ciò che la risposta porta non deve contenere niente dell'utente.
function senzaDatiUtente(r, id, dir) {
  const s = JSON.stringify(r || {});
  return !s.includes(SEGRETO) && !s.includes(id) && !s.includes('estratto-conto') && !s.includes(dir);
}

test('dal popup di accesso non escono chat, scaricamenti, intervista e portafoglio, e non si cancella né si esce', async ({ app, shell, openTab, testServer }) => {
  const chatId = await app.evaluate(async () => {
    const C = globalThis.SN_FILO_CHATS;
    const e = await C.open({});
    await C.append(e.id, [{ role: 'user', text: 'Il mio ' + 'SEGRETO-5893-numero-di-carta' }]);
    return e.id;
  });
  const { srv, dir } = await scaricaUnFile(app, openTab, testServer);
  const dl = ((await shell.evaluate(() => window.filoShell.message({ type: 'downloads_list' }))) || {}).items || [];
  const dlId = dl.find((x) => x.filename === 'estratto-conto.pdf')?.id;
  expect(dlId, 'lo scaricamento di prova non è in elenco').toBeTruthy();

  const sito = await testServer.openReady(openTab, '<h1>sito con «Accedi con…»</h1>');
  const segno = 'client_id=v5893';
  const login = `${testServer.html('<h1>accedi</h1>')}?${segno}&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate((u) => { window.open(u, '_blank', 'width=480,height=600'); }, login);
  await popupPronto(app, segno);
  const chiedi = dalPopup(app, segno);

  const domande = [
    { type: 'filo_chats_list' },
    { type: 'filo_chat_get', id: chatId },
    { type: 'filo_chats_search', query: 'SEGRETO' },
    { type: 'filo_get_onboarding' },
    { type: 'downloads_list' },
    { type: 'wallet_state' },
    { type: 'filo_memory_view' },
    { type: 'permessi_siti_get' },
  ];
  for (const m of domande) {
    const r = await chiedi(m);
    expect(r?.error, `il popup ha avuto risposta a ${m.type}: ${JSON.stringify(r).slice(0, 300)}`).toBe('forbidden');
    expect(senzaDatiUtente(r, chatId, dir), `${m.type} ha portato dati dell'utente`).toBe(true);
  }

  // Le azioni: la chat resta, il file non si apre, l'account resta aperto.
  expect((await chiedi({ type: 'filo_chat_delete', id: chatId }))?.error).toBe('forbidden');
  expect((await chiedi({ type: 'download_open_file', id: dlId, confirmed: true }))?.error).toBe('forbidden');
  expect((await chiedi({ type: 'auth_signout' }))?.ok).not.toBe(true);
  const ancora = await shell.evaluate(() => window.filoShell.message({ type: 'filo_chats_list' }));
  expect((ancora?.chats || []).some((c) => c.id === chatId), 'la chat è stata cancellata dal popup').toBe(true);

  // Il giro vero di un OAuth: il popup torna sull'indirizzo di ritorno del sito e chiede di nuovo.
  const ritorno = `${testServer.html('<h1>ritorno</h1>')}?code=abc&state=${segno}`;
  await app.evaluate(({ BrowserWindow }, { segno, ritorno }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes(segno));
    return w.webContents.executeJavaScript(`location.href = ${JSON.stringify(ritorno)}`);
  }, { segno, ritorno });
  await popupPronto(app, `state=${segno}`);
  const dopo = await dalPopup(app, `state=${segno}`)({ type: 'filo_chats_list' });
  expect(dopo?.error, 'dopo il ritorno sul sito il popup ha l\'elenco delle chat').toBe('forbidden');

  // La barra continua ad avere tutto.
  const barra = await shell.evaluate(() => window.filoShell.message({ type: 'downloads_list' }));
  expect((barra?.items || []).some((x) => x.id === dlId)).toBe(true);
  await new Promise((r) => srv.close(r));
});

test('un popup di accesso aperto da un altro popup di accesso resta un sito', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<h1>sito</h1>');
  const primo = `${testServer.html('<h1>scegli account</h1>')}?client_id=p1v5893&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate((u) => { window.open(u, '_blank', 'width=480,height=600'); }, primo);
  await popupPronto(app, 'client_id=p1v5893');
  const secondo = `${testServer.html('<h1>verifica</h1>')}?client_id=p2v5893&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes('client_id=p1v5893'));
    return w.webContents.executeJavaScript(`window.open(${JSON.stringify(u)}, '_blank', 'width=400,height=500'); 1`, true);
  }, secondo);
  await popupPronto(app, 'client_id=p2v5893');
  for (const type of ['filo_chats_list', 'downloads_list', 'filo_get_onboarding', 'wallet_state']) {
    const r = await dalPopup(app, 'client_id=p2v5893')({ type });
    expect(r?.error, `il secondo popup ha avuto risposta a ${type}`).toBe('forbidden');
  }
});

test('un popup di accesso aperto nella finestra incognito resta un sito, e la barra incognito risponde', async ({ app, shell, testServer }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs?.tabs?.length)), { timeout: 15000 }).toBe(true);
  const sitoUrl = testServer.html('<h1>sito in incognito</h1>');
  await app.evaluate(({ BrowserWindow }, u) => { BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u); }, sitoUrl);
  const login = `${testServer.html('<h1>accedi</h1>')}?client_id=incv5893&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }, { sitoUrl, login }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => String(x.view.webContents.getURL()) === sitoUrl);
    if (!t) return false;
    try { await t.view.webContents.executeJavaScript(`window.open(${JSON.stringify(login)}, '_blank', 'width=480,height=600'); 1`, true); return true; } catch (_) { return false; }
  }, { sitoUrl, login }), { timeout: 15000 }).toBe(true);
  await popupPronto(app, 'client_id=incv5893');
  for (const type of ['filo_chats_list', 'downloads_list', 'filo_get_onboarding', 'wallet_state']) {
    const r = await dalPopup(app, 'client_id=incv5893')({ type });
    expect(r?.error, `il popup dell'incognito ha avuto risposta a ${type}`).toBe('forbidden');
  }
  const barraIncognito = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w.webContents.executeJavaScript('window.filoShell.message({ type: "downloads_list" })');
  });
  expect(barraIncognito?.ok, `la barra incognito non ha più gli scaricamenti: ${JSON.stringify(barraIncognito)}`).toBe(true);
});
