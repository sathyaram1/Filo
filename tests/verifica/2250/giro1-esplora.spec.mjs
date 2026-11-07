// Verifica #2250 giro 1: esplorazione sul quadrato della pratica (la superficie della segnalazione).
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const MIN = 60 * 1000;

const fb = (id, seq, extra = {}) => ({
  _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`, seq, subSeq: 0,
  clientId: 'tester@example.com', createdAt: '2026-09-12T10:00:00Z', images: [], statusPublic: 'open', ...extra,
});
const voci = (n, p) => Array.from({ length: n }, (_, i) => ({ file: `src/${p}${i}.js`, riga: i + 1, testo: `exec('${p}-${i}');` }));
const richiesta = (id, feedbackId, num, blocks) => ({
  id, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: String(num), who: 'secaudit · notturna', origin: 'routine',
  blocks, createdAtMs: Date.now() - 5 * MIN, expiresAtMs: Date.now() + 24 * 60 * MIN,
});

async function apri(openTab, docs, liste, scuro) {
  const page = await openTab(URL);
  if (scuro) await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, liste }) => {
    window.__liste = liste;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ...window.__liste };
      if (t === 'merge_approval_approve') return new Promise(() => {});
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs, liste });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

for (const scuro of [false, true]) {
  test(`quadrato della pratica ${scuro ? 'scuro' : 'chiaro'}: 73 voci chiuse nel quinto blocco, apri, approva, in volo`, async ({ openTab }) => {
    const blocks = [
      { gate: 'g1', gruppo: 'guardie', label: 'Tocca aree protette', voci: voci(3, 'a'), more: 0 },
      { gate: 'g2', gruppo: 'capacita', label: 'Avvia un programma', voci: voci(5, 'b'), more: 0 },
      { gate: 'g3', gruppo: 'capacita', label: 'Rete', voci: voci(12, 'c'), more: 0 },
      { gate: 'g4', gruppo: 'capacita', label: 'File', voci: voci(1, 'd'), more: 0 },
      { gate: 'g5', gruppo: 'contenuto', label: 'Diff da leggere', voci: voci(85, 'e'), more: 0 },
    ];
    const page = await apri(openTab, [fb('p798', 798, { status: 'design', statusReason: 'l5' })], { pending: [richiesta('a'.repeat(24), 'p798', 798, blocks)] }, scuro);
    await page.evaluate(() => window.__mgTest.openDetail('p798'));
    await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
    const card = page.locator('#mgSideBody .sn-mac-card');
    const go = card.locator('.sn-mac-btn-go');
    await expect(go).toHaveText('Apri le 73 voci');
    await expect(go).toBeEnabled();
    await go.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/.shots/v2250-chiuse-${scuro ? 'scuro' : 'chiaro'}.png` });
    await go.click();
    const e = card.locator('.sn-mac-gruppo[data-gruppo="contenuto"] .sn-mac-voce');
    await expect(e.nth(84)).toBeAttached();
    for (const i of [12, 50, 84]) await expect(e.nth(i)).toBeVisible();
    await expect(e.nth(12)).toBeInViewport();
    await expect(go).toHaveText('Approva e fondi');
    await expect(go).toBeEnabled();
    await go.scrollIntoViewIfNeeded();
    await go.click();
    await expect(go).toHaveText('Confermi?');
    await go.click();
    await expect(go).toHaveText('Sto fondendo');
    const t = card.locator('.sn-mac-trascorso');
    await expect(t).toHaveText(/^da \d+ s$/);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `tests/.shots/v2250-volo-${scuro ? 'scuro' : 'chiaro'}.png` });
    // Il pannello chiuso e riaperto a metà volo: il tempo continua dal sì, non riparte da zero.
    const prima = Number((await t.textContent()).match(/\d+/)[0]);
    await page.evaluate(() => window.__mgTest.openDetail('p798'));
    await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
    const go2 = page.locator('#mgSideBody .sn-mac-card .sn-mac-btn-go');
    await expect(go2).toHaveText('Sto fondendo');
    const dopo = Number((await page.locator('#mgSideBody .sn-mac-card .sn-mac-trascorso').textContent()).match(/\d+/)[0]);
    expect(dopo).toBeGreaterThanOrEqual(prima);
  });
}
