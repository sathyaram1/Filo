// #1150 (SPEC-DOMANDE §2.2): i cinque pulsanti L1…L5 in testa ai Ricevuti. Acceso uno, solo quel livello; più
// accesi, l'unione; tutti spenti, tutto. Ognuno porta il suo numero, e la scheda e l'intestazione seguono il filtro.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const giudici = (cls) => ({
  action: 'human_review', l1Category: 'clean',
  expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
  verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: cls, reasoning: 'x' })),
});
const base = { clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x' };
const fb = (id, seq, nome, extra) => ({ ...base, _id: id, seq, name: nome, ...extra });
const CODA = [
  fb('l1a', 901, 'File sospetto', { status: 'suspicious_file' }),
  fb('l1b', 902, 'Attacco dal filtro', { status: 'attack', pipeline: { action: 'block_attack', l1Category: 'dangerous', verdicts: [] } }),
  fb('l2a', 903, 'Tutti d’accordo', { status: 'aligned', pipeline: giudici('aligned') }),
  fb('l3a', 904, 'Ha domande', { status: 'design', statusReason: 'clarify', pipeline: giudici('aligned') }),
  fb('l4a', 905, 'Bocciato dall’audit', { status: 'design', statusReason: 'secaudit', pipeline: giudici('aligned') }),
  fb('l5a', 906, 'Fermo alla fusione', { status: 'design', statusReason: 'l5', pipeline: giudici('aligned') }),
  fb('q1', 907, 'In coda', { status: 'todo', pipeline: giudici('aligned') }),
];

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((items) => window.__mgTest.setData(items), CODA);
}

const pulsante = (page, l) => page.locator(`#mgLivelliFiltro .mg-livello-btn[data-livello="${l}"]`);
const livelliInLista = (page) => page.locator('#mgList .mg-item .mg-segno-fermata')
  .evaluateAll((els) => els.map((e) => e.dataset.livello).sort());

test('ogni pulsante filtra il suo livello, più pulsanti l’unione, spenti tutto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);

  await expect(page.locator('#mgLivelliFiltro')).toBeVisible();
  const attesi = { l1: 'L1 (2)', l2: 'L2 (1)', l3: 'L3 (1)', l4: 'L4 (1)', l5: 'L5 (1)' };
  for (const [l, testo] of Object.entries(attesi)) await expect(pulsante(page, l), l).toHaveText(testo);
  expect(await livelliInLista(page)).toEqual(['l1', 'l1', 'l2', 'l3', 'l4', 'l5']);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (6)');

  await pulsante(page, 'l1').click();
  await expect(pulsante(page, 'l1')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => livelliInLista(page)).toEqual(['l1', 'l1']);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (2)');
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti (2)');
  // I numeri dei pulsanti e della sezione restano quelli a filtro spento.
  await expect(pulsante(page, 'l4')).toHaveText('L4 (1)');
  await expect(page.locator('.mg-sezione[data-sezione="feedback"] .mg-sezione-count')).toHaveText('(6)');

  await pulsante(page, 'l4').click();
  await expect.poll(() => livelliInLista(page)).toEqual(['l1', 'l1', 'l4']);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (3)');

  await pulsante(page, 'l1').click();
  await pulsante(page, 'l4').click();
  await expect.poll(() => livelliInLista(page)).toEqual(['l1', 'l1', 'l2', 'l3', 'l4', 'l5']);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (6)');
});

test('il filtro sta solo sui Ricevuti, nasconde le azioni in blocco su ciò che non si vede, e non si ricorda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);

  await expect(page.locator('#mgAlignedBar')).toBeVisible();
  await pulsante(page, 'l5').click();
  await expect(page.locator('#mgAlignedBar')).toBeHidden();
  await expect(page.locator('#mgListEmpty')).toBeHidden();

  await page.locator('.mg-tab[data-tab="queue"]').click();
  await expect(page.locator('#mgLivelliFiltro')).toBeHidden();
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(pulsante(page, 'l5')).toHaveAttribute('aria-pressed', 'true');

  // Un'apertura sui Ricevuti riparte a filtri spenti: un blocco nuovo non resta nascosto.
  expect((await page.evaluate(() => window.__mgTest.sceltaApertura())).motivo).toBe('ricevuti');
  expect(await page.evaluate(() => window.__mgTest.livelliFiltro())).toEqual([]);
  await expect(pulsante(page, 'l5')).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  expect(await page.evaluate(() => window.__mgTest.livelliFiltro())).toEqual([]);
});

test('aprire una pratica nascosta dal filtro la fa vedere', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.livelliFiltro(['l4']));
  await expect.poll(() => livelliInLista(page)).toEqual(['l4']);
  // Dalle Statistiche: «apri la segnalazione» porta alla scheda giusta, a filtro spento se serviva.
  await page.evaluate(() => window.__mgTest.apriSegnalazione('l1a'));
  expect(await page.evaluate(() => window.__mgTest.livelliFiltro())).toEqual([]);
  await expect(page.locator('#mgList .mg-item', { hasText: 'File sospetto' })).toBeVisible();
});
