// SPEC DELLA VERIFICA AVVERSARIALE — file temporaneo, va cancellato a fine giro.
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
  blocks: [
    { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['src/main/guard.js', 'firestore.rules'], more: 0 },
  ],
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

/** Sostituisce il canale verso il main: le richieste tornano da qui. */
async function stub(page, { pending = [], recent = [], approveReply = null, discardReply = null } = {}) {
  await page.evaluate(({ pending, recent, approveReply, discardReply }) => {
    window.__calls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      window.__calls.push(msg);
      const t = msg && msg.type;
      if (t === 'merge_approvals_get') return Promise.resolve({ ok: true, pending, recent, ttlMs: 86400000 });
      if (t === 'merge_approval_approve') return Promise.resolve(approveReply || { ok: true, result: 'merged', sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
      if (t === 'merge_approval_discard') return Promise.resolve(discardReply || { ok: true, result: 'discarded' });
      return orig(msg);
    };
  }, { pending, recent, approveReply, discardReply });
}

async function apri(openTab, opts) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.loadMergeApprovals);
  await stub(page, opts);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

test('le due provenienze compaiono in cima a Gestione, sopra le schede', async ({ openTab }) => {
  const page = await apri(openTab, { pending: [ROUTINE, LOCALE] });

  const host = page.locator('#mgMergeApprovals');
  await expect(host).toBeVisible();
  const cards = page.locator('#mgMergeApprovals .sn-mac-card');
  await expect(cards).toHaveCount(2);

  // Sopra le schede, davvero: geometria, non solo ordine nel documento.
  const box = await host.boundingBox();
  const tabs = await page.locator('#mgTabs').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(tabs.y + 1);

  // La provenienza si legge, e il feedback dell'automazione pure.
  await expect(cards.nth(0).locator('.sn-mac-origin')).toHaveText('automazione · feedback #512');
  await expect(cards.nth(1).locator('.sn-mac-origin')).toHaveText('lavoro tuo, da questo computer');
  await expect(cards.nth(0).locator('.sn-mac-who')).toContainText('new-work');
  await expect(cards.nth(0).locator('.sn-mac-block-label')).toContainText('aree protette');
  await expect(cards.nth(0).locator('.sn-mac-branch')).toHaveText('claude/qualcosa');
  await page.screenshot({ path: 'tests/agent/.out/verifica-l5-lista.png' });
});

test('approvare il lavoro di un automazione manda la richiesta giusta', async ({ openTab }) => {
  const page = await apri(openTab, { pending: [ROUTINE, LOCALE] });
  const card = page.locator('#mgMergeApprovals .sn-mac-card').nth(0);
  const btn = card.locator('.sn-mac-btn-go');

  await btn.click();
  await expect(btn).toHaveText('Confermi?');
  // Un click solo NON deve mandare niente.
  let calls = await page.evaluate(() => window.__calls.filter((c) => c.type === 'merge_approval_approve'));
  expect(calls.length).toBe(0);

  await btn.click();
  await expect(card.locator('.sn-mac-status')).toContainText('Fatto: il lavoro è su main');
  calls = await page.evaluate(() => window.__calls.filter((c) => c.type === 'merge_approval_approve'));
  expect(calls.length).toBe(1);
  expect(calls[0].id).toBe('a'.repeat(24));
});

test('scartare il lavoro di un automazione manda la richiesta giusta', async ({ openTab }) => {
  const page = await apri(openTab, { pending: [ROUTINE] });
  const card = page.locator('#mgMergeApprovals .sn-mac-card').nth(0);
  await card.locator('.sn-mac-btn-quiet').click();
  const calls = await page.evaluate(() => window.__calls.filter((c) => c.type === 'merge_approval_discard'));
  expect(calls.length).toBe(1);
  expect(calls[0].id).toBe('a'.repeat(24));
});

test('campi mancanti o inventati non rompono la scheda', async ({ openTab }) => {
  const senzaNum = { ...ROUTINE, id: 'c'.repeat(24), num: '' };
  const senzaChi = { ...ROUTINE, id: 'd'.repeat(24), who: '' };
  const originStrano = { ...ROUTINE, id: 'e'.repeat(24), origin: '<script>alert(1)</script>' };
  const scaduta = { ...ROUTINE, id: 'f'.repeat(24), expiresAtMs: ORA - 1000 };
  const vuota = { id: '0'.repeat(24) };
  const page = await apri(openTab, { pending: [senzaNum, senzaChi, originStrano, scaduta, vuota] });

  const cards = page.locator('#mgMergeApprovals .sn-mac-card');
  await expect(cards).toHaveCount(5);
  await expect(cards.nth(0).locator('.sn-mac-origin')).toHaveText('automazione');
  await expect(cards.nth(1).locator('.sn-mac-who')).toHaveText('chi l’ha chiesta non risulta');
  await expect(cards.nth(2).locator('.sn-mac-origin')).toHaveText('lavoro tuo, da questo computer');
  await expect(cards.nth(3).locator('.sn-mac-expiry')).toHaveText('scaduta');
  await expect(cards.nth(4).locator('.sn-mac-branch')).toHaveText('(ramo sconosciuto)');
  // Niente HTML iniettato dal campo origin.
  const script = await page.evaluate(() => document.querySelectorAll('#mgMergeApprovals script').length);
  expect(script).toBe(0);
  await page.screenshot({ path: 'tests/agent/.out/verifica-l5-limiti.png' });
});

