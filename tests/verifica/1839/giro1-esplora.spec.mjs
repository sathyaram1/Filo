// Verifica #1839 giro 1: lista, dettaglio, Log, registro dei rifiuti e scheda di approvazione dal lato dell'owner.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ORA = Date.now();

function pratica(id, seq, over = {}) {
  return Object.assign({
    _id: id, name: `Pratica ${seq}`, text: `Testo ${seq}.`, seq, subSeq: 0, status: 'todo', statusPublic: 'open',
    clientId: 'owner:test', createdAt: new Date(ORA - seq * 1000).toISOString(), images: [], branch: `worker/${id}`,
  }, over);
}
function richiesta(fbId, seq, over = {}) {
  return Object.assign({
    id: `r-${fbId}`, feedbackId: fbId, num: `#${seq}`, branch: `worker/${fbId}`, sha: 'abcdef1234567',
    origin: 'routine', who: 'secaudit · slug', createdAtMs: ORA - 60000, expiresAtMs: ORA + 6 * 86400000,
    blocks: [{ rule: 'tocca le regole', file: 'firestore.rules' }],
  }, over);
}

async function apri(page, lista, fusioni, extra = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ fusioni, extra }) => {
    window.__approva = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return Object.assign({ ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 }, fusioni);
      if (t === 'merge_approval_approve') { window.__approva.push(msg); return new Promise(() => {}); }
      if (t === 'worker_log_get' && extra.log) return { ok: true, entries: extra.log };
      return orig(msg);
    };
  }, { fusioni, extra });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

const voce = (page, seq) => page.locator('.mg-item').filter({ hasText: `#${seq}` }).first();

test('lista: rossa e in cima solo la richiesta da decidere; da riallineare e fusa restano quiete', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lista = [
    pratica('f-norm', 300, { status: 'unlabeled' }),
    pratica('f-fusa', 200, { status: 'design', statusReason: 'l5' }),
    pratica('f-pend', 100, { status: 'design', statusReason: 'l5' }),
    pratica('f-ria', 400, { status: 'working' }),
    pratica('f-coda', 500, { status: 'todo' }),
  ];
  await apri(page, lista, {
    pending: [richiesta('f-pend', 100)],
    failed: [richiesta('f-ria', 400, { outcome: 'conflict', decidedAtMs: ORA - 3600000 })],
    recent: [richiesta('f-fusa', 200, { used: true, outcome: 'merged', createdAtMs: ORA - 1000 })],
  });
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await expect(page.locator('.mg-item').first()).toContainText('#100');
  await expect(voce(page, 100)).toHaveClass(/mg-item--fusione/);
  await expect(voce(page, 200)).not.toHaveClass(/mg-item--fusione/);
  await expect(voce(page, 200)).not.toContainText('fusione ferma');
  await page.screenshot({ path: 'tests/.shots/1839-g1-inbox.png' });

  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await expect(voce(page, 400)).toBeVisible();
  await expect(voce(page, 400)).not.toHaveClass(/mg-item--fusione/);
  await expect(voce(page, 400)).toContainText('da riallineare');
  await expect(voce(page, 400)).not.toContainText('fusione ferma');
  await page.screenshot({ path: 'tests/.shots/1839-g1-queue.png' });

  // Riga dei tasti della pratica da riallineare: niente chiusure che scavalcano la fusione.
  await page.evaluate(() => window.__mgTest.openDetail('f-ria'));
  await expect(page.locator('#mgActionsRow')).not.toContainText('Risolto');
  await expect(page.locator('#mgActionsRow')).not.toContainText('Archivia');
  // Con la richiesta da decidere, uguale.
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate(() => window.__mgTest.openDetail('f-pend'));
  await expect(page.locator('#mgActionsRow')).not.toContainText('Risolto');
  await expect(page.locator('#mgActionsRow')).not.toContainText('Archivia');
  await expect(page.locator('#mgActionsRow')).not.toContainText('Approva');
});

