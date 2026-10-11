// #603 (D93): nei Ricevuti il motivo non vive più nel solo colore del bordo. Accanto al titolo c'è la forma del
// livello che ha fermato la pratica (la stessa della fila nel dettaglio), col motivo in parole sotto il puntatore;
// il segno di una domanda sparisce quando la risposta parte. Stessa regola nella pagina dei feedback.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

const giudici = (cls) => ({
  action: 'human_review', l1Category: 'clean',
  expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
  verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: cls, reasoning: 'x' })),
});
const base = { clientId: 'tester@example.com', createdAt: '2026-09-11T08:00:00Z', images: [], subSeq: 0 };
const SICUREZZA = { ...base, _id: 'fb-sic', seq: 801, name: 'Pronto ma bloccato', text: 'a', status: 'design', statusReason: 'secaudit', pipeline: giudici('aligned') };
const ATTACCO = { ...base, _id: 'fb-att', seq: 802, name: 'Attacco dai giudici', text: 'b', status: 'attack', pipeline: giudici('attack') };
const FILTRO = { ...base, _id: 'fb-fil', seq: 803, name: 'Attacco dal filtro', text: 'c', status: 'attack', pipeline: { action: 'block_attack', l1Category: 'dangerous', verdicts: [] } };
const DOMANDA = { ...base, _id: 'fb-dom', seq: 804, name: 'Ha domande', text: 'd', status: 'design', statusReason: 'clarify', pipeline: giudici('aligned'), notes: 'Report.\n\n[Filo]\nQuale colore preferisci?' };
const ALLINEATO = { ...base, _id: 'fb-all', seq: 805, name: 'Tutti d’accordo', text: 'e', status: 'aligned', pipeline: giudici('aligned') };

async function apri(page, feedbacks) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

const segno = (page, titolo) => page.locator('.mg-item', { hasText: titolo }).locator('.mg-segno-fermata');

test('«bloccato dalla sicurezza» e «attacco»: stesso rosso, forma diversa, motivo in parole', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [SICUREZZA, ATTACCO, FILTRO, DOMANDA, ALLINEATO]);

  const bordo = (t) => page.locator('.mg-item', { hasText: t }).evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(await bordo('Pronto ma bloccato')).toBe(await bordo('Attacco dai giudici'));

  await expect(segno(page, 'Pronto ma bloccato')).toHaveAttribute('data-forma', 'pentagono');
  await expect(segno(page, 'Attacco dai giudici')).toHaveAttribute('data-forma', 'cerchio');
  await expect(segno(page, 'Attacco dal filtro')).toHaveAttribute('data-forma', 'triangolo');
  await expect(segno(page, 'Ha domande')).toHaveAttribute('data-forma', 'rombo');
  await expect(segno(page, 'Tutti d’accordo')).toHaveAttribute('data-forma', 'cerchio');
  expect(await segno(page, 'Pronto ma bloccato').getAttribute('title')).toMatch(/sicurezza/i);
  expect(await segno(page, 'Attacco dai giudici').getAttribute('title')).toMatch(/giudici.*attacco/i);

  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    const misure = await page.locator('.mg-segno-fermata').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { w: r.width, h: r.height, c: getComputedStyle(e).color };
    }));
    expect(misure.length).toBe(5);
    for (const m of misure) { expect(m.w).toBeGreaterThan(8); expect(m.c).not.toBe('rgba(0, 0, 0, 0)'); }
    await page.locator('#mgList').screenshot({ path: `tests/.shots/segno-fermata-${tema}.png` });
  }
});

test('il segno di una domanda sparisce quando la risposta parte', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [DOMANDA, ATTACCO]);
  await expect(segno(page, 'Ha domande')).toHaveAttribute('data-forma', 'rombo');

  await page.evaluate((id) => window.__mgTest.openDetail(id), DOMANDA._id);
  await page.fill('#mgClarifyText', 'Il blu.');
  await page.click('#mgClarifyBtn');
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  await expect(page.locator('.mg-segno-fermata[data-forma="rombo"]')).toHaveCount(0);
  await expect(segno(page, 'Attacco dai giudici')).toHaveAttribute('data-forma', 'cerchio');
});

test('pagina dei feedback: stessa forma accanto al titolo, col motivo sotto il puntatore', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__fbTest.setAdmin(true));
  await page.evaluate((fbs) => window.__fbTest.setData(fbs), [SICUREZZA, ATTACCO]);
  await page.evaluate(() => window.__fbTest.setTab('inbox'));
  const titolo = (t) => page.locator('.fb-card', { hasText: t }).locator('.fb-title .fb-segno');
  await expect(titolo('Pronto ma bloccato')).toHaveAttribute('data-forma', 'pentagono');
  await expect(titolo('Attacco dai giudici')).toHaveAttribute('data-forma', 'cerchio');
  expect(await titolo('Pronto ma bloccato').getAttribute('title')).toMatch(/sicurezza/i);
  await page.locator('.fb-card').first().screenshot({ path: 'tests/.shots/segno-fermata-feedback.png' });
});
