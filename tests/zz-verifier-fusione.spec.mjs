// Spec del VERIFICATORE (indipendente): la scheda delle fusioni in Gestione.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const SHOT = process.env.VERIFIER_SHOT_DIR || '';

const NOW = Date.now();
const pendingLocal = {
  id: 'req-local', branch: 'claude/lavoro-mio', sha: 'abcdef1234567890', who: 'owner@example.com',
  createdAtMs: NOW - 5 * 60000, expiresAtMs: NOW + 6 * 24 * 3600000,
  blocks: [{ gate: 'guard_files', label: 'Tocca le guardie', items: ['.claude/hooks/x.sh'] }],
};
const pendingRoutine = {
  id: 'req-routine', origin: 'routine', num: '#523', branch: 'claude/523-fix', sha: '1111222233334444',
  who: 'secaudit', createdAtMs: NOW - 3600000, expiresAtMs: NOW + 2 * 3600000,
  blocks: [{ gate: 'deps' }],
};
const failedRoutine = {
  id: 'req-failed-r', origin: 'routine', num: '523', branch: 'claude/523-fix-old', sha: 'ffff000011112222',
  who: 'secaudit', decidedAtMs: NOW - 2 * 3600000,
};
const failedLocal = {
  id: 'req-failed-l', branch: 'claude/mio-vecchio', sha: 'eeee000011112222',
  who: 'owner@example.com', usedAtMs: NOW - 26 * 3600000,
};

async function renderCards(page, data, replies) {
  return page.evaluate(({ data, replies }) => {
    const host = document.getElementById('mgMergeApprovals');
    window.__calls = [];
    const n = window.SN_MERGE_APPROVALS.render(host, {
      requests: data.requests || [],
      failed: data.failed || [],
      onApprove: (req) => { window.__calls.push(['approve', req.id]); return replies.approve?.[req.id] || { ok: false, error: 'nessuna risposta finta' }; },
      onDiscard: (req) => { window.__calls.push(['discard', req.id]); return replies.discard?.[req.id] || { ok: true, result: 'discarded' }; },
      onDone: () => { window.__calls.push(['done']); },
      onFeedback: (req) => { window.__calls.push(['feedback', req.num]); },
    });
    return n;
  }, { data, replies });
}

async function openManage(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.SN_MERGE_APPROVALS && window.__mgTest);
  return page;
}

test('non admin: nessuna scheda delle fusioni (blocco nascosto)', async ({ openTab }) => {
  const page = await openManage(openTab);
  await page.waitForTimeout(1500);
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
  await expect(page.locator('#mgMergeApprovalsRecent')).toBeHidden();
});

test('fusioni approvate non avvenute: PRIMA delle richieste, testo con cosa fare per provenienza', async ({ openTab }) => {
  const page = await openManage(openTab);
  const n = await renderCards(page, { requests: [pendingLocal, pendingRoutine], failed: [failedRoutine, failedLocal] }, {});
  expect(n).toBe(4);
  const host = page.locator('#mgMergeApprovals');
  await expect(host).toBeVisible();
  const sections = host.locator('section.sn-mac');
  await expect(sections).toHaveCount(2);
  await expect(sections.nth(0)).toHaveClass(/sn-mac-failed/);
  await expect(sections.nth(0).locator('.sn-mac-title-text')).toHaveText('2 fusioni approvate non sono avvenute');
  await expect(sections.nth(1).locator('.sn-mac-title-text')).toHaveText('2 fusioni aspettano il tuo via libera');

  const fr = host.locator('.sn-mac-card-failed').nth(0);
  await expect(fr.locator('.sn-mac-origin')).toHaveText('automazione · feedback #523');
  await expect(fr.locator('.sn-mac-why')).toContainText('NON è avvenuta');
  await expect(fr.locator('.sn-mac-why')).toContainText('torna alla routine');
  await expect(fr.locator('.sn-mac-why')).not.toContainText('npm run finish');
  const fl = host.locator('.sn-mac-card-failed').nth(1);
  await expect(fl.locator('.sn-mac-why')).toContainText('npm run finish');
  await expect(fl.locator('.sn-mac-when')).toContainText('approvata ieri');

  // il numero della segnalazione è un bottone che apre il feedback
  await fr.locator('button.sn-mac-origin-link').click();
  expect(await page.evaluate(() => window.__calls)).toEqual([['feedback', '523']]);

  if (SHOT) {
    await page.evaluate(() => window.__mgTest.setTab('inbox'));
    await renderCards(page, { requests: [pendingLocal, pendingRoutine], failed: [failedRoutine, failedLocal] }, {});
    await expect(page.locator('#mgMergeApprovals')).toBeVisible();
    await page.locator('#mgMergeApprovals').scrollIntoViewIfNeeded();
    await page.screenshot({ path: SHOT + '/manage-fusioni-light.png', fullPage: false });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOT + '/manage-fusioni-dark.png', fullPage: false });
    await page.emulateMedia({ colorScheme: 'light' });
  }
});

