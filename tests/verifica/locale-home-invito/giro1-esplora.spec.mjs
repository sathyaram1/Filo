// Verifica locale di claude/home-invito: la home già aperta dopo un riscatto, e il fornitore
// remoto «gemini» che non deve spegnere le funzioni con chiave. Server dei crediti finto.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
let base;
const stato = { redeemed: false, pendingCode: null, modelsDoc: null, trattieni: false, trattenute: [] };
const PERSONAL = 'sk-or-v1-test-personal';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url.includes('/documents/config/models')) return stato.modelsDoc ? json(res, 200, stato.modelsDoc) : json(res, 404, {});
      if (url.includes('/documents/')) return json(res, 404, {});
      if (url === '/walletState') {
        if (!stato.redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletPendingInvite') {
        const rispondi = () => json(res, 200, { result: stato.pendingCode && !stato.redeemed ? { status: 'ok', code: stato.pendingCode } : { status: 'none' } });
        if (stato.trattieni) { stato.trattenute.push(rispondi); return undefined; }
        return rispondi();
      }
      if (url === '/walletRedeem') {
        stato.redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL, pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
  stato.redeemed = false;
  stato.pendingCode = null;
  stato.modelsDoc = null;
  stato.trattieni = false;
  stato.trattenute.length = 0;
});

async function homePage(app) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded').catch(() => {}); return w; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('home non trovata');
}

// Modelli finti nel main, e la config remota di Firestore servita dal server finto.
async function prepara(app) {
  await app.evaluate((_, b) => {
    if (!globalThis.__filoFetchVero) {
      const vero = globalThis.fetch;
      globalThis.__filoFetchVero = vero;
      globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
    }
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = { dashboard: 0, chat: 0 };
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('preparare la dashboard')) {
        globalThis.__visti.dashboard += 1;
        return JSON.stringify({ message: 'HOME-DAL-MODELLO: ciao di nuovo.', suggestions: [] });
      }
      globalThis.__visti.chat += 1;
      return JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => {
      const text = reply(messages);
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, base);
}

async function onboardingFatto(app) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const cur = await M.getOnboarding();
    await M.setOnboarding({ ...cur, done: true });
  });
}

// `openTab` cerca la scheda per nome dell'host e ridarebbe la home già aperta.
async function nuovaHome(app, shell) {
  const prima = new Set(app.windows());
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => !prima.has(x) && x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded').catch(() => {}); return w; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('scheda nuova non trovata');
}

async function riscattaDaCrediti(openTab) {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20_000 });
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20_000 });
  return page;
}

const stato_home = (home) => home.evaluate(() => ({
  state: document.body.dataset.state,
  msg: document.getElementById('homeMessage')?.innerText || '',
  sugg: document.getElementById('suggestions')?.innerText || '',
  bolle: [...document.querySelectorAll('.dash-bubble')].map((b) => b.innerText).join(' | ').slice(0, 300),
}));

test('utente nuovo: riscatta dalla pagina Crediti con la home aperta', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app);
  const home = await homePage(app);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  await riscattaDaCrediti(openTab);
  await shell.locator('.tab').first().click();
  await expect.poll(async () => (await stato_home(home)).msg + (await stato_home(home)).sugg, { timeout: 25_000 })
    .not.toMatch(/codice d.invito|riscatta l.invito/i);
  await home.waitForTimeout(8000);
  console.log('[UTENTE NUOVO] home aperta dopo il riscatto:', JSON.stringify(await stato_home(home)));
  const nuova = await nuovaHome(app, shell);
  await nuova.waitForTimeout(8000);
  console.log('[UTENTE NUOVO] scheda nuova dopo il riscatto:', JSON.stringify(await stato_home(nuova)));
  // Chi arriva ora ha un modello: l'accoglienza parte anche nella home rimasta aperta.
  await expect(home.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 5_000 });
});

test('utente già accolto: riscatta dalla pagina Crediti con la home aperta', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app);
  await onboardingFatto(app);
  const home = await homePage(app);
  await home.reload();
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  await riscattaDaCrediti(openTab);
  await shell.locator('.tab').first().click();
  await expect(home.locator('#homeMessage')).toContainText('HOME-DAL-MODELLO', { timeout: 30_000 });
  await expect(home.locator('#suggestions')).not.toContainText(/riscatta/i);
  console.log('[ACCOLTO] home:', JSON.stringify(await stato_home(home)));
});

test('invito dal collegamento filo://invito con la home aperta', async ({ app }) => {
  test.setTimeout(150_000);
  await prepara(app);
  await onboardingFatto(app);
  const home = await homePage(app);
  await home.reload();
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  const out = await app.evaluate(async () => globalThis.SN_WALLET_MAIN.redeemFromInvite('ABCD-EFGH'));
  expect(out.ok).toBe(true);
  await expect(home.locator('#homeMessage')).not.toContainText(/codice d.invito/i, { timeout: 25_000 });
  await expect(home.locator('#homeMessage')).toContainText('HOME-DAL-MODELLO', { timeout: 30_000 });
  console.log('[LINK] home:', JSON.stringify(await stato_home(home)));
});

