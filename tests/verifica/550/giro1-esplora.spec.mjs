// #550 giro 1: confermando una fusione ferma, il secondo clic nello stesso punto deve
// approvare, mai scartare; i tasti non si muovono fra il primo clic e la conferma.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const GIORNO = 24 * 60 * 60 * 1000;

const FB = {
  _id: 'fb-550', text: 'Il menu perde le voci.', name: 'Menu', seq: 700, subSeq: 0,
  status: 'revision_security', clientId: 'tester@example.com', createdAt: '2026-09-10T10:00:00Z', images: [],
  pipeline: { action: 'human_review', l1Category: 'clean', verdicts: [], stage: 'L2' },
};

function richiesta(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56', branch: 'claude/allegati', sha: SHA, who: 'owner@esempio',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60_000, expiresAtMs: Date.now() + GIORNO,
    expired: false, used: false, discarded: false,
  }, over);
}

async function apri(page, feedbacks, pending, approveReply) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: cfg.pending, failed: [], recent: [], preapproved: [], ttlMs: 7 * cfg.GIORNO };
      if (t === 'merge_approval_approve') { window.__chiamate.push('approve'); await new Promise((r) => setTimeout(r, 300)); return cfg.approveReply || { ok: true, result: 'merged', sha: 'deadbeefcafe' }; }
      if (t === 'merge_approval_discard') { window.__chiamate.push('discard'); return { ok: true, result: 'discarded' }; }
      return orig(msg);
    };
  }, { pending, approveReply, GIORNO });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

async function sotto(page, x, y) {
  return page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    const b = e && e.closest('button');
    return b ? b.className : (e ? e.tagName : null);
  }, [x, y]);
}

async function provaPunto(page, host, frazione) {
  const go = host.locator('.sn-mac-btn-go');
  await expect(go).toBeVisible({ timeout: 8_000 });
  const prima = await go.boundingBox();
  const scartaPrima = await host.locator('.sn-mac-btn-quiet').boundingBox();
  const p = { x: prima.x + prima.width * frazione, y: prima.y + prima.height / 2 };
  await page.mouse.click(p.x, p.y);
  await expect(go).toHaveText('Confermi?');
  const armato = await go.boundingBox();
  const scartaArmato = await host.locator('.sn-mac-btn-quiet').boundingBox();
  for (const k of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(armato[k] - prima[k]), `Approva ${k}`).toBeLessThan(0.5);
    expect(Math.abs(scartaArmato[k] - scartaPrima[k]), `Scarta ${k}`).toBeLessThan(0.5);
  }
  expect(await sotto(page, p.x, p.y)).toContain('sn-mac-btn-go');
  await page.waitForTimeout(700);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__chiamate)).toEqual(['approve']);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__chiamate)).toEqual(['approve']);
}

for (const fr of [0.03, 0.25, 0.5]) {
  test(`quadrato rosso: conferma al ${Math.round(fr * 100)}% del tasto approva`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await apri(page, [FB], [richiesta({ num: '#700', origin: 'routine' })]);
    await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
    await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
    await provaPunto(page, page.locator('#mgSideBody'), fr);
  });

  test(`Automazioni: conferma al ${Math.round(fr * 100)}% del tasto approva`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await apri(page, [], [richiesta()]);
    await page.locator('.mg-tab[data-tab="automation"]').click();
    await provaPunto(page, page.locator('#mgMergeApprovalsOrphans'), fr);
  });
}

test('il tasto torna da solo come prima: stessa scatola, e un clic dopo riarma', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [], [richiesta()]);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const host = page.locator('#mgMergeApprovalsOrphans');
  const go = host.locator('.sn-mac-btn-go');
  await expect(go).toBeVisible({ timeout: 8_000 });
  const prima = await go.boundingBox();
  const p = { x: prima.x + 3, y: prima.y + prima.height / 2 };
  await page.mouse.click(p.x, p.y);
  await expect(go).toHaveText('Confermi?');
  await expect(go).toHaveText('Approva e fondi', { timeout: 7_000 });
  const dopo = await go.boundingBox();
  for (const k of ['x', 'width']) expect(Math.abs(dopo[k] - prima[k])).toBeLessThan(0.5);
  await page.mouse.click(p.x, p.y);
  await expect(go).toHaveText('Confermi?');
  expect(await page.evaluate(() => window.__chiamate)).toEqual([]);
});

test('due richieste: confermare la prima non fa scartare né la seconda né la prima', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [], [richiesta(), richiesta({ id: 'ff12cd34ef56ab12cd34ef99', branch: 'claude/altro' })],
    { ok: false, error: 'callable ownerMergeApprovals 500: github_unreachable' });
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const host = page.locator('#mgMergeApprovalsOrphans');
  const go = host.locator('.sn-mac-card').first().locator('.sn-mac-btn-go');
  await expect(go).toBeVisible({ timeout: 8_000 });
  const prima = await go.boundingBox();
  const p = { x: prima.x + 3, y: prima.y + prima.height / 2 };
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  await page.mouse.click(p.x, p.y);
  await expect(host.locator('.sn-mac-status').first()).toContainText(/non raggiungibile/i, { timeout: 8_000 });
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__chiamate)).toEqual(['approve']);
  await expect(go).toHaveText('Confermi?');
});

test('tema scuro e finestra stretta: scatola ferma e foto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.setViewportSize({ width: 760, height: 700 }).catch(() => {});
  await page.emulateMedia({ colorScheme: 'dark' });
  await apri(page, [FB], [richiesta({ num: '#700', origin: 'routine' })]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const corpo = page.locator('#mgSideBody');
  const go = corpo.locator('.sn-mac-btn-go');
  await expect(go).toBeVisible({ timeout: 8_000 });
  const prima = await go.boundingBox();
  await page.screenshot({ path: 'tests/.shots/550-prima.png' });
  await page.mouse.click(prima.x + 3, prima.y + prima.height / 2);
  await expect(go).toHaveText('Confermi?');
  await page.mouse.move(prima.x + 3, prima.y + prima.height / 2);
  await page.screenshot({ path: 'tests/.shots/550-armato.png' });
  const armato = await go.boundingBox();
  expect(Math.abs(armato.x - prima.x)).toBeLessThan(0.5);
  expect(Math.abs(armato.width - prima.width)).toBeLessThan(0.5);
});

test('doppio clic su Approva e fondi: non fonde in un gesto solo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB], [richiesta({ num: '#700', origin: 'routine' })]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  await expect(go).toBeVisible({ timeout: 8_000 });
  await go.dblclick();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__chiamate)).toEqual([]);
});
