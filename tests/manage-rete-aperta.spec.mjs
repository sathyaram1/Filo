// Gestione → Automazioni, la routine a rete aperta (#2013): la sua voce del pacemaker si vede (stato e pausa) e si
// spegne, e il suo tetto si salva. Il server è finto (risposte del main), come nelle altre prove delle automazioni.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';
import path from 'node:path';

const URL = 'filo://manage/manage.html';
const H = 60 * 60 * 1000;
const DOC = { ok: true, letto: true, maxSessions: 4, priorityAccount: '', accountAOff: false, accountBOff: false, reteApertaOff: false, reteApertaTetto: 2 };

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

test('si vede: accesa, il suo tetto, cosa ha deciso il pacemaker e la sua pausa col motivo', async ({ openTab }) => {
  const ora = Date.now();
  const page = await apri(openTab, {
    pause: {
      ok: true,
      oraMs: ora,
      pause: { reteAperta: { finoMs: ora + 3 * H, perche: 'http_402', dettaglio: 'Credit balance is too low', strikes: 2, oggi: 3 } },
      voci: { reteAperta: { perche: 'rete_paused', percheMs: ora - 60000, oggi: 3 } },
    },
  });
  await expect(page.locator('#mgReteAperta')).toBeChecked();
  await expect(page.locator('#mgReteApertaTetto')).toHaveValue('2');
  await expect(page.locator('#mgReteApertaStato')).toHaveText('In pausa; accesa 3 volte oggi.');
  const riga = page.locator('#mgReteApertaPausa .mg-auto-warn');
  await expect(riga).toHaveCount(1);
  await expect(riga).toHaveText(/^La routine a rete aperta in pausa fino (alle|a domani alle) \d{2}:\d{2}: crediti finiti \(HTTP 402\)\. «Credit balance is too low»$/);
  await expect(riga).toHaveAttribute('title', /2 rifiuti di fila.*Accensioni di oggi di questa routine: 3\./);
  // Le pause degli account non la prendono per una di loro.
  await expect(page.locator('#mgAccountsPausa')).toBeHidden();
  await expect(page.locator('#mgServerPausa')).toBeHidden();

  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.locator('#mgReteApertaBlock').scrollIntoViewIfNeeded();
    await page.locator('#mgReteApertaBlock').screenshot({ path: path.join('tests', '.shots', `rete-aperta-${tema}.png`) });
  }
});

test('si spegne e si riaccende dall’interruttore, e il tetto si salva da Salva e da Invio', async ({ openTab }) => {
  const page = await apri(openTab, {
    pause: { ok: true, oraMs: Date.now(), pause: {}, voci: { reteAperta: { perche: 'rete_work', oggi: 1 } } },
  });
  await expect(page.locator('#mgReteApertaStato')).toHaveText('Accesa una volta oggi.');
  await page.locator('#mgReteApertaSwitch').click();
  await expect(page.locator('#mgReteAperta')).not.toBeChecked();
  await expect(page.locator('#mgReteApertaMsg')).toHaveText('Salvato.');
  await page.locator('#mgReteApertaSwitch').click();
  await expect(page.locator('#mgReteAperta')).toBeChecked();
  expect(await page.evaluate(() => window.__scritti)).toEqual([{ reteApertaOff: true }, { reteApertaOff: false }]);

  const tetto = page.locator('#mgReteApertaTetto');
  await tetto.fill('3');
  await page.locator('#mgReteApertaTettoSave').click();
  await expect(page.locator('#mgReteApertaTettoMsg')).toHaveText('Salvato.');
  await tetto.fill('5');
  await tetto.press('Enter');
  await expect(page.locator('#mgReteApertaTettoMsg')).toHaveText('Salvato.');
  await expect(tetto).toHaveValue('5');
  expect((await page.evaluate(() => window.__scritti)).slice(2)).toEqual([{ reteApertaTetto: 3 }, { reteApertaTetto: 5 }]);
});

test('un tetto storto si rifiuta col suo intervallo e non parte; il resto della pagina non cambia', async ({ openTab }) => {
  const page = await apri(openTab);
  const tetto = page.locator('#mgReteApertaTetto');
  for (const storto of ['0', '21', '']) {
    await tetto.fill(storto);
    await page.locator('#mgReteApertaTettoSave').click();
    await expect(page.locator('#mgReteApertaTettoMsg')).toHaveText('Sessioni della routine a rete aperta: ci vuole un numero intero da 1 a 20. Non salvato.');
  }
  expect(await page.evaluate(() => window.__scritti)).toEqual([]);
  await expect(page.locator('#mgMaxSessions')).toHaveValue('4');
});

test('senza niente scritto dal pacemaker la riga di stato non c’è; chi non è owner non tocca niente', async ({ openTab }) => {
  const page = await apri(openTab, { admin: false });
  await expect(page.locator('#mgReteApertaStato')).toBeHidden();
  await expect(page.locator('#mgReteApertaPausa')).toBeHidden();
  for (const id of ['#mgReteAperta', '#mgReteApertaTetto', '#mgReteApertaTettoSave']) await expect(page.locator(id)).toBeDisabled();
});
