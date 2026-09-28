// Chi è nuovo e riceve un modello con la home già aperta (invito riscattato, invito del primo
// avvio, chiave propria) vede partire lì l'intervista di benvenuto, senza una home scritta dal
// modello per uno sconosciuto. Server dei crediti finto, come in wallet-credits.spec.mjs.
import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

let server;
const stato = { redeemed: false, pendingCode: null, trattieni: false, trattenute: [] };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') return json(res, 200, { result: stato.redeemed ? { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000 }, invites: [] } : { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletPendingInvite') {
        const rispondi = () => json(res, 200, { result: stato.pendingCode && !stato.redeemed ? { status: 'ok', code: stato.pendingCode } : { status: 'none' } });
        if (stato.trattieni) { stato.trattenute.push(rispondi); return undefined; }
        return rispondi();
      }
      if (url === '/walletRedeem') {
        stato.redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }
      return json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
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
  stato.trattieni = false;
  stato.trattenute.length = 0;
});

async function homeCheChiedeIlCodice(app) {
  let home = null;
  const scadenza = Date.now() + 25_000;
  while (Date.now() < scadenza && !home) {
    home = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    if (!home) await new Promise((r) => setTimeout(r, 200));
  }
  expect(home, 'la home si apre all’avvio').toBeTruthy();
  await home.waitForLoadState('domcontentloaded').catch(() => {});
  await expect(home.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
  // Ogni home scritta dal modello si conta: a chi deve fare l'intervista non ne serve nessuna.
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__homeDalModello = 0;
    const finto = async ({ attempts, messages }) => {
      if (JSON.stringify(messages || []).includes('preparare la dashboard')) globalThis.__homeDalModello += 1;
      return { text: JSON.stringify({ message: 'HOME-DAL-MODELLO', suggestions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  });
  return home;
}

async function partitaLAccoglienza(app, home) {
  await expect(home.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 25_000 });
  await expect(home.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo');
  await expect(home.locator('body')).not.toContainText(/codice d.invito|riscatta l.invito/i);
  expect(await app.evaluate(() => globalThis.__homeDalModello)).toBe(0);
}

test('invito riscattato dalla pagina Crediti: l’intervista parte nella home aperta', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const home = await homeCheChiedeIlCodice(app);
  const crediti = await openTab('filo://credits/credits.html');
  await expect(crediti.locator('#redeemForm')).toBeVisible({ timeout: 20_000 });
  await crediti.fill('#inviteCode', 'ABCD-EFGH');
  await crediti.click('#redeemBtn');
  await expect(crediti.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20_000 });
  await shell.locator('.tab').first().click();
  await partitaLAccoglienza(app, home);
});

test('invito del primo avvio che arriva a home già aperta: l’intervista parte lì', async ({ app }) => {
  test.setTimeout(120_000);
  stato.pendingCode = 'ABCDEFGH';
  stato.trattieni = true;
  const home = await homeCheChiedeIlCodice(app);
  await expect.poll(() => stato.trattenute.length, { timeout: 30_000 }).toBeGreaterThan(0);
  stato.trattieni = false;
  for (const r of stato.trattenute.splice(0)) r();
  await expect.poll(() => stato.redeemed, { timeout: 20_000 }).toBe(true);
  await partitaLAccoglienza(app, home);
});

test('chiave OpenRouter propria messa dalle Impostazioni: l’intervista parte nella home aperta', async ({ app }) => {
  test.setTimeout(120_000);
  const home = await homeCheChiedeIlCodice(app);
  const opzioni = { tab: { id: 5, url: 'filo://options/options.html' }, url: 'filo://options/options.html' };
  await app.evaluate(async (_, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-or-v1-mia' } } }, s), opzioni);
  await partitaLAccoglienza(app, home);
});
