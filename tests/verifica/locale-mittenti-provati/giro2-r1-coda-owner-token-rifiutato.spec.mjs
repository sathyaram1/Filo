// Verifica locale «mittenti provati», giro 2, rilievo 1: il feedback dell'owner che aspetta la sua firma non brucia
// numeri a ogni ritentativo quando il token è rifiutato, e senza rete non gli dice che deve rientrare.
// Rete finta nel main: niente Firestore vero; l'owner è una sessione finta nella cartella dati isolata.
import { test, expect } from '../../fixtures/electron.mjs';
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

// L'owner entra (sessione finta), la rete risponde come dice `rete`: 'rifiuta' = Firestore rifiuta il token admin,
// 'spenta' = nessuna connessione.
async function preparaOwner(app, rete) {
  await app.evaluate((_e, { MAIN, rete }) => {
    const req = process.getBuiltinModule('module').createRequire(MAIN);
    const cfg = req('./auth/config');
    req('./auth/token-store').save({ refreshToken: 'rt-finto', email: cfg.adminEmails[0], name: 'Owner' });
    req('./auth/google-auth').restore();
    const t = { rete, numeri: 0, create: [], caricamenti: 0 };
    globalThis.__g2 = t;
    const J = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    let contatore = 500;
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      const m = (init.method || 'GET').toUpperCase();
      if (t.rete === 'spenta') throw new TypeError('fetch failed');
      if (u.includes('securetoken')) return J(200, { id_token: 'h.eyJ1c2VyX2lkIjoib3duZXIifQ.s', refresh_token: 'rt-finto', expires_in: 3600 });
      if (u.includes('/counters/')) {
        if (m === 'PATCH') { t.numeri++; contatore++; return J(200, {}); }
        return J(200, { fields: { value: { integerValue: String(contatore) } }, updateTime: `t${contatore}` });
      }
      if (u.includes('firebasestorage')) { t.caricamenti++; return J(200, { downloadTokens: 'x' }); }
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

test('token admin rifiutato: un feedback dell\'owner consuma un numero solo, non uno a ogni ritentativo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaOwner(app, 'rifiuta');
  await mandaDalRiquadro(app, 'Feedback dell\'owner col token rifiutato');

  // Lascia girare la coda: con i tempi accorciati sono decine di giri, come in mezz'ora di Filo aperto.
  await expect.poll(() => app.evaluate(() => globalThis.__g2.create.length), { timeout: 10_000 }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 3_000));
  const t = await app.evaluate(() => globalThis.__g2);
  expect(t.create, 'nessun invio anonimo').not.toContain('anonimo');
  expect(t.numeri, `numeri di feedback consumati per UN feedback rimasto in attesa (giri: ${t.create.length})`).toBeLessThanOrEqual(1);
});

test('senza rete: l\'owner non viene mandato a rifare l\'accesso, e il feedback parte firmato quando la rete torna', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaOwner(app, 'spenta');
  await mandaDalRiquadro(app, 'Feedback dell\'owner senza rete');

  await new Promise((r) => setTimeout(r, 2_000));
  await expect(shell.locator('body'), 'la sessione c\'è: manca solo la rete').not.toContainText('aspetta il tuo accesso');

  await app.evaluate(() => { globalThis.__g2.rete = 'ok'; });
  await expect.poll(() => app.evaluate(() => globalThis.__g2.create), { timeout: 10_000 }).toEqual(['admin']);
});