test('approva → conflitto: messaggio giusto per provenienza, bottoni riabilitati, nessun onDone', async ({ openTab }) => {
  const page = await openManage(openTab);
  await renderCards(page, { requests: [pendingLocal, pendingRoutine] }, {
    approve: { 'req-local': { ok: true, result: 'conflict' }, 'req-routine': { ok: true, result: 'conflict' } },
  });
  const cards = page.locator('#mgMergeApprovals .sn-mac-card:not(.sn-mac-card-failed)');
  await expect(cards).toHaveCount(2);

  // un click solo NON approva
  const go0 = cards.nth(0).locator('.sn-mac-btn-go');
  await go0.click();
  await expect(go0).toHaveText('Confermi?');
  expect(await page.evaluate(() => window.__calls)).toEqual([]);
  await go0.click();
  await expect(cards.nth(0).locator('.sn-mac-status')).toContainText('rifai la base del ramo e rilancia npm run finish');
  await expect(go0).toBeEnabled();
  await expect(go0).toHaveText('Approva e fondi');

  const go1 = cards.nth(1).locator('.sn-mac-btn-go');
  await go1.dblclick();
  await expect(cards.nth(1).locator('.sn-mac-status')).toContainText('giro nuovo dell’automazione');
  await expect(cards.nth(1).locator('.sn-mac-status')).not.toContainText('npm run finish');
  const calls = await page.evaluate(() => window.__calls);
  expect(calls.filter((c) => c[0] === 'approve').length).toBe(2);
  expect(calls.some((c) => c[0] === 'done')).toBe(false);
});

test('armato e non confermato entro 5 s: torna com’era', async ({ openTab }) => {
  const page = await openManage(openTab);
  await renderCards(page, { requests: [pendingLocal] }, {});
  const go = page.locator('#mgMergeApprovals .sn-mac-btn-go');
  await go.click();
  await expect(go).toHaveText('Confermi?');
  await page.waitForTimeout(5300);
  await expect(go).toHaveText('Approva e fondi');
  expect(await page.evaluate(() => window.__calls)).toEqual([]);
});

test('scarta la richiesta e "segna come sistemata": una chiamata sola anche con doppio click', async ({ openTab }) => {
  const page = await openManage(openTab);
  await renderCards(page, { requests: [pendingLocal], failed: [failedRoutine] }, {
    discard: { 'req-local': new Promise(() => {}), 'req-failed-r': new Promise(() => {}) },
  });
  await page.locator('#mgMergeApprovals .sn-mac-card:not(.sn-mac-card-failed) .sn-mac-btn-quiet').dblclick();
  await page.locator('#mgMergeApprovals .sn-mac-card-failed .sn-mac-btn').dblclick();
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__calls);
  expect(calls).toEqual([['discard', 'req-local'], ['discard', 'req-failed-r']]);
});

