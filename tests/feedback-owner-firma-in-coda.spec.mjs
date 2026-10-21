// #912: il feedback dell'owner che aspetta la sua firma non brucia numeri col token rifiutato, senza rete non lo manda
// a rifare l'accesso, e se l'accesso è caduto prima non parte da anonimo. Rete finta nel main, sessione finta
// nella cartella dati isolata: niente Firestore vero.
import { test, expect } from './fixtures/electron.mjs';
import { resolve } from 'node:path';

const MAIN = resolve('src/main/main.js');

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
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

// `rete`: 'rifiuta' = Firestore rifiuta il token admin; 'spenta' = nessuna connessione; 'revocato' = il rinnovo
// della sessione è rifiutato; 'ok' = tutto accettato.
async function preparaOwner(app, rete) {
  await app.evaluate((_e, { MAIN, rete }) => {
    const req = process.getBuiltinModule('module').createRequire(MAIN);
    const cfg = req('./auth/config');
    req('./auth/token-store').save({ refreshToken: 'rt-finto', email: cfg.adminEmails[0], name: 'Owner' });
    req('./auth/google-auth').restore();
    const t = { rete, numeri: 0, create: [] };
    globalThis.__fo = t;
    const J = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    let contatore = 500;
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      const m = (init.method || 'GET').toUpperCase();
      if (t.rete === 'spenta') throw new TypeError('fetch failed');
      if (u.includes('securetoken')) {
        if (t.rete === 'revocato') return J(400, { error: { message: 'TOKEN_EXPIRED' } });
        return J(200, { id_token: 'h.eyJ1c2VyX2lkIjoib3duZXIifQ.s', refresh_token: 'rt-finto', expires_in: 3600 });
      }
      if (u.includes('/counters/')) {
        if (m === 'PATCH') { t.numeri++; contatore++; return J(200, {}); }
        return J(200, { fields: { value: { integerValue: String(contatore) } }, updateTime: `t${contatore}` });
      }
      if (u.includes('/documents/feedback') && m === 'POST') {
        const auth = !!(init.headers && init.headers.Authorization);
        t.create.push(auth ? 'admin' : 'anonimo');
        if (auth && t.rete === 'rifiuta') return J(403, { error: { message: 'PERMISSION_DENIED' } });
        return J(200, { name: 'projects/p/databases/(default)/documents/feedback/nuovo' });
      }
      return J(404, {});
    };
    // Solo i tempi, per non aspettare mezzo minuto fra un giro e l'altro.
    globalThis.SN_FEEDBACK_OUTBOX.init({ backoffMin: 50, backoffMax: 100 });
  }, { MAIN, rete });
}

async function mandaDalRiquadro(app, testo) {
  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill(testo);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 4_000 });
}

// Quello che fa l'accesso riuscito per la coda: l'owner è di nuovo dentro e il server accetta.
async function rientra(app) {
  await app.evaluate((_e, MAIN) => {
    const req = process.getBuiltinModule('module').createRequire(MAIN);
    const cfg = req('./auth/config');
    req('./auth/token-store').save({ refreshToken: 'rt-nuovo', email: cfg.adminEmails[0], name: 'Owner' });
    req('./auth/google-auth').restore();
    globalThis.__fo.rete = 'ok';
    globalThis.SN_FEEDBACK_OUTBOX.accessoCambiato();
  }, MAIN);
}

test('token admin rifiutato: il feedback dell\'owner consuma un numero solo, aspetta, e parte firmato quando rientra', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaOwner(app, 'rifiuta');
  await mandaDalRiquadro(app, 'Feedback dell\'owner col token rifiutato');

  await expect.poll(() => app.evaluate(() => globalThis.__fo.create.length), { timeout: 10_000 }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 3_000));
  const t = await app.evaluate(() => globalThis.__fo);
  expect(t.create, 'nessun invio anonimo').not.toContain('anonimo');
  expect(t.numeri, `numeri consumati da un feedback in attesa (giri: ${t.create.length})`).toBeLessThanOrEqual(1);
  await expect(shell.locator('body')).toContainText('il server non accetta il tuo accesso');

  await rientra(app);
  await expect.poll(() => app.evaluate(() => globalThis.__fo.create.slice(-1)[0]), { timeout: 10_000 }).toBe('admin');
  await expect.poll(() => app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.size()), { timeout: 10_000 }).toBe(0);
});

test('senza rete: l\'owner non viene mandato a rifare l\'accesso, e il feedback parte firmato quando la rete torna', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaOwner(app, 'spenta');
  await mandaDalRiquadro(app, 'Feedback dell\'owner senza rete');

  await new Promise((r) => setTimeout(r, 2_000));
  await expect(shell.locator('body'), 'la sessione c\'è: manca solo la rete').not.toContainText('aspetta il tuo accesso');

  await app.evaluate(() => { globalThis.__fo.rete = 'ok'; });
  await expect.poll(() => app.evaluate(() => globalThis.__fo.create), { timeout: 10_000 }).toEqual(['admin']);
});

test('accesso revocato e scoperto altrove: il feedback dell\'owner aspetta che rientri, non parte da anonimo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaOwner(app, 'revocato');
  // Un'altra parte di Filo chiede il token per prima: il rinnovo fallisce e la sessione si chiude.
  const dentro = await app.evaluate(async (_e, MAIN) => {
    const ga = process.getBuiltinModule('module').createRequire(MAIN)('./auth/google-auth');
    await ga.getIdToken().catch(() => {});
    return ga.isAdmin();
  }, MAIN);
  expect(dentro).toBe(false);

  await mandaDalRiquadro(app, 'Feedback dell\'owner dopo che il suo accesso è caduto');
  await expect(shell.locator('body')).toContainText('aspetta il tuo accesso');
  await new Promise((r) => setTimeout(r, 2_000));
  expect(await app.evaluate(() => globalThis.__fo.create), 'niente invio prima che rientri').toEqual([]);

  await rientra(app);
  await expect.poll(() => app.evaluate(() => globalThis.__fo.create), { timeout: 10_000 }).toEqual(['admin']);
});
