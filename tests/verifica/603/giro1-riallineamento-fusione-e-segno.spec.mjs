// #603 dopo il riallineamento: dove main ha portato l'etichetta «fusione ferma» e l'ordinamento in cima, il segno
// del lavoro convive. Una pratica ferma al cancello mostra etichetta e quadrato, in Ricevuti come in Gestione;
// accanto, «bloccato dalla sicurezza» (pentagono) e «attacco» dei giudici (cerchio) restano distinti.
import { test, expect } from '../../fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const RICHIESTA = 'abcdefabcdefabcdefabcdef';

const giudici = (cls) => ({
  action: 'human_review', l1Category: 'clean',
  expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
  verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: cls, reasoning: 'x' })),
});
const fb = (id, seq, status, extra = {}) => ({
  _id: id, _updateTime: 'v1', seq, subSeq: 0, name: `Segnalazione ${seq}`, text: `Testo ${seq}`, notes: '',
  status, statusReason: null, clientId: 'tester@example.com',
  createdAt: new Date(Date.UTC(2026, 7, 1) + seq * 3600e3).toISOString(), images: [], ...extra,
});
const DOCS = [
  fb('f515', 515, 'revision_security', { pipeline: giudici('aligned') }),
  fb('f700', 700, 'design', { statusReason: 'secaudit', pipeline: giudici('aligned') }),
  fb('f716', 716, 'attack', { pipeline: giudici('attack') }),
];
const richiesta = {
  id: RICHIESTA, branch: 'claude/f515', sha: 'a'.repeat(40), feedbackId: 'f515', num: '515',
  who: 'secaudit · x', origin: 'routine', trips: [{ gate: 'rules', label: 'Regole', items: ['firestore.rules'] }],
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
};

test('pagina dei feedback: la fusione ferma sta in cima con etichetta e quadrato, gli altri segni restano', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForFunction(() => window.__fbTest && window.__fbTest.whenReady && window.filo);
  await page.evaluate(() => window.__fbTest.whenReady());
  await page.evaluate(({ docs, r }) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'merge_approvals_get') return { ok: true, pending: [r], failed: [], recent: [], preapproved: [] };
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setData(docs.map((d) => ({ ...d })));
  }, { docs: DOCS, r: richiesta });
  await page.evaluate(() => window.__fbTest.caricaFusioni());
  await page.evaluate(() => window.__fbTest.setTab('inbox'));

  const scheda = (id) => page.locator(`#list .fb-card[data-id="${id}"]`);
  await expect.poll(() => page.locator('#list .fb-card').evaluateAll((els) => els.map((e) => e.dataset.id)))
    .toEqual(['f515', 'f716', 'f700']);
  await expect(scheda('f515').locator('.fb-fusione')).toHaveText('fusione ferma');
  await expect(scheda('f515').locator('.fb-title .fb-segno')).toHaveAttribute('data-forma', 'quadrato');
  expect(await scheda('f515').locator('.fb-title .fb-segno').getAttribute('title')).toMatch(/cancello di fusione/i);
  await expect(scheda('f700').locator('.fb-title .fb-segno')).toHaveAttribute('data-forma', 'pentagono');
  await expect(scheda('f716').locator('.fb-title .fb-segno')).toHaveAttribute('data-forma', 'cerchio');
  await expect(scheda('f716').locator('.fb-fusione')).toHaveCount(0);
});

test('Gestione: la fusione ferma in cima con etichetta e quadrato, gli altri segni restano', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, r }) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [r], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs.map((d) => ({ ...d })));
  }, { docs: DOCS, r: richiesta });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());

  const riga = (n) => page.locator('.mg-item', { hasText: `Segnalazione ${n}` });
  await expect(riga(515).locator('.mg-fusione-badge')).toBeVisible();
  await expect(riga(515).locator('.mg-segno-fermata')).toHaveAttribute('data-forma', 'quadrato');
  await expect(riga(700).locator('.mg-segno-fermata')).toHaveAttribute('data-forma', 'pentagono');
  await expect(riga(716).locator('.mg-segno-fermata')).toHaveAttribute('data-forma', 'cerchio');
  const primo = await page.locator('.mg-list .mg-item').first().textContent();
  expect(primo).toContain('Segnalazione 515');
});
