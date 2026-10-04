// #550 giro 2 — esplorazione: la conferma della fusione nel quadrato e in Automazioni.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const GIORNO = 24 * 60 * 60 * 1000;

const FB = {
  _id: 'fb-550-g2',
  text: 'Il menu della copertina perde metà delle voci quando la finestra è stretta.',
  name: 'Menu copertina',
  seq: 700, subSeq: 0,
  status: 'revision_security',
  clientId: 'tester@example.com',
  createdAt: '2026-09-10T10:00:00Z',
  images: [],
  pipeline: { action: 'human_review', l1Category: 'clean', verdicts: [], expectedJudges: [], stage: 'L2' },
};

function richiesta(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56',
    branch: 'claude/menu-copertina',
    sha: SHA,
    who: 'secaudit · notturna',
    num: '#700',
    origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 2 * 60 * 1000,
    expiresAtMs: Date.now() + GIORNO,
    expired: false, used: false, discarded: false,
  }, over);
}

async function apri(page, feedbacks, { pending = [], ritardo = 0 } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: window.__pending || cfg.pending, failed: [], recent: [], preapproved: [], ttlMs: 7 * GIORNO };
      if (t === 'merge_approval_approve' || t === 'merge_approval_discard') {
        window.__chiamate.push({ type: t, id: msg.id });
        if (cfg.ritardo) await new Promise((r) => setTimeout(r, cfg.ritardo));
        return t === 'merge_approval_approve' ? { ok: true, result: 'merged', sha: 'deadbeefcafe' } : { ok: true, result: 'discarded' };
      }
      return orig(msg);
    };
  }, { pending, ritardo });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

const dentro = (p, b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

test('quadrato, temi: il tasto armato non cambia scatola', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB], { pending: [richiesta()] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const corpo = page.locator('#mgSideBody');
  const go = corpo.locator('.sn-mac-btn-go');
  const scarta = corpo.locator('.sn-mac-btn-quiet');
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await expect(go).toHaveText('Approva e fondi', { timeout: 8000 });
    const p = await go.boundingBox();
    const s0 = await scarta.boundingBox();
    await go.click({ position: { x: 2, y: p.height / 2 } });
    await expect(go).toHaveText('Confermi?');
    const a = await go.boundingBox();
    const s1 = await scarta.boundingBox();
    console.log(tema, JSON.stringify({ p, a, s0, s1 }));
    for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(a[k] - p[k]), k).toBeLessThan(0.5);
    for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(s1[k] - s0[k]), 's' + k).toBeLessThan(0.5);
    await page.locator('#mgSide').screenshot({ path: `tests/.shots/550-g2-armato-${tema}.png` });
    await page.waitForTimeout(5300);
  }
});

test('quadrato: un ridisegno della pratica (stato cambiato, testo più lungo) mentre è armato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB], { pending: [richiesta()] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  await expect(go).toBeVisible();
  const b = await go.boundingBox();
  const punto = { x: b.x + 3, y: b.y + b.height / 2 };
  await page.mouse.click(punto.x, punto.y);
  await expect(go).toHaveText('Confermi?');
  const lungo = { ...FB, text: FB.text + ' Altro testo. '.repeat(80), status: 'revision_fix', userNote: 'Una frase.' };
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [lungo]);
  await page.evaluate((id) => window.__mgTest.rerenderIfIdle(id), FB._id);
  await page.waitForTimeout(400);
  const dopo = await go.boundingBox();
  console.log('ridisegno', JSON.stringify({ b, dopo, testo: await go.textContent() }));
  await expect(go).toHaveText('Confermi?');
  const s = await page.locator('#mgSideBody .sn-mac-btn-quiet').boundingBox();
  expect(dentro(punto, s), 'Scarta sotto il punto').toBe(false);
  await page.mouse.click(punto.x, punto.y);
  await expect.poll(() => page.evaluate(() => window.__chiamate.map((c) => c.type))).toEqual(['merge_approval_approve']);
});

test('quadrato con due richieste: confermare la prima non tocca la seconda, e dopo il ricarico lo stesso punto non scarta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const r1 = richiesta();
  const r2 = richiesta({ id: 'ff12cd34ef56ab12cd34ef99', branch: 'claude/menu-copertina-bis', sha: 'ff'.repeat(20) });
  await apri(page, [FB], { pending: [r1, r2] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const cards = page.locator('#mgSideBody .sn-mac-card');
  await expect(cards).toHaveCount(2);
  const go = cards.nth(0).locator('.sn-mac-btn-go');
  const b = await go.boundingBox();
  const punto = { x: b.x + 3, y: b.y + b.height / 2 };
  await page.mouse.click(punto.x, punto.y);
  await page.mouse.click(punto.x, punto.y);
  await expect.poll(() => page.evaluate(() => window.__chiamate)).toEqual([{ type: 'merge_approval_approve', id: r1.id }]);
  await page.evaluate((r) => { window.__pending = [r]; }, r2);
  await page.waitForTimeout(2500);
  const rimaste = await page.locator('#mgSideBody .sn-mac-card').count();
  const s = await page.locator('#mgSideBody .sn-mac-btn-quiet').first().boundingBox().catch(() => null);
  console.log('dopo ricarico', rimaste, JSON.stringify({ punto, s }));
});

test('quadrato: conferma con server lento, clic ripetuti nello stesso punto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB], { pending: [richiesta()], ritardo: 1500 });
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  const b = await go.boundingBox();
  const punto = { x: b.x + 3, y: b.y + b.height / 2 };
  await page.mouse.click(punto.x, punto.y);
  await page.mouse.click(punto.x, punto.y);
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(250); await page.mouse.click(punto.x, punto.y); }
  await page.waitForTimeout(2000);
  const ch = await page.evaluate(() => window.__chiamate.map((c) => c.type));
  console.log('lento', JSON.stringify(ch));
  expect(ch).toEqual(['merge_approval_approve']);
});

test('tastiera: Invio due volte fonde, e lo stato si legge', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FB], { pending: [richiesta()] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(go).toHaveText('Confermi?');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__chiamate.map((c) => c.type))).toEqual(['merge_approval_approve']);
});

test('Automazioni, finestra stretta: il tasto armato non cambia scatola', async ({ app, openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [], { pending: [richiesta({ num: '', origin: 'local' })] });
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.setSize(520, 700); });
  await page.waitForTimeout(500);
  const go = page.locator('#mgMergeApprovalsOrphans .sn-mac-btn-go');
  const scarta = page.locator('#mgMergeApprovalsOrphans .sn-mac-btn-quiet');
  await expect(go).toBeVisible({ timeout: 8000 });
  const p = await go.boundingBox();
  const s0 = await scarta.boundingBox();
  await go.click({ position: { x: 2, y: p.height / 2 } });
  await expect(go).toHaveText('Confermi?');
  const a = await go.boundingBox();
  const s1 = await scarta.boundingBox();
  console.log('stretta', JSON.stringify({ p, a, s0, s1 }));
  await page.screenshot({ path: 'tests/.shots/550-g2-stretta.png' });
  for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(a[k] - p[k]), k).toBeLessThan(0.5);
  for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(s1[k] - s0[k]), 's' + k).toBeLessThan(0.5);
});