test('scheda di approvazione: il tempo cammina da solo, dice scaduta, ruolo tradotto, rotella durante la fusione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lista = [pratica('f-pend', 100, { status: 'design', statusReason: 'l5' })];
  await apri(page, lista, { pending: [richiesta('f-pend', 100, { expiresAtMs: ORA + 2 * 60000 + 20000 })] });
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate(() => window.__mgTest.openDetail('f-pend'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const card = page.locator('#mgSideBody .sn-mac-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.sn-mac-expiry')).toContainText('2 minuti');
  await expect(card.locator('.sn-mac-who')).toContainText('Audit sicurezza');
  await expect(card.locator('.sn-mac-who')).not.toContainText('secaudit');

  // Primo clic (Confermi?) poi l'orologio va avanti: la scritta cambia e il clic armato resta.
  await card.locator('.sn-mac-btn-go').click();
  await expect(card.locator('.sn-mac-btn-go')).toHaveText('Confermi?');
  await page.evaluate(() => { const o = Date.now; Date.now = () => o() + 60000; });
  await expect(card.locator('.sn-mac-expiry')).toContainText(/1 minuto|meno di un minuto/, { timeout: 20000 });
  await page.evaluate(() => { const o = Date.now; Date.now = () => o() + 5 * 60000; });
  await expect(card.locator('.sn-mac-expiry')).toHaveText('scaduta', { timeout: 20000 });
  await expect(card).toHaveClass(/is-expired/);
  await page.screenshot({ path: 'tests/.shots/1839-g1-scaduta.png' });
});

test('fusione in volo: rotella accanto alla frase, frase non sbiadita', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lista = [pratica('f-pend', 100, { status: 'design', statusReason: 'l5' })];
  await apri(page, lista, { pending: [richiesta('f-pend', 100)] });
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate(() => window.__mgTest.openDetail('f-pend'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const card = page.locator('#mgSideBody .sn-mac-card').first();
  await card.locator('.sn-mac-btn-go').click();
  await card.locator('.sn-mac-btn-go').click({ delay: 50 });
  await expect(card).toHaveClass(/is-merging/);
  const st = card.locator('.sn-mac-status');
  await expect(st).toBeVisible();
  const info = await st.evaluate((el) => {
    const pre = getComputedStyle(el, '::before');
    let op = 1; for (let n = el; n; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    return { anim: pre.animationName, content: pre.content, op };
  });
  expect(info.anim).toContain('sn-mac-gira');
  expect(info.op).toBeGreaterThan(0.95);
  console.log('QUADRATO', await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').getAttribute('class'),
    await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').getAttribute('title'));
  await page.waitForTimeout(3000);
  console.log('QUADRATO2', await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').getAttribute('class'));
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/1839-g1-volo-${tema}.png` });
  }
});

test('Log e registro dei rifiuti: un cancelletto, frasi col dettaglio, sconosciuto con frase e codice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica('f-norm', 300)], {});
  await page.evaluate(() => window.__mgTest.setTab('log'));
  await page.evaluate(() => window.__mgTest.renderWorkerLog([
    { role: 'verifier', startedAt: new Date().toISOString(), num: '#500' },
    { role: 'fixer', startedAt: new Date().toISOString(), num: '501' },
  ]));
  const log = page.locator('#mgLogList');
  await expect(log).toContainText('#500');
  await expect(log).toContainText('#501');
  await expect(log).not.toContainText('##');
  await page.evaluate(() => window.__mgTest.renderChannelLog([
    { at: new Date().toISOString(), reason: 'secaudit_stale', detail: 'audit di abc, punta def', num: '#7' },
    { at: new Date().toISOString(), reason: 'codice_nuovo', detail: 'boh', num: '8' },
  ], []));
  const ch = page.locator('#mgChannelList');
  await expect(ch).toContainText('il controllo di sicurezza valeva per un altro commit');
  await expect(ch).toContainText('audit di abc, punta def');
  await expect(ch).toContainText('codice_nuovo');
  await expect(ch).toContainText('non conosce');
  await expect(ch).not.toContainText('##');
  await page.screenshot({ path: 'tests/.shots/1839-g1-log.png', fullPage: true });
});
