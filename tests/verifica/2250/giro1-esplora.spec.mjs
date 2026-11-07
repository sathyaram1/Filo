// Verifica #2250 giro 1: esplorazione della scheda di approvazione (voci chiuse, fusione in volo).
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const DIFF = `https://github.com/sathyaram1/Filo/compare/${'b0'.repeat(20)}...${SHA}`;
const voce = (file, riga, testo) => ({ file, riga, testo, url: `${DIFF}#diff-${'0'.repeat(64)}R${riga}` });
const voci = (n, p) => Array.from({ length: n }, (_, i) => voce(`src/main/${p}${i}.js`, 1 + i, `spawn('${p}-${i}');`));

function richiesta(over = {}) {
  return Object.assign({
    id: 'cd12cd34ef56ab12cd34ef56', branch: 'claude/prova', sha: SHA, diffUrl: DIFF, who: 'owner@esempio',
    blocks: [{ gate: 'child_process', gruppo: 'capacita', label: 'Avvia un programma esterno', voci: voci(20, 'v'), more: 0 }],
    createdAtMs: Date.now() - 60_000, expiresAtMs: Date.now() + 86_400_000, expired: false, used: false, discarded: false,
  }, over);
}

async function apri(page, pending, approva = null) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ pending, approva }) => {
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending, failed: [], recent: [], preapproved: [], preapprovedTotal: 0, ttlMs: 7 * 86_400_000 };
      if (t === 'merge_approval_approve') {
        window.__chiamate.push(msg);
        if (approva === 'mai') return new Promise(() => {});
        return approva || { ok: true, result: 'merged', sha: 'b'.repeat(40) };
      }
      return orig(msg);
    };
  }, { pending, approva });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await apriScheda(page, 'automation');
}

test('scenario #798: cinque blocchi, 73 voci chiuse nell’ultimo, il tasto le apre e poi fonde', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const blocks = [
    { gate: 'a', gruppo: 'guardie', label: 'Uno', voci: voci(3, 'a'), more: 0 },
    { gate: 'b', gruppo: 'guardie', label: 'Due', voci: voci(5, 'b'), more: 0 },
    { gate: 'c', gruppo: 'capacita', label: 'Tre', voci: voci(12, 'c'), more: 0 },
    { gate: 'd', gruppo: 'capacita', label: 'Quattro', voci: voci(2, 'd'), more: 0 },
    { gate: 'e', gruppo: 'contenuto', label: 'Cinque', voci: voci(85, 'e'), more: 0 },
  ];
  await apri(page, [richiesta({ blocks })]);
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 73 voci', { timeout: 8_000 });
  await expect(go).toBeEnabled();
  await go.scrollIntoViewIfNeeded();
  await go.click();
  await expect(card.locator('.sn-mac-voce').filter({ hasText: 'src/main/e12.js' })).toBeInViewport();
  await expect(go).toHaveText('Approva e fondi');
  await go.click();
  await expect(go).toHaveText('Confermi?');
  await go.click();
  await expect.poll(() => page.evaluate(() => window.__chiamate.length)).toBe(1);
});

test('tastiera: Invio apre le voci, Invio arma, Invio approva', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [richiesta()], 'mai');
  const go = page.locator('#mgMergeApprovalsOrphans .sn-mac-card .sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 8 voci', { timeout: 8_000 });
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(go).toHaveText('Approva e fondi');
  await page.keyboard.press('Enter');
  await expect(go).toHaveText('Confermi?');
  await page.keyboard.press('Enter');
  await expect(go).toHaveText('Sto fondendo');
});

test('in volo: cambiare scheda e tornare non azzera il tempo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [richiesta({ blocks: [{ gate: 'x', gruppo: 'guardie', label: 'Uno', voci: voci(2, 'x'), more: 0 }] })], 'mai');
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Approva e fondi', { timeout: 8_000 });
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await page.waitForTimeout(4_000);
  await apriScheda(page, 'queue');
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await apriScheda(page, 'automation');
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  const t = page.locator('#mgMergeApprovalsOrphans .sn-mac-card .sn-mac-trascorso');
  await expect(t).toBeVisible();
  const s = Number(((await t.textContent()) || '').replace(/\D/g, ''));
  expect(s).toBeGreaterThanOrEqual(4);
  await expect(page.locator('#mgMergeApprovalsOrphans .sn-mac-card .sn-mac-btn-go')).toHaveText('Sto fondendo');
  await page.locator('#mgMergeApprovalsOrphans .sn-mac-card').screenshot({ path: 'tests/.shots/v2250-volo-chiaro.png' });
});

test('fusione fallita: il tasto torna acceso, senza rotella né tempo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [richiesta({ blocks: [{ gate: 'x', gruppo: 'guardie', label: 'Uno', voci: voci(2, 'x'), more: 0 }] })], { ok: false, error: 'GitHub non risponde' });
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Approva e fondi', { timeout: 8_000 });
  await go.click();
  await go.click();
  await expect(card.locator('.sn-mac-status')).toBeVisible();
  await expect(go).toBeEnabled();
  await expect(go).toHaveText('Approva e fondi');
  await expect(go).not.toHaveClass(/is-fondendo/);
  await expect(card.locator('.sn-mac-trascorso')).toHaveCount(0);
});

test('tema scuro: voci chiuse e in volo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.emulateMedia({ colorScheme: 'dark' });
  await apri(page, [richiesta()], 'mai');
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 8 voci', { timeout: 8_000 });
  await card.locator('.sn-mac-actions').scrollIntoViewIfNeeded();
  await card.locator('.sn-mac-actions').screenshot({ path: 'tests/.shots/v2250-apri-scuro.png' });
  await go.click();
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await page.waitForTimeout(1500);
  await card.locator('.sn-mac-actions').screenshot({ path: 'tests/.shots/v2250-volo-scuro-tasti.png' });
  await card.screenshot({ path: 'tests/.shots/v2250-volo-scuro.png' });
});