test('esiti: stale / scaduta / già usata / server giù, per provenienza', async ({ openTab }) => {
  const page = await openManage(openTab);
  const msgs = await page.evaluate(() => {
    const M = window.SN_MERGE_APPROVALS.outcomeMessage;
    const r = { origin: 'routine', num: '5' };
    const l = {};
    return {
      staleR: M({ ok: true, result: 'stale' }, r).text,
      staleL: M({ ok: true, result: 'stale' }, l).text,
      expR: M({ ok: false, error: 'richiesta scaduta' }, r).text,
      used: M({ ok: false, error: 'already_used' }, l).text,
      down: M({ ok: false, error: 'github_unreachable' }, l).text,
      weird: M({ ok: true, result: 'boh' }, l).text,
      conflR: M({ ok: true, result: 'conflict' }, r).kind,
    };
  });
  expect(msgs.staleR).toContain('torna alla routine');
  expect(msgs.staleL).toContain('npm run finish');
  expect(msgs.expR).not.toContain('npm run finish');
  expect(msgs.used).toContain('già stata usata');
  expect(msgs.down).toContain('nessuna fusione');
  expect(msgs.weird).toContain('nessuna fusione');
  expect(msgs.conflR).toBe('warn');
});

test('input ostili: HTML nel ramo/chi e stringhe lunghissime restano testo', async ({ openTab }) => {
  const page = await openManage(openTab);
  const long = 'x'.repeat(10000);
  await renderCards(page, {
    requests: [{ ...pendingLocal, id: 'h1', branch: '<img src=x onerror="window.__xss=1">', who: '<b>a@b.c</b>', blocks: [{ label: '<script>window.__xss=2</script>', items: ['<i>x</i>'] }] }],
    failed: [{ ...failedLocal, id: 'h2', branch: long, who: '   ', sha: '' }],
  }, {});
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('#mgMergeApprovals img, #mgMergeApprovals script, #mgMergeApprovals b, #mgMergeApprovals i').count()).toBe(0);
  await expect(page.locator('#mgMergeApprovals .sn-mac-card-failed .sn-mac-who')).toHaveText('chi l’ha chiesta non risulta');
  // la scheda lunga non allarga la pagina in orizzontale
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(overflow).toBe(false);
});

test('svuotare: nessuna richiesta e nessuna fallita → blocco nascosto', async ({ openTab }) => {
  const page = await openManage(openTab);
  await renderCards(page, { requests: [pendingLocal], failed: [failedLocal] }, {});
  await expect(page.locator('#mgMergeApprovals')).toBeVisible();
  const n = await renderCards(page, { requests: [], failed: [] }, {});
  expect(n).toBe(0);
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
});

test('solo fallite, nessuna in attesa: il blocco si vede lo stesso, e solo nei Ricevuti', async ({ openTab }) => {
  const page = await openManage(openTab);
  await renderCards(page, { requests: [], failed: [failedRoutine] }, {});
  await expect(page.locator('#mgMergeApprovals')).toBeVisible();
  await expect(page.locator('#mgMergeApprovals section.sn-mac')).toHaveCount(1);
  await expect(page.locator('#mgMergeApprovals .sn-mac-title-text')).toHaveText('Una fusione approvata non è avvenuta');
});

test('traccia recente: esito "approvata, ma in conflitto" distinto', async ({ openTab }) => {
  const page = await openManage(openTab);
  const rows = await page.evaluate(() => {
    const host = document.getElementById('mgMergeApprovalsRecent');
    window.SN_MERGE_APPROVALS.renderRecent(host, { recent: [
      { branch: 'a', outcome: 'conflict', used: true, who: 'x@y.z', decidedAtMs: Date.now() - 60000 },
      { branch: 'b', outcome: 'merged', used: true, who: 'x@y.z', decidedAtMs: Date.now() - 60000 },
      { branch: 'c', used: true, who: 'secaudit', origin: 'routine', num: '9', decidedAtMs: Date.now() - 60000 },
    ] });
    return [...host.querySelectorAll('.sn-mac-recent-what')].map((e) => e.textContent);
  });
  expect(rows).toEqual(['approvata, ma in conflitto', 'approvata e fusa', 'approvata']);
});
