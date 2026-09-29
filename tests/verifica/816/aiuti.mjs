// #816 — banco comune delle prove: server dei crediti e identità finti (HTTP locale), riscatto,
// home di avvio e schede pubbliche seminate senza rete.

import { createServer } from 'node:http';
import { expect } from '../../fixtures/electron.mjs';

export const banco = {
  server: null, ritardoStato: 0, saldo: 4321.5, quota: 100, grants: [],
  azzera() {
    this.ritardoStato = 0; this.saldo = 4321.5; this.quota = 100;
    this.grants = [{ at: '2026-09-20T10:00:00.000Z', credits: 5000, why: 'entry' }];
  },
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function apriBanco() {
  banco.server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', async () => {
      const url = req.url.split('?')[0];
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-816' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-816' });
      if (url === '/walletState') {
        if (banco.ritardoStato) await new Promise((r) => setTimeout(r, banco.ritardoStato));
        return json(res, 200, { result: {
          hasWallet: true, pseudonym: 'abcdef0123456789',
          balance: { credits: banco.saldo, creditsGranted: 5000, eurUsd: 1.2, eurPerCredit: 0.0007 },
          stale: false, dailyCredits: banco.quota, grants: banco.grants, invites: [],
        } });
      }
      if (url === '/walletRedeem') {
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, inviteCodes: [] } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => banco.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${banco.server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
}

export async function chiudiBanco() {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => banco.server.close(r));
}

export async function riscatta(app) {
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'wallet_redeem', code: 'ABCD-EFGH' },
    { tab: { id: 8, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' },
  ));
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

// L'orologio del main avanti di un minuto: la chat torna a chiedere il saldo al server.
export function passaUnMinuto(app) {
  return app.evaluate(() => {
    const vero = globalThis.__dateNowVero || Date.now;
    globalThis.__dateNowVero = vero;
    globalThis.__spostamento = (globalThis.__spostamento || 0) + 61_000;
    Date.now = () => vero() + globalThis.__spostamento;
  });
}

export async function homeDiAvvio(app) {
  let win = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

export async function semina(app, schede) {
  await app.evaluate(async (_electron, { schede }) => {
    const clientId = 'client-816';
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId, filo_onboarding: { done: true } });
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const mioHash = await H.hashClientId(clientId);
    const cards = [];
    for (const c of schede) cards.push({ ...c, clientIdTag: await H.cardTag(c._id, mioHash) });
    globalThis.SN_FEEDBACK.listPublic = async () => cards;
    globalThis.SN_FEEDBACK.getManyPublic = async (ids) => {
      const voluti = new Set((ids || []).map(String));
      return cards.filter((c) => voluti.has(String(c._id)));
    };
    await globalThis.SN_FEEDBACK_MINE.scrivi({ ids: schede.map((c) => c._id), checkedAt: 0 });
  }, { schede });
}
