// Verifica locale, giro 1, rilievo 3: approvato come lavoro locale, rimesso alle routine con un clic, l'owner
// ci ripensa: da Gestione deve poterlo rifare lavoro locale.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SEGNO = { by: 'owner@esempio', at: 1790000000000 };

test('rimesso alle routine per sbaglio, torna lavoro locale', async ({ openTab }) => {
  test.fail(true, 'rilievo 3 aperto: tolto il segno, il sì dell’owner sparisce e nessun tasto lo ridà fuori dai Ricevuti');
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') return msg.localOnly ? { ok: true, by: 'owner@esempio', at: 1790000000000 } : { ok: true };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  const pratica = {
    _id: 'u-1', name: 'Il terminale non parte', text: 'x', seq: 950, subSeq: 0, status: 'todo', statusPublic: 'open',
    clientId: 'utente-abc', createdAt: '2026-10-01T07:00:00Z', images: [], localOnly: SEGNO, localApproval: SEGNO,
  };
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [pratica]);
  await page.evaluate(() => window.__mgTest.setTab('local'));
  const tab = (t) => page.locator(`.mg-tab[data-tab="${t}"]`);
  await expect(tab('local')).toHaveText('Lavori locali (1)');
  await page.locator('.mg-item').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Rimetti anche alle routine' }).click();
  await expect(tab('queue')).toHaveText('In coda (1)');

  await tab('queue').click();
  await page.locator('.mg-item').click();
  const tasto = page.locator('#mgLocalBtn');
  const azione = page.locator('#mgActionsRow button', { hasText: 'Lavoro locale' });
  await page.locator('.mg-item').click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu .sn-select-option', { hasText: /lavoro locale/i });
  expect((await tasto.isVisible()) || (await azione.count()) > 0 || (await voce.count()) > 0).toBe(true);
});