test('primo avvio con un invito in attesa', async ({ app }) => {
  test.setTimeout(150_000);
  stato.pendingCode = 'ABCDEFGH';
  await prepara(app);
  const home = await homePage(app);
  await expect.poll(() => stato.redeemed, { timeout: 40_000 }).toBe(true);
  await expect.poll(async () => (await stato_home(home)).msg + (await stato_home(home)).sugg, { timeout: 25_000 })
    .not.toMatch(/codice d.invito|riscatta l.invito/i);
  await home.waitForTimeout(6000);
  console.log('[PENDING] home:', JSON.stringify(await stato_home(home)));
});

test('primo avvio: l’invito in attesa arriva quando la home è già su «serve un codice»', async ({ app, shell }) => {
  test.setTimeout(150_000);
  stato.pendingCode = 'ABCDEFGH';
  stato.trattieni = true;
  await prepara(app);
  const home = await homePage(app);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  await expect.poll(() => stato.trattenute.length, { timeout: 30_000 }).toBeGreaterThan(0);
  stato.trattieni = false;
  for (const r of stato.trattenute.splice(0)) r();
  await expect.poll(() => stato.redeemed, { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => (await stato_home(home)).msg + (await stato_home(home)).sugg, { timeout: 25_000 })
    .not.toMatch(/codice d.invito|riscatta l.invito/i);
  await home.waitForTimeout(8000);
  console.log('[PENDING TARDIVO] home aperta:', JSON.stringify(await stato_home(home)));
  const nuova = await nuovaHome(app, shell);
  await nuova.waitForTimeout(8000);
  console.log('[PENDING TARDIVO] scheda nuova:', JSON.stringify(await stato_home(nuova)));
  await expect(home.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 5_000 });
});

test('identità annullata con la home aperta: torna a chiedere l’invito', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app);
  await onboardingFatto(app);
  const home = await homePage(app);
  await home.reload();
  await riscattaDaCrediti(openTab);
  await expect(home.locator('#homeMessage')).toContainText('HOME-DAL-MODELLO', { timeout: 30_000 });
  const cr = { tab: { id: 6, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' };
  stato.redeemed = false;
  await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_reset_identity' }, s), cr);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 25_000 });
  await riscattaDaCrediti(openTab);
  await expect(home.locator('#homeMessage')).not.toContainText(/codice d.invito/i, { timeout: 25_000 });
  await home.waitForTimeout(5000);
  console.log('[RIENTRO] home dopo il secondo riscatto:', JSON.stringify(await stato_home(home)));
});

test('chiave propria messa e tolta, identità annullata: la home segue', async ({ app }) => {
  test.setTimeout(150_000);
  await prepara(app);
  await onboardingFatto(app);
  const home = await homePage(app);
  await home.reload();
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  const opt = { tab: { id: 5, url: 'filo://options/options.html' }, url: 'filo://options/options.html' };
  await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-or-v1-mia' } } }, s), opt);
  await expect(home.locator('#homeMessage')).not.toContainText(/codice d.invito/i, { timeout: 25_000 });
  console.log('[CHIAVE MESSA] home:', JSON.stringify(await stato_home(home)));
  await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: '' } } }, s), opt);
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 25_000 });
  console.log('[CHIAVE TOLTA] home:', JSON.stringify(await stato_home(home)));
});

test('config remota col fornitore gemini: con i crediti Filo funziona', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  stato.modelsDoc = {
    fields: {
      provider: { stringValue: 'gemini' },
      geminiDirect: { booleanValue: true },
      modelRegistry: { mapValue: { fields: { base: { mapValue: { fields: { provider: { stringValue: 'openrouter' }, model: { stringValue: 'test/base' } } } } } } },
      models: { mapValue: { fields: { filo_chat: { stringValue: 'base' }, filo_dashboard: { stringValue: 'base' }, filo_lesson: { stringValue: 'base' }, filo_compact: { stringValue: 'base' }, archive_embed: { stringValue: 'embed-004' } } } },
    },
  };
  await prepara(app);
  const provider = await app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const D = req('./services/defaultsStore');
    const eff = await D.refresh();
    return eff.provider;
  });
  console.log('[GEMINI] fornitore effettivo dopo la config remota:', provider);
  await riscattaDaCrediti(openTab);
  const filo = { tab: { id: 8, url: 'filo://newtab/' }, url: 'filo://newtab/' };
  const onb = await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'filo_get_onboarding', peek: true }, s), filo);
  expect(onb.ready).toBe(true);
  const nuova = await nuovaHome(app, shell);
  await expect(nuova.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });

  // Chi i modelli li sceglie da sé, con un fornitore «gemini» salvato da una versione vecchia.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, provider: 'gemini', apiKeys: { openrouter: 'sk-or-v1-mia' }, models: { filo_chat: 'deepseek-flash', filo_dashboard: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
  });
  const onb2 = await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'filo_get_onboarding', peek: true }, s), filo);
  expect(onb2.ready).toBe(true);
  const dash = await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'filo_generate_dashboard', force: true }, s), filo);
  console.log('[GEMINI] home con modelli propri:', JSON.stringify(dash).slice(0, 300));
  expect(String(dash.message || '')).toContain('HOME-DAL-MODELLO');
});
