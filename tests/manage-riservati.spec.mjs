// Gestione → Automazioni, la routine riservati (#2069, al posto della rete aperta di #2013): la sua voce del pacemaker
// si vede (stato e pause di A e B) e si spegne, e il suo tetto si salva. Il server è finto (risposte del main), come nelle altre prove delle automazioni.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';
import path from 'node:path';

const URL = 'filo://manage/manage.html';
const H = 60 * 60 * 1000;
const DOC = { ok: true, letto: true, maxSessions: 4, priorityAccount: '', accountAOff: false, accountBOff: false, riservatiOff: false, riservatiTetto: 2 };

async function apri(openTab, { pause, sessioni = DOC, admin = true } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.evaluate(({ p, s }) => {
    window.__pause = p;
    window.__doc = s;
    window.__scritti = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_pause_get') return window.__pause;
      if (msg && msg.type === 'automation_sessions_get') return window.__doc;
      if (msg && msg.type === 'automation_sessions_set') {
        const campi = {};
        for (const k of window.SN_ROUTINE_SESSIONI.CHIAVI) if (msg[k] !== undefined) campi[k] = msg[k];
        window.__scritti.push(campi);
        window.__doc = Object.assign({}, window.__doc, campi);
        return window.__doc;
      }
      return orig(msg);
    };
  }, { p: pause || { ok: true, oraMs: Date.now(), pause: {}, voci: {} }, s: sessioni });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await apriScheda(page, 'automation');
  await page.evaluate(() => Promise.all([window.__mgTest.loadSessions(), window.__mgTest.loadPause()]));
  return page;
}

test('si vede: accesa, il suo tetto, cosa ha deciso il pacemaker e le pause di A e B col motivo', async ({ openTab }) => {
  const ora = Date.now();
  const page = await apri(openTab, {
    pause: {
      ok: true,
      oraMs: ora,
      pause: {
        riservatiA: { finoMs: ora + 3 * H, perche: 'http_402', dettaglio: 'Credit balance is too low', strikes: 2, account: 'A', oggi: 3 },
        riservatiB: { finoMs: ora + 2 * H, perche: 'dead_round', strikes: 1, account: 'B', oggi: 1 },
      },
      voci: { riservati: { perche: 'riservati_paused', percheMs: ora - 60000, oggi: 4, oggiPerAccount: { A: 3, B: 1 } } },
    },
  });
  await expect(page.locator('#mgRiservati')).toBeChecked();
  await expect(page.locator('#mgRiservatiTetto')).toHaveValue('2');
  await expect(page.locator('#mgRiservatiStato')).toHaveText('In pausa; accesa 4 volte oggi.');
  const righe = page.locator('#mgRiservatiPausa .mg-auto-warn');
  await expect(righe).toHaveCount(2);
  const riga = righe.nth(0);
  await expect(riga).toHaveText(/^La routine riservati dell'account A in pausa fino (alle|a domani alle) \d{2}:\d{2}: crediti finiti \(HTTP 402\)\. «Credit balance is too low»$/);
  await expect(riga).toHaveAttribute('title', /2 rifiuti di fila.*Accensioni di oggi di questa routine: 3\./);
  await expect(righe.nth(1)).toHaveText(/^La routine riservati dell'account B in pausa fino .*accesa, ma la sessione non è partita\.$/);
  // Le pause degli account non la prendono per una di loro.
  await expect(page.locator('#mgAccountsPausa')).toBeHidden();
  await expect(page.locator('#mgServerPausa')).toBeHidden();

  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.locator('#mgRiservatiBlock').scrollIntoViewIfNeeded();
    await page.locator('#mgRiservatiBlock').screenshot({ path: path.join('tests', '.shots', `riservati-${tema}.png`) });
  }
  // Il posto: dopo il manutentore e prima delle sessioni in parallelo, nella stessa colonna.
  await page.locator('#mgRiservatiBlock').locator('xpath=..').screenshot({ path: path.join('tests', '.shots', 'riservati-colonna.png') });
});

test('si spegne e si riaccende dall’interruttore, e il tetto si salva da Salva e da Invio', async ({ openTab }) => {
  const page = await apri(openTab, {
    pause: { ok: true, oraMs: Date.now(), pause: {}, voci: { riservati: { perche: 'riservati_work', oggi: 1 } } },
  });
  await expect(page.locator('#mgRiservatiStato')).toHaveText('Accesa una volta oggi.');
  await page.locator('#mgRiservatiSwitch').click();
  await expect(page.locator('#mgRiservati')).not.toBeChecked();
  await expect(page.locator('#mgRiservatiMsg')).toHaveText('Salvato.');
  await page.locator('#mgRiservatiSwitch').click();
  await expect(page.locator('#mgRiservati')).toBeChecked();
  expect(await page.evaluate(() => window.__scritti)).toEqual([{ riservatiOff: true }, { riservatiOff: false }]);

  const tetto = page.locator('#mgRiservatiTetto');
  await tetto.fill('3');
  await page.locator('#mgRiservatiTettoSave').click();
  await expect(page.locator('#mgRiservatiTettoMsg')).toHaveText('Salvato.');
  await tetto.fill('5');
  await tetto.press('Enter');
  await expect(page.locator('#mgRiservatiTettoMsg')).toHaveText('Salvato.');
  await expect(tetto).toHaveValue('5');
  expect((await page.evaluate(() => window.__scritti)).slice(2)).toEqual([{ riservatiTetto: 3 }, { riservatiTetto: 5 }]);
});

test('un tetto storto si rifiuta col suo intervallo e non parte; il resto della pagina non cambia', async ({ openTab }) => {
  const page = await apri(openTab);
  const tetto = page.locator('#mgRiservatiTetto');
  for (const storto of ['0', '21', '']) {
    await tetto.fill(storto);
    await page.locator('#mgRiservatiTettoSave').click();
    await expect(page.locator('#mgRiservatiTettoMsg')).toHaveText('Sessioni della routine riservati: ci vuole un numero intero da 1 a 20. Non salvato.');
  }
  expect(await page.evaluate(() => window.__scritti)).toEqual([]);
  await expect(page.locator('#mgMaxSessions')).toHaveValue('4');
});

test('senza niente scritto dal pacemaker la riga di stato non c’è; chi non è owner non tocca niente', async ({ openTab }) => {
  const page = await apri(openTab, { admin: false });
  await expect(page.locator('#mgRiservatiStato')).toBeHidden();
  await expect(page.locator('#mgRiservatiPausa')).toBeHidden();
  for (const id of ['#mgRiservati', '#mgRiservatiTetto', '#mgRiservatiTettoSave']) await expect(page.locator(id)).toBeDisabled();
});
