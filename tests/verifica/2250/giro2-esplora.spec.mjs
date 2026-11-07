// Verifica #2250 giro 2: esplorazione della scheda di approvazione (voci chiuse, volo, ridisegni).
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const MIN = 60 * 1000;

const fb = (id, seq, extra = {}) => ({
  _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`, seq, subSeq: 0,
  clientId: 'tester@example.com', createdAt: '2026-09-12T10:00:00Z', images: [], statusPublic: 'open',
  status: 'design', statusReason: 'l5', ...extra,
});
const voci = (n, p) => Array.from({ length: n }, (_, i) => ({ file: `src/${p}${i}.js`, riga: i + 1, testo: `exec('${p}-${i}');` }));
const req = (id, blocks, extra = {}) => ({
  id: 'a'.repeat(24), branch: `claude/${id}`, sha: 'a'.repeat(40), feedbackId: id, num: '1867',
  who: 'secaudit · notturna', origin: 'routine', blocks,
  createdAtMs: Date.now() - 5 * MIN, expiresAtMs: Date.now() + 24 * 60 * MIN, ...extra,
});

async function apri(openTab, r, { approva = 'mai', scarta = null, tema = null } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  if (tema) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
  await page.evaluate(({ docs, r, approva, scarta }) => {
    window.__r = r;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [window.__r], failed: [], recent: [], preapproved: [] };
      if (t === 'merge_approval_approve') {
        if (approva === 'mai') return new Promise(() => {});
        if (approva === 'errore') return new Promise((res) => setTimeout(() => res({ ok: false, error: 'boom' }), 2500));
        return approva;
      }
      if (t === 'merge_approval_discard' || t === 'merge_approval_reject') {
        if (scarta === 'mai') return new Promise(() => {});
        return { ok: true };
      }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs: [fb(r.feedbackId, 1867)], r, approva, scarta });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((id) => window.__mgTest.openDetail(id), r.feedbackId);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  return page;
}

test('A: blocco da 20 voci, il caso della segnalazione', async ({ openTab }) => {
  const page = await apri(openTab, req('venti', [{ gate: 'g', gruppo: 'capacita', label: 'Avvia', voci: voci(20, 'a'), more: 0 }]));
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 8 voci');
  await expect(go).toBeEnabled();
  console.log('title chiuse:', await go.getAttribute('title'));
  await expect(card).not.toContainText('Apri tutte le voci per approvare');
  await card.screenshot({ path: 'tests/.shots/v2250-g2-chiuse.png' });
  await go.click();
  await expect(go).toHaveText('Approva e fondi');
  await expect(go).toBeEnabled();
  await expect(card.locator('.sn-mac-block-list > [hidden]')).toHaveCount(0);
  await go.click();
  await expect(go).toHaveText('Confermi?');
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await expect(card.locator('.sn-mac-trascorso')).toHaveText(/^da \d+ s$/);
  await page.waitForTimeout(2200);
  await card.screenshot({ path: 'tests/.shots/v2250-g2-volo.png' });
});

test('B: aperte a mano una per blocco, il conto scende', async ({ openTab }) => {
  const page = await apri(openTab, req('due', [
    { gate: 'g1', gruppo: 'capacita', label: 'Uno', voci: voci(15, 'a'), more: 0 },
    { gate: 'g2', gruppo: 'contenuto', label: 'Due', voci: voci(20, 'b'), more: 0 },
  ]));
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 11 voci');
  await card.locator('.sn-mac-tutte').first().click();
  await expect(go).toHaveText('Apri le 8 voci');
  await card.locator('.sn-mac-tutte').first().click();
  await expect(go).toHaveText('Approva e fondi');
});

test('C: #798, 73 voci nell’ultimo di cinque blocchi: la prima aperta in vista', async ({ openTab }) => {
  const blocks = [0, 1, 2, 3].map((i) => ({ gate: 'g' + i, gruppo: 'guardie', label: 'B' + i, voci: voci(3, 'p' + i), more: 0 }));
  blocks.push({ gate: 'g9', gruppo: 'contenuto', label: 'Diff', voci: voci(85, 'z'), more: 0 });
  const page = await apri(openTab, req('tanti', blocks));
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 73 voci');
  await go.scrollIntoViewIfNeeded();
  await go.click();
  await expect(go).toHaveText('Approva e fondi');
  await expect(card.locator('.sn-mac-voce, .sn-mac-block-list > li').nth(12 + 12)).toBeInViewport();
});

test('D: rilettura della lista dopo averle aperte', async ({ openTab }) => {
  const page = await apri(openTab, req('rilegge', [{ gate: 'g', gruppo: 'capacita', label: 'Avvia', voci: voci(20, 'a'), more: 0 }]));
  const go = page.locator('#mgSideBody .sn-mac-card .sn-mac-btn-go');
  await go.click();
  await expect(go).toHaveText('Approva e fondi');
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.waitForTimeout(500);
  await expect(page.locator('#mgSideBody .sn-mac-card .sn-mac-btn-go')).toHaveText('Approva e fondi');
});

test('E: server di prima, voci non mandate', async ({ openTab }) => {
  const page = await apri(openTab, req('vecchio', [{ gate: 'g', label: 'Vecchio', items: ['a', 'b'], more: 5 }], { diffUrl: 'https://github.com/x/y/compare/a...b' }));
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  console.log('E testo:', await go.textContent());
  await go.click();
  await expect(card.locator('.sn-mac-mancanti')).toBeVisible();
  await expect(go).toHaveText('Approva e fondi');
});

test('F: tema scuro, chiuse e in volo', async ({ openTab }) => {
  const page = await apri(openTab, req('scuro', [{ gate: 'g', gruppo: 'capacita', label: 'Avvia', voci: voci(20, 'a'), more: 0 }]), { tema: 'dark' });
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await card.screenshot({ path: 'tests/.shots/v2250-g2-scuro-chiuse.png' });
  await go.click(); await go.click(); await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await page.waitForTimeout(1200);
  await card.screenshot({ path: 'tests/.shots/v2250-g2-scuro-volo.png' });
});

test('G: Scarta in volo, come appare Approva', async ({ openTab }) => {
  const page = await apri(openTab, req('scarta', [{ gate: 'g', gruppo: 'capacita', label: 'Avvia', voci: voci(3, 'a'), more: 0 }]), { scarta: 'mai' });
  const card = page.locator('#mgSideBody .sn-mac-card');
  await card.locator('.sn-mac-btn-quiet').click();
  await page.waitForTimeout(800);
  const go = card.locator('.sn-mac-btn-go');
  console.log('G testo:', await go.textContent(), 'disabled', await go.isDisabled(), 'status', await card.locator('.sn-mac-status').textContent());
  await card.screenshot({ path: 'tests/.shots/v2250-g2-scarta.png' });
});

test('H: errore dopo il volo: tasto di nuovo acceso, tempo via', async ({ openTab }) => {
  const page = await apri(openTab, req('err', [{ gate: 'g', gruppo: 'capacita', label: 'Avvia', voci: voci(3, 'a'), more: 0 }]), { approva: 'errore' });
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await go.click(); await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await expect(go).toHaveText('Approva e fondi', { timeout: 6000 });
  await expect(go).toBeEnabled();
  await expect(card.locator('.sn-mac-trascorso')).toHaveCount(0);
  console.log('H status:', await card.locator('.sn-mac-status').textContent());
});

test('I: tastiera, Invio sul tasto', async ({ openTab }) => {
  const page = await apri(openTab, req('tasti', [{ gate: 'g', gruppo: 'capacita', label: 'Avvia', voci: voci(14, 'a'), more: 0 }]));
  const go = page.locator('#mgSideBody .sn-mac-card .sn-mac-btn-go');
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(go).toHaveText('Approva e fondi');
  await page.keyboard.press('Enter');
  await expect(go).toHaveText('Confermi?');
});
