import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const MIN = 60 * 1000;

function fb(id, seq, extra = {}) {
  return {
    _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`,
    seq, subSeq: 0, clientId: 'tester@example.com', createdAt: '2026-09-12T10:00:00Z',
    images: [], statusPublic: 'open', ...extra,
  };
}
const vociLunghe = (n, p) => Array.from({ length: n }, (_, i) => ({ file: `src/${p}${i}.js`, riga: i + 1, testo: `exec('${p}-${i}');` }));
function richiesta(id, feedbackId, num, extra = {}) {
  return {
    id, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: String(num),
    who: 'secaudit · notturna', origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'] }],
    createdAtMs: Date.now() - 5 * MIN, expiresAtMs: Date.now() + 24 * 60 * MIN, ...extra,
  };
}

async function apri(openTab, docs, liste, approva) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, liste, approva }) => {
    window.__liste = liste;
    window.__risolvi = null;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ...window.__liste };
      if (t === 'merge_approval_approve') {
        if (approva === 'manuale') return new Promise((r) => { window.__risolvi = r; });
        return approva;
      }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs, liste, approva });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

// #798: [0,0,0,0,73]
const blocchi798 = [
  { gate: 'g1', gruppo: 'guardie', label: 'Tocca aree protette', voci: vociLunghe(3, 'a'), more: 0 },
  { gate: 'g2', gruppo: 'capacita', label: 'Avvia', voci: vociLunghe(5, 'b'), more: 0 },
  { gate: 'g3', gruppo: 'capacita', label: 'Rete', voci: vociLunghe(2, 'c'), more: 0 },
  { gate: 'g4', gruppo: 'contenuto', label: 'Diff', voci: vociLunghe(12, 'd'), more: 0 },
  { gate: 'g5', gruppo: 'contenuto', label: 'Diff lungo', voci: vociLunghe(85, 'e'), more: 0 },
];

for (const tema of ['light', 'dark']) {
  test(`798 nel pannello, ${tema}: apri, approva, errore del server`, async ({ openTab }) => {
    const page = await apri(openTab, [fb('p798', 798, { status: 'design', statusReason: 'l5' })],
      { pending: [richiesta('b'.repeat(24), 'p798', 798, { blocks: blocchi798 })] }, 'manuale');
    await page.emulateMedia({ colorScheme: tema });
    await page.evaluate(() => window.__mgTest.openDetail('p798'));
    await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
    const card = page.locator('#mgSideBody .sn-mac-card');
    const go = card.locator('.sn-mac-btn-go');
    await expect(go).toHaveText('Apri le 73 voci');
    await expect(go).toBeEnabled();
    await go.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/.shots/v2250-798-chiuse-${tema}.png` });
    await go.click();
    const e = card.locator('.sn-mac-voce').filter({ hasText: 'src/e12.js' });
    await expect(e).toBeInViewport();
    await page.screenshot({ path: `tests/.shots/v2250-798-aperte-${tema}.png` });
    await expect(go).toHaveText('Approva e fondi');
    await go.scrollIntoViewIfNeeded();
    await go.click();
    await expect(go).toHaveText('Confermi?');
    await go.click();
    await expect(go).toHaveText('Sto fondendo');
    await expect(card.locator('.sn-mac-trascorso')).toBeInViewport();
    await expect(card.locator('.sn-mac-btn-quiet')).toBeDisabled();
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `tests/.shots/v2250-798-volo-${tema}.png` });
    // L'errore del server: il tasto torna a «Approva e fondi», l'orologio sparisce.
    await page.evaluate(() => window.__risolvi({ ok: false, error: 'unit rossi sulla fusione' }));
    await expect(go).toHaveText('Approva e fondi');
    await expect(go).toBeEnabled();
    await expect(card.locator('.sn-mac-trascorso')).toHaveCount(0);
    await page.screenshot({ path: `tests/.shots/v2250-798-errore-${tema}.png` });
    // Riprova subito: arma e parte, orologio da zero.
    await go.click();
    await go.click();
    await expect(go).toHaveText('Sto fondendo');
    await expect(card.locator('.sn-mac-trascorso')).toHaveText(/^da [0-2] s$/);
  });
}

test('Automazioni: due card, una in volo e l’altra con voci chiuse; rilettura a metà volo', async ({ openTab }) => {
  const page = await apri(openTab, [fb('x1', 1867, { status: 'design', statusReason: 'l5' }), fb('x2', 1685, { status: 'design', statusReason: 'l5' })], {
    pending: [
      richiesta('c'.repeat(24), 'x1', 1867, { blocks: [{ gate: 'g1', gruppo: 'capacita', label: 'A', voci: vociLunghe(13, 'p'), more: 0 }, { gate: 'g2', gruppo: 'contenuto', label: 'B', voci: vociLunghe(27, 'q'), more: 0 }] }),
      richiesta('d'.repeat(24), 'x2', 1685, { blocks: [{ gate: 'g1', gruppo: 'capacita', label: 'A', voci: vociLunghe(3, 'r'), more: 0 }, { gate: 'g2', gruppo: 'contenuto', label: 'B', voci: vociLunghe(16, 's'), more: 0 }] }),
    ],
  }, 'manuale');
  await apriScheda(page, 'automation');
  const cards = page.locator('#mgMergeApprovalsOrphans .sn-mac-card, .sn-mac-card');
  const c1 = page.locator('.sn-mac-card[data-request-id="' + 'c'.repeat(24) + '"]').first();
  const c2 = page.locator('.sn-mac-card[data-request-id="' + 'd'.repeat(24) + '"]').first();
  await expect(c1.locator('.sn-mac-btn-go')).toHaveText('Apri le 16 voci', { timeout: 8000 });
  await expect(c2.locator('.sn-mac-btn-go')).toHaveText('Apri le 4 voci');
  await c1.locator('.sn-mac-btn-go').click();
  await c1.locator('.sn-mac-btn-go').scrollIntoViewIfNeeded();
  await c1.locator('.sn-mac-btn-go').click();
  await c1.locator('.sn-mac-btn-go').click();
  await expect(c1.locator('.sn-mac-btn-go')).toHaveText('Sto fondendo');
  // L'altra resta da aprire, accesa.
  await expect(c2.locator('.sn-mac-btn-go')).toHaveText('Apri le 4 voci');
  await expect(c2.locator('.sn-mac-btn-go')).toBeEnabled();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.waitForTimeout(1500);
  await expect(c1.locator('.sn-mac-btn-go')).toHaveText('Sto fondendo');
  const t = await c1.locator('.sn-mac-trascorso').textContent();
  expect(Number(t.match(/\d+/)[0])).toBeGreaterThanOrEqual(3);
  await c2.locator('.sn-mac-btn-go').click();
  await expect(c2.locator('.sn-mac-btn-go')).toHaveText('Approva e fondi');
  await page.screenshot({ path: 'tests/.shots/v2250-automazioni.png', fullPage: true });
  expect(await cards.count()).toBeGreaterThan(0);
});
