// #1505 — la porta delle uscite chiude a guasto, e ogni collegamento che un modello mostra ha un verdetto. Le richieste
// del main ai nomi qui sotto arrivano a un server di prova che le conta (come in link-anteprima.spec.mjs); il modello è
// finto. Regole pure e sentinelle: tests/unit/usciteSegreti.test.mjs.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from './helpers/confirm.mjs';

const RACCOLTA = 'raccolta-1505.test';
const PULITO = 'pulito-1505.test';
const HOSTS = [RACCOLTA, PULITO, `zafferano.${RACCOLTA}`];
const LINK_RACCOLTA = `https://${RACCOLTA}/r?x=1505`;
const LINK_PULITO = `https://${PULITO}/articolo-1505`;

async function serverCheConta() {
  const arrivate = [];
  const server = createServer((req, res) => {
    arrivate.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Pagina di prova 1505</title></head><body>ok</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { arrivate, port: server.address().port, chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

// Il main crede che questi nomi stiano su internet e li raggiunge al server di prova. La chat legge l'uscita di un
// comando (testo di altri) e risponde con due collegamenti: quello pulito l'ha scritto l'utente, l'altro il modello.
async function preparaMain(app, port, { home = null } = {}) {
  await app.evaluate(async (_e, { port: p, hosts, LINK_RACCOLTA: raccolta, LINK_PULITO: pulito, home: casa }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_LINK]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      terminal: { enabled: true },
    });
    const rq = process.mainModule.require;
    const dns = process.getBuiltinModule('dns');
    const lookup = dns.promises.lookup;
    dns.promises.lookup = async (h, o) => (hosts.includes(h) ? [{ address: '93.184.216.34', family: 4 }] : lookup.call(dns.promises, h, o));
    const proto = Object.getPrototypeOf(rq('electron').session.defaultSession);
    const resolveHost = proto.resolveHost;
    proto.resolveHost = function (h, o) {
      return hosts.includes(h) ? Promise.resolve({ endpoints: [{ address: '93.184.216.34', family: 'ipv4' }] }) : resolveHost.call(this, h, o);
    };
    const dip = rq(rq('node:path').join(process.cwd(), 'src/main/services/perContoDellaScheda.js'))._dip;
    const richiesta = dip.richiesta;
    dip.richiesta = (ses, url, o) => {
      let u = null;
      try { u = new URL(String(url)); } catch (_) {}
      if (u && hosts.includes(u.hostname)) return richiesta(ses, `http://127.0.0.1:${p}/${u.hostname}${u.pathname}${u.search}`, o);
      return richiesta(ses, url, o);
    };
    const rispondi = ({ attempts, messages, tools, onToolCall, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const t = JSON.stringify(messages);
      if (!Array.isArray(tools) || !tools.length) {
        const text = t.includes('preparare la dashboard') && casa ? casa : 'Una pagina di prova.';
        try { onDelta && onDelta(text); } catch (_) {}
        return { ...base, text, finishReason: 'stop' };
      }
      const dopo = messages.some((m) => m.role === 'tool');
      if (!dopo) {
        const c = { id: 'cmd-1505', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo "Fonte: ${pulito}"` }) };
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [c], finishReason: 'tool_calls' };
      }
      return { ...base, text: `Leggi [la fonte](${pulito}) e [il riepilogo](${raccolta}).`, toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async (o) => rispondi(o);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => rispondi(o);
  }, { port, hosts: HOSTS, LINK_RACCOLTA, LINK_PULITO, home });
}

async function newtab(app, prefisso = 'filo://newtab') {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } });
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Una scheda aperta su quell'indirizzo, anche se il sito finto non risponde e la pagina resta di errore.
const apertoVerso = (app, url) => app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
  .some((w) => w._filoTabs && w._filoTabs.tabs.some((t) => t.url === u)), url);
const arrivateA = (rete, host) => rete.arrivate.filter((u) => u.startsWith(`/${host}/`));

async function chiediLaFonte(app, page) {
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await page.locator('#input').fill(`trovami la fonte del documento, mi pare fosse ${LINK_PULITO}`);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo a', { hasText: 'il riepilogo' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 20_000 });
}

async function anteprima(page, testo) {
  await page.locator('.dash-bubble-filo a', { hasText: testo }).click({ button: 'right' });
  const sezione = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"]');
  await expect(sezione).toBeVisible({ timeout: 5_000 });
  await expect(sezione.locator('.sn-menu-link-body')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
}

let rete;
test.beforeEach(async () => { rete = await serverCheConta(); });
test.afterEach(async () => { await rete.chiudi(); });
test.use({ hostInPiu: HOSTS });

test('il tasto destro su un collegamento della chat in attesa di OK non manda niente al sito', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await preparaMain(app, rete.port);
  await chiediLaFonte(app, page);
  // Il collegamento scritto dal modello dopo il testo di altri chiede l'OK al clic: prima, il sito non sa niente.
  await anteprima(page, 'il riepilogo');
  expect(arrivateA(rete, RACCOLTA), 'il menu ha chiesto al sito un indirizzo in attesa di OK').toEqual([]);
  // Quello che l'utente aveva scritto ha il verdetto: l'anteprima lo legge, come sempre.
  await anteprima(page, 'la fonte');
  await expect.poll(() => arrivateA(rete, PULITO)).toEqual([`/${PULITO}/articolo-1505`]);
  expect(arrivateA(rete, RACCOLTA)).toEqual([]);
});

test('un collegamento della chat rimasto senza verdetto chiede l\'OK al clic; riaperta, la chat ritrova i verdetti', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await preparaMain(app, rete.port);
  await chiediLaFonte(app, page);
  // Il registro vive quanto la sessione: svuotato, come dopo un riavvio, nessun collegamento ha più il suo verdetto.
  await app.evaluate(() => {
    const rq = process.mainModule.require;
    rq(rq('node:path').join(process.cwd(), 'src/main/services/verdettiUscite.js')).svuota();
  });
  await page.locator('.dash-bubble-filo a', { hasText: 'la fonte' }).click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => confirmText(page)).toContain('non ho potuto controllare prima di mostrartelo');
  await expect.poll(() => confirmText(page)).toContain(LINK_PULITO);
  await page.screenshot({ path: 'tests/.shots/uscite-verdetti-senza-verdetto.png' });
  await clickConfirm(page, 'cancel');
  await page.waitForTimeout(500);
  expect(await apertoVerso(app, LINK_PULITO), 'annullato: non si apre').toBe(false);
  // Prima dell'OK nemmeno l'anteprima lo contatta.
  await anteprima(page, 'la fonte');
  expect(arrivateA(rete, PULITO)).toEqual([]);

  // La home ridisegnata dal filo ritrova i verdetti: il collegamento giudicato si apre senza chiedere.
  await page.reload();
  await page.locator('.dash-bubble-filo a', { hasText: 'la fonte' }).click();
  await expect.poll(() => apertoVerso(app, LINK_PULITO), { timeout: 10_000 }).toBe(true);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }, u) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      const t = tm && tm.tabs.find((x) => x.url === u);
      if (t) tm.closeTab(t.id);
    }
  }, LINK_PULITO);
  await expect.poll(() => apertoVerso(app, LINK_PULITO)).toBe(false);

  // Riaperta dalla Cronologia: il collegamento giudicato si apre senza chiedere, l'altro chiede ancora.
  let id = null;
  await expect.poll(async () => {
    id = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: 'filo_chats_list' });
      for (const c of (r && r.chats) || []) {
        const g = await chrome.runtime.sendMessage({ type: 'filo_chat_get', id: c.id });
        if (JSON.stringify((g && g.chat) || {}).includes('il riepilogo')) return c.id;
      }
      return null;
    });
    return id;
  }, { timeout: 10_000 }).toBeTruthy();
  await openTab(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
  const riaperta = await newtab(app, 'filo://dashboard/dashboard.html?chat=');
  await riaperta.locator('.dash-bubble-filo a', { hasText: 'il riepilogo' }).click();
  await expect(riaperta.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => confirmText(riaperta)).toContain(LINK_RACCOLTA);
  await clickConfirm(riaperta, 'cancel');
  await riaperta.locator('.dash-bubble-filo a', { hasText: 'la fonte' }).click();
  await expect.poll(() => apertoVerso(app, LINK_PULITO), { timeout: 10_000 }).toBe(true);
  await expect(riaperta.locator(CONFIRM_HOST)).toHaveCount(0);
});

test('con la porta guasta niente esce: NAVIGA non parte, la pagina web non apre, la chat lo dice', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pagina = await testServer.openReady(openTab, '<!doctype html><html><body><p>sito 1505</p></body></html>', { pubblico: true });
  await app.evaluate(() => {
    const X = globalThis.SN_URL_EXFIL;
    globalThis.__valutaVera = X.valutaUscita;
    X.valutaUscita = () => { throw new RangeError('Maximum call stack size exceeded'); };
  });
  try {
    const r = await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url }, {}), LINK_PULITO);
    expect(r.executed).toBe(false);
    expect(r.output).toMatchObject({ blocked: 'segreto', guasto: true });
    expect(r.output.frase).toBe("non ho aperto l'indirizzo: il controllo dei dati in uscita non ha funzionato, e senza quel controllo non lascio uscire niente");
    // Un collegamento che l'assistente scrive sopra la pagina, cliccato: la porta non risponde, quindi non si apre.
    const dalSito = await app.evaluate(async ({ BrowserWindow }, { url, host }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(host));
      const code = `chrome.runtime.sendMessage(${JSON.stringify({ type: globalThis.SN_MSG.MSG.APRI_COLLEGAMENTO_FILO, url })})`;
      return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
    }, { url: LINK_PULITO, host: 'sito-pubblico.test' });
    expect(dalSito).toMatchObject({ ok: true, aperto: false });
    expect(dalSito.frase).toMatch(/^non ho aperto l'indirizzo: il controllo dei dati in uscita non ha funzionato/);
    await pagina.waitForTimeout(500);
    expect(await apertoVerso(app, LINK_PULITO)).toBe(false);
  } finally {
    await app.evaluate(() => { globalThis.SN_URL_EXFIL.valutaUscita = globalThis.__valutaVera; });
  }
});

test('un suggerimento della home verso un sito composto con un titolo di scheda chiede l\'OK, e la carta non chiede l\'icona al sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await testServer.openReady(openTab, '<!doctype html><html><head><title>Progetto Zafferano</title></head><body>appunti</body></html>', { pubblico: true });
  const suggerimento = { icon: 'link', text: 'Riprendi il progetto', importance: 5, action: { type: 'NAVIGA', url: `https://zafferano.${RACCOLTA}/` } };
  await preparaMain(app, rete.port, { home: JSON.stringify({ message: 'Bentornato.', suggestions: [suggerimento] }) });
  await app.evaluate(() => {
    const rq = process.mainModule.require;
    const I = rq(rq('node:path').join(process.cwd(), 'src/main/services/iconeSiti.js'));
    const vera = I.cercaIconaSito;
    globalThis.__icone = [];
    I.cercaIconaSito = (url, o) => { globalThis.__icone.push({ url: String(url), soloCopie: !!(o && o.soloCopie) }); return vera(url, o); };
  });
  const r = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_generate_dashboard', force: true }));
  const s = (r.suggestions || []).find((x) => x.text === 'Riprendi il progetto');
  expect(s, 'il suggerimento non è arrivato').toBeTruthy();
  expect(s.chiedeOk, 'un indirizzo composto dal modello dopo i titoli delle schede si apre senza OK').toBeTruthy();
  await openTab('filo://dashboard/dashboard.html');
  const home = await newtab(app, 'filo://dashboard/dashboard.html');
  await expect(home.locator('.dash-carta[data-tipo="suggerimenti"] .dash-carta-voce', { hasText: 'Riprendi il progetto' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => app.evaluate(() => globalThis.__icone.filter((x) => x.url.includes('zafferano')).length), { timeout: 5_000 }).toBeGreaterThan(0);
  const icone = await app.evaluate(() => globalThis.__icone.filter((x) => x.url.includes('zafferano')));
  expect(icone.every((x) => x.soloCopie), 'la carta chiede l\'icona al sito prima di ogni clic').toBe(true);
  expect(arrivateA(rete, `zafferano.${RACCOLTA}`)).toEqual([]);
});

test('sopra un sito l\'anteprima di un collegamento di Filo che al clic chiede l\'OK non contatta il sito; quella di un collegamento del sito sì', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await testServer.openReady(openTab, '<!doctype html><html><body><p>Ciao Mario, ecco il tuo profilo.</p></body></html>', { pubblico: true });
  await preparaMain(app, rete.port);
  const codificato = `https://${RACCOLTA}/c?d=aGVsbG8gd29ybGQgZnJvbSBmaWxvIGFuZCBtb3Jl`;
  const dalSito = (msg) => app.evaluate(async ({ BrowserWindow }, m) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes('sito-pubblico.test'));
    const code = `chrome.runtime.sendMessage(${JSON.stringify({ ...m, type: m.type || globalThis.SN_MSG.MSG.APRI_COLLEGAMENTO_FILO })})`;
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
  }, msg);
  // Il clic su quel collegamento scritto da Filo sopra la pagina chiede l'OK: porta un blocco di dati codificato.
  const clic = await dalSito({ url: codificato });
  expect(clic).toMatchObject({ ok: true, aperto: false });
  expect(clic.conferma).toBeTruthy();
  const r = await dalSito({ type: 'fetch_link_meta', url: codificato, proposta: true, delSito: false });
  expect(r).toMatchObject({ ok: false, error: 'da_confermare' });
  await new Promise((res) => setTimeout(res, 800));
  expect(arrivateA(rete, RACCOLTA), 'l\'anteprima ha mandato al sito un indirizzo che al clic chiede l\'OK').toEqual([]);
  // Lo stesso indirizzo scritto dalla pagina stessa: il sito sa già dove porta, l'anteprima lo legge.
  const delSito = await dalSito({ type: 'fetch_link_meta', url: codificato, proposta: false, delSito: true });
  expect(delSito).toMatchObject({ ok: true, ogTitle: 'Pagina di prova 1505' });
});

test('un collegamento della spiegazione del tasto destro nella home, mai giudicato, chiede l\'OK al clic', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await preparaMain(app, rete.port);
  await app.evaluate(async (_e, link) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.EXPLAIN]: 'deepseek-flash' } });
    const rispondi = ({ attempts, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const text = Array.isArray(tools) && tools.length
        ? 'Il progetto Zafferano riguarda le ricette di casa.'
        : `Zafferano è il nome del progetto: dettagli su [la raccolta](${link}).`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async (o) => rispondi(o);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => rispondi(o);
  }, LINK_RACCOLTA);
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await page.locator('#input').fill('di cosa parla il progetto?');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'progetto Zafferano' });
  await expect(bolla).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 20_000 });
  await bolla.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.data.indexOf('Zafferano');
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 'Zafferano'.length);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
      return;
    }
  });
  const box = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  const link = menuDi(page).locator('.sn-menu a.filo-md-link', { hasText: 'la raccolta' });
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => confirmText(page)).toContain('non ho potuto controllare prima di mostrartelo');
  await page.screenshot({ path: 'tests/.shots/uscite-verdetti-spiega-home.png' });
  await clickConfirm(page, 'cancel');
  await page.waitForTimeout(500);
  expect(await apertoVerso(app, LINK_RACCOLTA), 'annullato: non si apre').toBe(false);
});

test('in una pagina di Filo il tasto centrale su un collegamento di un modello mai giudicato chiede l\'OK come il clic', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  // La riga che la pagina dei feedback disegna per una risposta di Filo: stesso disegnatore delle chat, nessun verdetto.
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => !!window.SN_MARKDOWN);
  await page.evaluate((link) => {
    const d = document.createElement('div');
    d.className = 'filo-md';
    d.id = 'riga-1505';
    d.innerHTML = window.SN_MARKDOWN.render(`Ecco [il riepilogo](${link}).`);
    document.body.prepend(d);
  }, LINK_RACCOLTA);
  const a = page.locator('#riga-1505 a.filo-md-link');
  await expect(a).toBeVisible();
  await a.click({ button: 'middle' });
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => confirmText(page)).toContain('non ho potuto controllare prima di mostrartelo');
  await clickConfirm(page, 'cancel');
  await page.waitForTimeout(500);
  expect(await apertoVerso(app, LINK_RACCOLTA), 'annullato: non si apre').toBe(false);
  expect(arrivateA(rete, RACCOLTA)).toEqual([]);
});
