// Gestione → Automazioni, le pause in corso (#996): senza tetto giornaliero è la pausa dopo un'accensione rifiutata
// a fermare un account o una routine server (una per account, #1426), e qui se ne legge il motivo. Il server è finto (risposte del main).

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';
import path from 'node:path';

const URL = 'filo://manage/manage.html';
const H = 60 * 60 * 1000;

async function apri(openTab, risposta) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.evaluate((r) => {
    window.__pause = r;
    window.__chiestePause = 0;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_pause_get') {
        window.__chiestePause += 1;
        return typeof window.__pause === 'function' ? window.__pause() : window.__pause;
      }
      if (msg && msg.type === 'automation_sessions_get') return { ok: true, letto: true, maxSessions: 2, priorityAccount: '', accountAOff: false, accountBOff: false };
      return orig(msg);
    };
  }, risposta);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await apriScheda(page, 'automation');
  await page.evaluate(() => Promise.all([window.__mgTest.loadSessions(), window.__mgTest.loadPause()]));
  return page;
}

test('un account e le due routine server in pausa dopo un rifiuto: la riga dice fino a quando e perché, l’hover il resto', async ({ openTab }) => {
  const ora = Date.now();
  const page = await apri(openTab, {
    ok: true,
    oraMs: ora,
    pause: {
      B: { finoMs: ora + 3 * H, perche: 'http_429', dettaglio: 'Daily routine run limit reached', strikes: 2, oggi: 17 },
      serverA: { finoMs: ora + 6 * H, perche: 'dead_round', dettaglio: '', strikes: 1, account: 'A', oggi: 4 },
      serverB: { finoMs: ora + 3 * H, perche: 'http_402', dettaglio: 'Credit balance is too low', strikes: 1, account: 'B', oggi: 17 },
    },
  });
  const righe = page.locator('#mgAccountsPausa .mg-auto-warn');
  await expect(righe).toHaveCount(1);
  await expect(righe.first()).toHaveText(/^Account B in pausa fino (alle|a domani alle) \d{2}:\d{2}: troppe accensioni per claude\.ai \(HTTP 429\)\. «Daily routine run limit reached»$/);
  await expect(righe.first()).toHaveAttribute('title', /2 rifiuti di fila.*Accensioni di oggi su quell'account: 17\./);
  const server = page.locator('#mgServerPausa .mg-auto-warn');
  await expect(server).toHaveCount(2);
  await expect(server.nth(0)).toHaveText(/^La routine server dell'account A in pausa fino (alle|a domani alle) \d{2}:\d{2}: accesa, ma la sessione non è partita\.$/);
  await expect(server.nth(0)).toHaveAttribute('title', /oggi su quell'account: 4/);
  await expect(server.nth(1)).toHaveText(/^La routine server dell'account B in pausa fino (alle|a domani alle) \d{2}:\d{2}: .*\(HTTP 402\)\. «Credit balance is too low»$/);

  // L'aspetto, nei due temi: le righe stanno sotto gli interruttori a cui si riferiscono.
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.locator('#mgAccountsBlock').scrollIntoViewIfNeeded();
    await page.locator('#mgLavoriServerBlock').screenshot({ path: path.join('tests', '.shots', `pause-routine-server-${tema}.png`) });
    await page.locator('#mgAccountsBlock').screenshot({ path: path.join('tests', '.shots', `pause-routine-account-${tema}.png`) });
  }
});

test('nessuna pausa: nessuna riga; una pausa che scade sparisce da sola', async ({ openTab }) => {
  const page = await apri(openTab, { ok: true, oraMs: Date.now(), pause: {} });
  await expect(page.locator('#mgAccountsPausa')).toBeHidden();
  await expect(page.locator('#mgServerPausa')).toBeHidden();
  await page.evaluate(() => {
    const ora = Date.now();
    window.__pause = { ok: true, oraMs: ora, pause: { A: { finoMs: ora + 1500, perche: 'network', strikes: 1, oggi: 1 } } };
  });
  await page.evaluate(() => window.__mgTest.loadPause());
  await expect(page.locator('#mgAccountsPausa .mg-auto-warn')).toHaveText(/^Account A in pausa fino alle \d{2}:\d{2}: claude\.ai non raggiungibile\.$/);
  await expect(page.locator('#mgAccountsPausa')).toBeHidden({ timeout: 10000 });
});

test('le pause si rileggono a ogni apertura di Automazioni', async ({ openTab }) => {
  const page = await apri(openTab, { ok: true, oraMs: Date.now(), pause: {} });
  const prima = await page.evaluate(() => window.__chiestePause);
  await page.evaluate(() => {
    const ora = Date.now();
    window.__pause = { ok: true, oraMs: ora, pause: { B: { finoMs: ora + 3600000, perche: 'http_402', dettaglio: 'Credit balance is too low', strikes: 1, oggi: 9 } } };
  });
  await apriScheda(page, 'inbox');
  await apriScheda(page, 'automation');
  await expect.poll(() => page.evaluate(() => window.__chiestePause)).toBeGreaterThan(prima);
  await expect(page.locator('#mgAccountsPausa .mg-auto-warn')).toContainText('crediti finiti (HTTP 402)');
});

test('stato non letto: lo dice invece di tacere; il messaggio del server resta testo', async ({ openTab }) => {
  const page = await apri(openTab, { ok: false, error: 'callable routineLog 400: Operazione sconosciuta.' });
  await expect(page.locator('#mgAccountsPausa')).toHaveText('Non ho potuto leggere dal server se un account è in pausa.');
  await expect(page.locator('#mgAccountsPausa .mg-auto-warn')).toHaveCount(0);
  await expect(page.locator('#mgServerPausa')).toBeHidden();

  await page.evaluate(() => {
    const ora = Date.now();
    window.__pause = { ok: true, oraMs: ora, pause: { A: { finoMs: ora + 3600000, perche: 'http_400', dettaglio: '<img src=x onerror="window.__xss=1">', strikes: 1, oggi: 2 } } };
  });
  await page.evaluate(() => window.__mgTest.loadPause());
  const riga = page.locator('#mgAccountsPausa .mg-auto-warn');
  await expect(riga).toContainText('«<img src=x onerror="window.__xss=1">»');
  expect(await page.locator('#mgAccountsPausa img').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('chi non è owner non vede righe di pausa', async ({ openTab }) => {
  const page = await apri(openTab, { ok: false, code: 'not_admin', error: 'Operazione riservata agli amministratori' });
  await expect(page.locator('#mgAccountsPausa')).toBeHidden();
  await expect(page.locator('#mgServerPausa')).toBeHidden();
});