test('gli esiti negativi non consigliano una strada sbagliata', async ({ openTab }) => {
  // Scaduta lato server, su lavoro di un'automazione.
  let page = await apri(openTab, { pending: [ROUTINE], approveReply: { ok: false, error: 'questa richiesta è scaduta: rilancia i controlli e rifalla' } });
  let card = page.locator('#mgMergeApprovals .sn-mac-card').nth(0);
  await card.locator('.sn-mac-btn-go').click();
  await card.locator('.sn-mac-btn-go').click();
  const testo = await card.locator('.sn-mac-status').textContent();
  expect(testo).toContain('scaduta');
  expect(testo).not.toContain('npm run finish');

  // Server irraggiungibile: deve dire che NON è stata fusa.
  page = await apri(openTab, { pending: [ROUTINE], approveReply: { ok: false, error: 'server unreachable' } });
  card = page.locator('#mgMergeApprovals .sn-mac-card').nth(0);
  await card.locator('.sn-mac-btn-go').click();
  await card.locator('.sn-mac-btn-go').click();
  await expect(card.locator('.sn-mac-status')).toContainText('nessuna fusione è avvenuta');

  // Già usata.
  page = await apri(openTab, { pending: [ROUTINE], approveReply: { ok: false, error: 'questa richiesta è già stata usata' } });
  card = page.locator('#mgMergeApprovals .sn-mac-card').nth(0);
  await card.locator('.sn-mac-btn-go').click();
  await card.locator('.sn-mac-btn-go').click();
  await expect(card.locator('.sn-mac-status')).toContainText('già stata usata');
});

test('chi non è owner non vede niente', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.loadMergeApprovals);
  await stub(page, { pending: [ROUTINE, LOCALE] });
  await page.evaluate(() => window.__mgTest.setAdmin(false));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
});

test('niente richieste = niente avviso', async ({ openTab }) => {
  const page = await apri(openTab, { pending: [] });
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
});

test('anche sul tema scuro si legge', async ({ openTab }) => {
  const page = await apri(openTab, { pending: [ROUTINE, LOCALE] });
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/agent/.out/verifica-l5-scuro.png' });
  await expect(page.locator('#mgMergeApprovals .sn-mac-origin').first()).toBeVisible();
});

test('la prima schermata mostra le stesse richieste', async ({ openTab }) => {
  const page = await openTab('filo://dashboard/dashboard.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__filoDashActions && window.__filoDashActions.refreshMergeApprovals);
  await page.evaluate(({ pending }) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return Promise.resolve({ ok: true, signedIn: true, isAdmin: true, email: 'o@x.it' });
      if (t === 'merge_approvals_get') return Promise.resolve({ ok: true, pending, recent: [], ttlMs: 86400000 });
      return orig(msg);
    };
  }, { pending: [ROUTINE, LOCALE] });
  await page.evaluate(() => window.__filoDashActions.refreshAccountControl());
  await page.evaluate(() => window.__filoDashActions.refreshMergeApprovals());
  const cards = page.locator('#mergeApprovals .sn-mac-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('.sn-mac-origin')).toHaveText('automazione · feedback #512');
  await page.screenshot({ path: 'tests/agent/.out/verifica-l5-home.png' });
});

test('le decisioni passate mostrano anche quelle delle automazioni', async ({ openTab }) => {
  const page = await apri(openTab, {
    pending: [],
    recent: [
      { ...ROUTINE, used: true, outcome: 'merged', decidedAtMs: ORA - 3600_000 },
      { ...LOCALE, discarded: true, decidedAtMs: ORA - 7200_000 },
    ],
  });
  const righe = page.locator('#mgMergeApprovalsRecent .sn-mac-recent-row');
  await expect(righe).toHaveCount(2);
  await expect(righe.nth(0).locator('.sn-mac-recent-origin')).toHaveText('automazione · feedback #512');
  await expect(righe.nth(0).locator('.sn-mac-recent-what')).toHaveText('approvata e fusa');
  await expect(righe.nth(1).locator('.sn-mac-recent-what')).toHaveText('scartata');
});
