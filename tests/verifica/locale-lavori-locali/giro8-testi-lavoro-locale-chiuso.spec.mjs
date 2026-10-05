// Verifica locale «lavori locali», giro 8: la porta del giro 7 (testi dei lavori locali dove non valgono) riprovata in
// Gestione. Su un lavoro locale chiuso il segno parla della bacheca, non delle routine; «Copia» su un feedback d'utente
// non lo lega alla chiusura. Dati finti; screenshot in chiaro e scuro in tests/.shots/.
import { test, expect } from './../../fixtures/electron.mjs';

test('lavoro locale chiuso: tasto, tasto destro e riga dicono la bacheca, non le routine; «Copia» d’utente senza finish', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
  const at = Date.parse('2026-09-30T10:00:00Z');
  const chiusa = {
    _id: 'loc-c', seq: 9801, subSeq: 0, name: 'Un lavoro locale già fuso', text: 'Lavoro locale.', status: 'done',
    statusPublic: 'closed', clientId: 'local:claude', senderProof: 'admin', localOnly: { by: 'local:claude', at },
    createdAt: '2026-09-29T08:00:00Z', images: [], notes: '',
  };
  const utente = {
    _id: 'ut-1', seq: 9802, subSeq: 0, name: 'Il tasto salva non salva', text: 'non va', status: 'todo',
    statusPublic: 'open', clientId: 'utente-abc', createdAt: '2026-09-30T08:00:00Z', images: [], notes: '',
  };
  const tab = await page.evaluate((fb) => window.SN_MANAGE_REVIEW.manageTabFor(fb), chiusa);
  await page.evaluate(([l, t]) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setTab(t); }, [[chiusa, utente], tab]);

  await page.locator('.mg-item[data-id="loc-c"]').click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'lavoro locale' });
  await expect(voce).toHaveCount(1);
  await expect(voce).toHaveAttribute('title', /bacheca/);
  await expect(voce).not.toHaveAttribute('title', /routine/);
  await page.keyboard.press('Escape');

  await page.evaluate((id) => window.__mgTest.openDetail(id), 'loc-c');
  const btn = page.locator('#mgLocalBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('title', /bacheca/);
  await expect(btn).not.toHaveAttribute('title', /routine/);
  await expect(page.locator('#mgDetail')).not.toContainText('si fonde senza chiedere');
  for (const tema of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } });
    }, tema);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/giro8-locale-chiuso-${tema}.png` });
  }

  const tabU = await page.evaluate((fb) => window.SN_MANAGE_REVIEW.manageTabFor(fb), utente);
  await page.evaluate((t) => window.__mgTest.setTab(t), tabU);
  await page.locator('.mg-item[data-id="ut-1"]').click({ button: 'right' });
  const copia = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Copia #9802' });
  await expect(copia).toHaveCount(1);
  await expect(copia).not.toHaveAttribute('title', /finish|chiusura/);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__updates)).toEqual([]);
});
