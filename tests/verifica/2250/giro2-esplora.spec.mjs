// Esplorazione del giro 2 di #2250: tasto delle voci chiuse, fusione in volo, esito a volo finito.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const MIN = 60 * 1000;

function fb(id, seq, extra = {}) {
  return {
    _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`,
    seq, subSeq: 0, clientId: 'tester@example.com', createdAt: '2026-09-12T10:00:00Z',
    images: [], statusPublic: 'open', ...extra,
  };
}
const voci = (n, p) => Array.from({ length: n }, (_, i) => ({ file: `src/${p}${i}.js`, riga: i + 1, testo: `exec('${p}-${i}');` }));
function richiesta(id, feedbackId, num, blocks, extra = {}) {
  return {
    id, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: String(num),
    who: 'secaudit · notturna', origin: 'routine', blocks,
    createdAtMs: Date.now() - 5 * MIN, expiresAtMs: Date.now() + 24 * 60 * MIN, ...extra,
  };
}

async function apri(openTab, docs, liste) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, liste }) => {
    window.__liste = liste;
    window.__risposte = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ...window.__liste };
      if (t === 'merge_approval_approve') return new Promise((r) => window.__risposte.push(r));
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs, liste });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

test('voci chiuse in due blocchi: il conto, un blocco aperto a mano, poi il resto col tasto', async ({ openTab }) => {
  const blocks = [
    { gate: 'g1', gruppo: 'capacita', label: 'Avvia un programma', voci: voci(18, 'a'), more: 0 },
    { gate: 'g2', gruppo: 'contenuto', label: 'Diff da leggere', voci: voci(83, 'b'), more: 0 },
  ];
  const page = await apri(openTab, [fb('due', 1680, { status: 'design', statusReason: 'l5' })],
    { pending: [richiesta('a'.repeat(24), 'due', 1680, blocks)] });
  await page.evaluate(() => window.__mgTest.openDetail('due'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 77 voci');
  await expect(go).toBeEnabled();
  await card.screenshot({ path: 'tests/.shots/v2250-chiuse.png' });
  await card.locator('.sn-mac-block[data-gate="g1"] .sn-mac-tutte').click();
  await expect(go).toHaveText('Apri le 71 voci');
  await go.scrollIntoViewIfNeeded();
  await go.click();
  await expect(go).toHaveText('Approva e fondi');
  await expect(card.locator('.sn-mac-block[data-gate="g2"] .sn-mac-voce').nth(12)).toBeInViewport();
  await page.screenshot({ path: 'tests/.shots/v2250-aperte.png' });
});

test('in volo poi errore del server: il tasto torna e il tempo si ferma', async ({ openTab }) => {
  const blocks = [{ gate: 'g1', gruppo: 'capacita', label: 'Avvia un programma', voci: voci(20, 'a'), more: 0 }];
  const page = await apri(openTab, [fb('err', 798, { status: 'design', statusReason: 'l5' })],
    { pending: [richiesta('b'.repeat(24), 'err', 798, blocks)] });
  await page.evaluate(() => window.__mgTest.openDetail('err'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 8 voci');
  await go.click();
  await expect(go).toHaveText('Approva e fondi');
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await expect(card.locator('.sn-mac-trascorso')).toHaveText(/^da \d+ s$/);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await card.screenshot({ path: 'tests/.shots/v2250-volo-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.evaluate(() => window.__risposte[0]({ ok: false, error: 'tests failed on merge' }));
  await expect(go).toHaveText('Approva e fondi');
  await expect(go).toBeEnabled();
  await expect(card.locator('.sn-mac-trascorso')).toHaveCount(0);
  await card.screenshot({ path: 'tests/.shots/v2250-errore.png' });
  console.log('STATO', await card.locator('.sn-mac-status').textContent());
});

test('Automazioni: elenco delle fusioni ferme, il tasto apre e porta in vista', async ({ openTab }) => {
  const blocks = [{ gate: 'g1', gruppo: 'capacita', label: 'Avvia un programma', voci: voci(85, 'a'), more: 0 }];
  const page = await apri(openTab, [], { pending: [richiesta('c'.repeat(24), 'orfana', 1867, blocks, { feedbackId: '', num: '' })] });
  const { apriScheda } = await import('../../helpers/gestione.mjs');
  await apriScheda(page, 'automation');
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  await expect(card).toBeVisible({ timeout: 8_000 });
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 73 voci');
  await go.scrollIntoViewIfNeeded();
  await go.click();
  await expect(go).toHaveText('Approva e fondi');
  await expect(card.locator('.sn-mac-voce').nth(12)).toBeInViewport();
  await go.scrollIntoViewIfNeeded();
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await expect(card.locator('.sn-mac-trascorso')).toBeInViewport();
  await page.screenshot({ path: 'tests/.shots/v2250-automazioni-volo.png' });
});
