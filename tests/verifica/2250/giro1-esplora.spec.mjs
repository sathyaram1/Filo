// Verifica #2250, giro 1: il tasto della fusione nel quadrato della pratica, coi blocchi delle schede segnalate.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const MIN = 60 * 1000;

function fb(id, seq, extra = {}) {
  return {
    _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`,
    seq, subSeq: 0, clientId: 'tester@example.com', createdAt: '2026-11-06T10:00:00Z',
    images: [], statusPublic: 'open', branch: `claude/${id}`, ...extra,
  };
}
const voci = (n, p) => Array.from({ length: n }, (_, i) => ({ file: `src/main/${p}${i}.js`, riga: 1 + i, testo: `exec('${p}-${i}');`, url: '' }));
function richiesta(id, feedbackId, num, blocks) {
  return {
    id, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: String(num),
    who: 'verifier · giro', origin: 'routine', blocks,
    createdAtMs: Date.now() - 5 * MIN, expiresAtMs: Date.now() + 24 * 60 * MIN,
  };
}

async function apri(openTab, docs, liste, { scuro = false } = {}) {
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

async function quadrato(page, id) {
  await page.evaluate((id) => window.__mgTest.openDetail(id), id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const card = page.locator('#mgSideBody .sn-mac-card');
  await expect(card).toBeVisible({ timeout: 8_000 });
  return card;
}

// #798: quattro blocchi corti e uno da 85 voci (73 nascoste).
test('scheda come #798: «Apri le 73 voci» acceso, apre tutto e porta in vista la prima aperta, poi approva', async ({ openTab }) => {
  const blocks = [
    { gate: 'guard_the_guards', gruppo: 'guardie', label: 'Tocca aree protette', voci: voci(3, 'g') },
    { gate: 'child_process', gruppo: 'capacita', label: 'Avvia un programma esterno', voci: voci(5, 'c') },
    { gate: 'network', gruppo: 'capacita', label: 'Parla con la rete', voci: voci(12, 'n') },
    { gate: 'fs', gruppo: 'capacita', label: 'Scrive su disco', voci: voci(2, 'f') },
    { gate: 'diff_integrity', gruppo: 'contenuto', label: 'Diff da guardare', voci: voci(85, 'd') },
  ];
  const page = await apri(openTab, [fb('f798', 798, { status: 'design', statusReason: 'l5' })],
    { pending: [richiesta('7'.repeat(24), 'f798', 798, blocks)] });
  const card = await quadrato(page, 'f798');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 73 voci');
  await expect(go).toBeEnabled();
  await card.screenshot({ path: 'tests/.shots/verifica-2250-chiuse.png' }).catch(() => {});
  await go.click();
  const d = card.locator('.sn-mac-gruppo[data-gruppo="contenuto"] .sn-mac-voce');
  await expect(d.nth(84)).toBeVisible();
  await expect(d.nth(12)).toBeInViewport();
  await expect(go).toHaveText('Approva e fondi');
  await expect(go).toBeEnabled();
  await go.click();
  await expect(go).toHaveText('Confermi?');
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await expect(go).toHaveClass(/is-fondendo/);
  const t = card.locator('.sn-mac-status .sn-mac-trascorso');
  await expect(t).toHaveText(/^da \d+ s$/);
  await expect(go).toBeInViewport();
});

// #1867: due blocchi, 1 e 15 nascoste. In volo, la pratica riaperta conta dal clic e non da zero.
test('scheda come #1867: «Apri le 16 voci»; in volo, richiusa e riaperta, il tempo conta dal clic', async ({ openTab }) => {
  const blocks = [
    { gate: 'guard_the_guards', gruppo: 'guardie', label: 'Tocca aree protette', voci: voci(13, 'g') },
    { gate: 'child_process', gruppo: 'capacita', label: 'Avvia un programma esterno', voci: voci(27, 'c') },
  ];
  const page = await apri(openTab, [fb('f1867', 1867, { status: 'design', statusReason: 'l5' }), fb('altro', 1900, { status: 'new' })],
    { pending: [richiesta('8'.repeat(24), 'f1867', 1867, blocks)] });
  const card = await quadrato(page, 'f1867');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 16 voci');
  await go.click();
  await expect(card.locator('.sn-mac-voce')).toHaveCount(40);
  for (const i of [12, 39]) await expect(card.locator('.sn-mac-voce').nth(i)).toBeVisible();
  await expect(card.locator('.sn-mac-gruppo[data-gruppo="guardie"] .sn-mac-voce').nth(12)).toBeInViewport();
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await page.waitForTimeout(3_500);
  await page.evaluate(() => window.__mgTest.openDetail('altro'));
  const card2 = await quadrato(page, 'f1867');
  await expect(card2.locator('.sn-mac-btn-go')).toHaveText('Sto fondendo');
  const testo = await card2.locator('.sn-mac-status .sn-mac-trascorso').textContent();
  expect(Number((testo || '').match(/\d+/)?.[0])).toBeGreaterThanOrEqual(3);
});

test('tema scuro: in volo rotella visibile sul tasto e tempo leggibile', async ({ openTab }) => {
  const blocks = [{ gate: 'child_process', gruppo: 'capacita', label: 'Avvia un programma esterno', voci: voci(20, 'c') }];
  const page = await apri(openTab, [fb('f1685', 1685, { status: 'design', statusReason: 'l5' })],
    { pending: [richiesta('9'.repeat(24), 'f1685', 1685, blocks)] }, { scuro: true });
  const card = await quadrato(page, 'f1685');
  const go = card.locator('.sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 8 voci');
  await card.screenshot({ path: 'tests/.shots/verifica-2250-chiuse-scuro.png' }).catch(() => {});
  await go.click();
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  await page.waitForTimeout(1_500);
  await card.screenshot({ path: 'tests/.shots/verifica-2250-volo-scuro.png' }).catch(() => {});
  const s = await go.evaluate((b) => {
    const p = getComputedStyle(b, '::before');
    return { anim: p.animationName, w: p.width, colore: p.borderTopColor, fondo: getComputedStyle(b.closest('.sn-mac-card')).backgroundColor };
  });
  expect(s.anim).toBe('sn-mac-gira');
  expect(s.colore).not.toBe(s.fondo);
});
