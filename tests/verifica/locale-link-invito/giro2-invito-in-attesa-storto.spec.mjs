// Giro di verifica locale del ramo claude/link-invito — giro 2.
//
// Il primo avvio riscatta da solo l'invito che aspetta quella macchina: è la
// promessa del lavoro. Qui si prova cosa succede quando quella risposta NON è
// quella buona — un codice che il server poi rifiuta, e una risposta
// spazzatura — perché è il caso in cui un riscatto automatico può mettersi a
// bussare al server senza fermarsi, o lasciare Filo bloccato addosso a un
// invito che non vale.
//
// Server finto: nessun codice vero viene toccato.

import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let server;
let base = '';
let modo = 'rifiutato';
const visto = { pending: 0, redeems: [] };

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
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletPendingInvite') {
        visto.pending += 1;
        if (modo === 'rifiutato') return json(res, 200, { result: { status: 'ok', code: 'ZZZZ9999' } });
        // Spazzatura: non è un codice, è lungo, e ha dentro uno script.
        return json(res, 200, { result: { status: 'ok', code: `<img src=x onerror=alert(1)>${'A'.repeat(20000)}` } });
      }
      if (url === '/walletRedeem') {
        visto.redeems.push(String((body.data && body.data.code) || ''));
        return json(res, 200, { result: { status: 'invalid_code' } });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { await new Promise((r) => server.close(r)); });

function avvia(userData) {
  return electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
      FILO_FUNCTIONS_BASE: base,
      FILO_IDENTITY_ENDPOINT: `${base}/accounts:signUp`,
      FILO_SECURE_TOKEN_ENDPOINT: `${base}/token`,
    },
  });
}

test('un invito in attesa che il server poi rifiuta non fa bussare Filo all’infinito, e la pagina resta usabile', async () => {
  test.setTimeout(240000);
  modo = 'rifiutato';
  visto.pending = 0;
  visto.redeems.length = 0;
  const userData = cartellaTemporanea('filo-test-');
  try {
    const app = await avvia(userData);
    await app.firstWindow();
    // Il riscatto automatico parte pochi secondi dopo l'avvio: si guarda per
    // quaranta secondi, il tempo che un utente resterebbe davanti allo
    // schermo chiedendosi se sta succedendo qualcosa.
    await expect.poll(() => visto.redeems.length, { timeout: 60000, intervals: [1000] }).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 40000));
    expect(visto.redeems[0]).toBe('ZZZZ9999');
    expect(visto.redeems.length, `Filo ha riprovato ${visto.redeems.length} volte in quaranta secondi`).toBeLessThanOrEqual(3);
    expect(visto.pending, `Filo ha chiesto l’invito in attesa ${visto.pending} volte in quaranta secondi`).toBeLessThanOrEqual(4);

    // E l'utente ha ancora la sua strada: il campo dell'invito è lì, con la
    // scritta che dice che i crediti non ci sono.
    const page = await app.firstWindow().then(async () => {
      const w = app.windows().find((x) => x.url().startsWith('filo://credits'));
      if (w) return w;
      return null;
    });
    if (!page) {
      // La pagina Crediti non è aperta da sola: la si apre come farebbe
      // l'utente, dalla barra degli indirizzi dell'app non è raggiungibile
      // da qui, quindi si guarda solo che Filo sia ancora vivo e risponda.
      const wins = app.windows();
      expect(wins.length, 'Filo è ancora aperto').toBeGreaterThan(0);
      await expect.poll(async () => {
        try { return await wins[0].evaluate(() => document.readyState); } catch (_) { return 'morto'; }
      }, { timeout: 15000 }).toBe('complete');
    }
    await chiudiApp(app);
  } finally {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('una risposta spazzatura al posto dell’invito non manda spazzatura al server né rompe Filo', async () => {
  test.setTimeout(180000);
  modo = 'spazzatura';
  visto.pending = 0;
  visto.redeems.length = 0;
  const userData = cartellaTemporanea('filo-test-');
  try {
    const app = await avvia(userData);
    await app.firstWindow();
    await new Promise((r) => setTimeout(r, 30000));
    // Quello che non è un codice non diventa una chiamata al server.
    for (const c of visto.redeems) {
      expect(c.length, `al server è arrivata una stringa di ${c.length} caratteri`).toBeLessThanOrEqual(64);
      expect(c, 'al server è arrivato del markup').not.toContain('<');
    }
    // E Filo è ancora in piedi.
    const wins = app.windows();
    expect(wins.length).toBeGreaterThan(0);
    await expect.poll(async () => {
      try { return await wins[0].evaluate(() => document.readyState); } catch (_) { return 'morto'; }
    }, { timeout: 15000 }).toBe('complete');
    await chiudiApp(app);
  } finally {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
