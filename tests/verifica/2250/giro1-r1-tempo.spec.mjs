// Verifica #2250 giro 1, rilievo 1: il tempo dal sì deve vedersi dove l'owner ha appena cliccato.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const MIN = 60 * 1000;

const fb = (id, seq, extra = {}) => ({
  _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`, seq, subSeq: 0,
  clientId: 'tester@example.com', createdAt: '2026-09-12T10:00:00Z', images: [], statusPublic: 'open', ...extra,
});
const voci = (n, p) => Array.from({ length: n }, (_, i) => ({ file: `src/${p}${i}.js`, riga: i + 1, testo: `exec('${p}-${i}');` }));

test('r1 quadrato con un elenco lungo: approvato in fondo al pannello, la frase d’attesa col tempo trascorso si vede', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  const req = {
    id: 'a'.repeat(24), branch: 'claude/p1867', sha: 'a'.repeat(40), feedbackId: 'p1867', num: '1867', who: 'secaudit · notturna', origin: 'routine',
    blocks: [
      { gate: 'g1', gruppo: 'capacita', label: 'Avvia un programma', voci: voci(13, 'a'), more: 0 },
      { gate: 'g2', gruppo: 'contenuto', label: 'Diff da leggere', voci: voci(27, 'b'), more: 0 },
    ],
    createdAtMs: Date.now() - 5 * MIN, expiresAtMs: Date.now() + 24 * 60 * MIN,
  };
  await page.evaluate(({ docs, req }) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [req], failed: [], recent: [], preapproved: [] };
      if (t === 'merge_approval_approve') return new Promise(() => {});
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs: [fb('p1867', 1867, { status: 'design', statusReason: 'l5' })], req });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate(() => window.__mgTest.openDetail('p1867'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 16 voci');
  await go.click();
  await expect(go).toHaveText('Approva e fondi');
  // L'owner scorre il pannello fino in fondo, dove sta il tasto, e approva.
  await page.locator('#mgSideBody').evaluate((n) => {
    for (let e = n; e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 1) e.scrollTop = e.scrollHeight;
  });
  await expect(go).toBeInViewport();
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  const trascorso = card.locator('.sn-mac-trascorso');
  await expect(trascorso).toHaveText(/^da \d+ s$/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v2250-r1-tempo.png' });
  await expect(trascorso).toBeInViewport();
});
