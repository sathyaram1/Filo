// Verifica #2250 giro 2: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const MIN = 60 * 1000;

const fb = (id, seq, extra = {}) => ({
  _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`, seq, subSeq: 0,
  clientId: 'tester@example.com', createdAt: '2026-09-12T10:00:00Z', images: [], statusPublic: 'open', ...extra,
});
const voci = (n, p) => Array.from({ length: n }, (_, i) => ({ file: `src/${p}${i}.js`, riga: i + 1, testo: `exec('${p}-${i}');` }));

async function apri(openTab, blocks, { approva = 'mai', dark = false } = {}) {
  const page = await openTab(URL);
  if (dark) await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  const req = {
    id: 'a'.repeat(24), branch: 'claude/p798', sha: 'a'.repeat(40), feedbackId: 'p798', num: '798', who: 'secaudit · notturna', origin: 'routine',
    blocks, createdAtMs: Date.now() - 5 * MIN, expiresAtMs: Date.now() + 24 * 60 * MIN,
  };
  await page.evaluate(({ docs, req, approva }) => {
    const orig = window.filo.message.bind(window.filo);
    window.__chiamate = [];
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [req], failed: [], recent: [], preapproved: [] };
      if (t === 'merge_approval_approve') {
        window.__chiamate.push(msg);
        if (approva === 'mai') return new Promise(() => {});
        if (approva === 'errore') return new Promise((r) => setTimeout(() => r({ ok: false, error: 'Gli unit sulla fusione sono rossi.' }), 2500));
        return approva;
      }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs: [fb('p798', 798, { status: 'design', statusReason: 'l5' })], req, approva });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate(() => window.__mgTest.openDetail('p798'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  return page;
}

const FORMA_798 = () => [
  { gate: 'g1', gruppo: 'guardie', label: 'Tocca aree protette', voci: voci(3, 'a'), more: 0 },
  { gate: 'g2', gruppo: 'capacita', label: 'Avvia un programma', voci: voci(5, 'b'), more: 0 },
  { gate: 'g3', gruppo: 'capacita', label: 'Rete', voci: voci(12, 'c'), more: 0 },
  { gate: 'g4', gruppo: 'capacita', label: 'File', voci: voci(2, 'd'), more: 0 },
  { gate: 'g5', gruppo: 'contenuto', label: 'Diff da leggere', voci: voci(85, 'e'), more: 0 },
];

test('giro1 r1 ri-provato: approvata in fondo a un elenco lungo, il tempo si vede', async ({ openTab }) => {
  const page = await apri(openTab, [
    { gate: 'g1', gruppo: 'capacita', label: 'Avvia un programma', voci: voci(13, 'a'), more: 0 },
    { gate: 'g2', gruppo: 'contenuto', label: 'Diff da leggere', voci: voci(27, 'b'), more: 0 },
  ]);
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 16 voci');
  await go.click();
  await expect(go).toHaveText('Approva e fondi');
  await page.locator('#mgSideBody').evaluate((n) => {
    for (let e = n; e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 1) e.scrollTop = e.scrollHeight;
  });
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  const trascorso = card.locator('.sn-mac-trascorso');
  await expect(trascorso).toHaveText(/^da \d+ s$/);
  await expect(trascorso).toBeInViewport();
});

test('forma di #798: 73 voci chiuse nell’ultimo blocco', async ({ openTab }) => {
  const page = await apri(openTab, FORMA_798());
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 73 voci');
  await expect(go).toBeEnabled();
  await expect(card.getByText('Apri tutte le voci per approvare')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/v2250-g2-chiuse.png' });
  await go.scrollIntoViewIfNeeded();
  await go.click();
  const ultime = card.locator('.sn-mac-gruppo[data-gruppo="contenuto"] .sn-mac-voce');
  await expect(ultime.nth(12)).toBeInViewport();
  await expect(go).toHaveText('Approva e fondi');
  await page.screenshot({ path: 'tests/.shots/v2250-g2-aperte.png' });
  // Ridisegno del pannello (rilettura delle fusioni): le voci restano aperte.
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(card.locator('.sn-mac-btn-go')).toHaveText('Approva e fondi');
});

test('tastiera: Invio apre, poi arma, poi manda', async ({ openTab }) => {
  const page = await apri(openTab, FORMA_798());
  const go = page.locator('#mgSideBody .sn-mac-card .sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 73 voci');
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(go).toHaveText('Approva e fondi');
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(go).toHaveText('Confermi?');
  await page.keyboard.press('Enter');
  await expect(go).toHaveText('Sto fondendo');
  expect(await page.evaluate(() => window.__chiamate.length)).toBe(1);
});

test('in volo, tema scuro: aspetto', async ({ openTab }) => {
  const page = await apri(openTab, [{ gate: 'g1', gruppo: 'capacita', label: 'Avvia un programma', voci: voci(20, 'a'), more: 0 }], { dark: true });
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 8 voci');
  await card.screenshot({ path: 'tests/.shots/v2250-g2-scuro-chiuse.png' });
  await go.click();
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await page.waitForTimeout(2200);
  await card.screenshot({ path: 'tests/.shots/v2250-g2-scuro-volo.png' });
});

test('in volo poi errore: il tasto torna, il tempo sparisce, l’errore si legge', async ({ openTab }) => {
  const page = await apri(openTab, [{ gate: 'g1', gruppo: 'capacita', label: 'Avvia un programma', voci: voci(3, 'a'), more: 0 }], { approva: 'errore' });
  const card = page.locator('#mgSideBody .sn-mac-card');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Approva e fondi');
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await expect(card.locator('.sn-mac-trascorso')).toBeVisible();
  await expect(go).toHaveText('Approva e fondi', { timeout: 6000 });
  await expect(go).toBeEnabled();
  await expect(card.locator('.sn-mac-trascorso')).toHaveCount(0);
  await expect(card.locator('.sn-mac-status')).toContainText(/rossi|non/);
  await card.screenshot({ path: 'tests/.shots/v2250-g2-errore.png' });
});
