// Ricontrollo mirato della verifica avversariale — file temporaneo, si cancella.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ORA = Date.now();

const ROUTINE = {
  id: 'a'.repeat(24),
  branch: 'claude/qualcosa',
  sha: 'abcdef1234567890abcdef1234567890abcdef12',
  who: 'new-work · chiave-1',
  origin: 'routine',
  num: '512',
  blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
  createdAtMs: ORA - 5 * 60 * 1000,
  expiresAtMs: ORA + 20 * 60 * 60 * 1000,
  used: false,
  discarded: false,
};

const LOCALE = {
  id: 'b'.repeat(24),
  branch: 'claude/lavoro-locale',
  sha: '1234567890abcdef1234567890abcdef12345678',
  who: 'sathyarampontillo@gmail.com',
  origin: 'locale',
  num: '',
  blocks: [{ gate: 'dependency_change', label: 'Cambia le dipendenze del progetto', items: ['package.json'], more: 0 }],
  createdAtMs: ORA - 60 * 1000,
  expiresAtMs: ORA + 23 * 60 * 60 * 1000,
  used: false,
  discarded: false,
};

async function apri(openTab, opts = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.loadMergeApprovals);
  await page.evaluate(({ pending, approveReply }) => {
    window.__calls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      window.__calls.push(msg);
      const t = msg && msg.type;
      if (t === 'merge_approvals_get') return Promise.resolve({ ok: true, pending, recent: [], ttlMs: 86400000 });
      if (t === 'merge_approval_approve') return Promise.resolve(approveReply || { ok: true, result: 'merged', sha: 'd'.repeat(40) });
      if (t === 'merge_approval_discard') return Promise.resolve({ ok: true, result: 'discarded' });
      return orig(msg);
    };
  }, { pending: opts.pending || [], approveReply: opts.approveReply || null });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

test('nessun suggerimento manda a rilanciare la pubblicazione locale per un automazione', async ({ openTab }) => {
  const page = await apri(openTab, { pending: [ROUTINE, LOCALE] });
  const cards = page.locator('#mgMergeApprovals .sn-mac-card');
  await expect(cards).toHaveCount(2);

  const titoliRoutine = await cards.nth(0).evaluate((c) =>
    [...c.querySelectorAll('[title]')].map((n) => n.getAttribute('title')));
  console.log('AUTOMAZIONE:\n' + titoliRoutine.map((t) => ' · ' + t).join('\n'));
  expect(titoliRoutine.filter((t) => /npm run finish/.test(t))).toEqual([]);
  // …e non deve essere sparito il senso: la scadenza e lo scarto continuano a
  // spiegare cosa succede dopo.
  expect(titoliRoutine.join(' ').length).toBeGreaterThan(80);

  const titoliLocale = await cards.nth(1).evaluate((c) =>
    [...c.querySelectorAll('[title]')].map((n) => n.getAttribute('title')));
  console.log('LAVORO LOCALE:\n' + titoliLocale.map((t) => ' · ' + t).join('\n'));
  // Il cammino locale NON deve aver perso il suo consiglio, che lì è giusto.
  expect(titoliLocale.some((t) => /npm run finish/.test(t))).toBe(true);
  await page.screenshot({ path: 'tests/agent/.out/ricontrollo-l5.png' });
});

test('l avviso sta ancora in cima, sopra le schede, con le due provenienze', async ({ openTab }) => {
  const page = await apri(openTab, { pending: [ROUTINE, LOCALE] });
  const host = page.locator('#mgMergeApprovals');
  await expect(host).toBeVisible();
  const box = await host.boundingBox();
  const tabs = await page.locator('#mgTabs').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(tabs.y + 1);
  const cards = page.locator('#mgMergeApprovals .sn-mac-card');
  await expect(cards.nth(0).locator('.sn-mac-origin')).toHaveText('automazione · feedback #512');
  await expect(cards.nth(1).locator('.sn-mac-origin')).toHaveText('lavoro tuo, da questo computer');
});

test('approvare e scartare mandano ancora la richiesta giusta', async ({ openTab }) => {
  let page = await apri(openTab, { pending: [ROUTINE] });
  let card = page.locator('#mgMergeApprovals .sn-mac-card').nth(0);
  await card.locator('.sn-mac-btn-go').click();
  await expect(card.locator('.sn-mac-btn-go')).toHaveText('Confermi?');
  expect(await page.evaluate(() => window.__calls.filter((c) => c.type === 'merge_approval_approve').length)).toBe(0);
  await card.locator('.sn-mac-btn-go').click();
  await expect(card.locator('.sn-mac-status')).toContainText('Fatto: il lavoro è su main');
  const ap = await page.evaluate(() => window.__calls.filter((c) => c.type === 'merge_approval_approve'));
  expect(ap.length).toBe(1);
  expect(ap[0].id).toBe('a'.repeat(24));

  page = await apri(openTab, { pending: [ROUTINE] });
  card = page.locator('#mgMergeApprovals .sn-mac-card').nth(0);
  await card.locator('.sn-mac-btn-quiet').click();
  const di = await page.evaluate(() => window.__calls.filter((c) => c.type === 'merge_approval_discard'));
  expect(di.length).toBe(1);
  expect(di[0].id).toBe('a'.repeat(24));
});

test('la richiesta scaduta di un automazione dice ancora cosa succede dopo', async ({ openTab }) => {
  const page = await apri(openTab, {
    pending: [ROUTINE],
    approveReply: { ok: false, error: 'questa richiesta è scaduta: rilancia i controlli e rifalla' },
  });
  const card = page.locator('#mgMergeApprovals .sn-mac-card').nth(0);
  await card.locator('.sn-mac-btn-go').click();
  await card.locator('.sn-mac-btn-go').click();
  const testo = (await card.locator('.sn-mac-status').textContent()) || '';
  console.log('ESITO SCADUTA (automazione): ' + testo);
  expect(testo).toContain('scaduta');
  expect(testo).not.toContain('npm run finish');
});
