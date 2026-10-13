// #1060 giro 1: «Richiede lavoro locale» si riconosce dal rombo azzurro, in lista e nella fila, anche fuori dal caso felice.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const AZZURRO = 'rgb(38, 201, 252)';

const giudici = (cls) => ({
  action: 'human_review', l1Category: 'clean',
  expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
  verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: cls, reasoning: 'x' })),
});
const base = { clientId: 'local:claude', createdAt: '2026-09-28T08:00:00Z', images: [], subSeq: 0, status: 'design', statusReason: 'locale', pipeline: giudici('aligned') };
const NOTE = "Report.\n\n--- Aggiornamento dell'agente del 06/10/26, 03:58 ---\nRichiede lavoro locale. openrouter.ai è bloccato dalla rete del contenitore.";

async function apri(page, feedbacks) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}
const colore = (loc) => loc.evaluate((el) => getComputedStyle(el).color);

test('casi diversi: nota con segnalazione L3, senza note, utente non fidato, titolo lunghissimo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lungo = 'Titolo '.repeat(80) + '<b>x</b> 💻';
  const fbs = [
    { ...base, _id: 'a', seq: 901, name: 'Con segnalazione', text: 'a', notes: NOTE, livelli: { l3: { esito: 'segnalato', testo: 'Il primo passo va fatto a mano.' } } },
    { ...base, _id: 'b', seq: 902, name: 'Senza note', text: 'b' },
    { ...base, _id: 'c', seq: 903, name: 'Di un utente', text: 'c', clientId: 'utente@example.com', notes: NOTE },
    { ...base, _id: 'd', seq: 904, name: lungo, text: 'd', notes: NOTE },
  ];
  await apri(page, fbs);
  for (const fb of fbs) {
    const s = page.locator(`.mg-item[data-id="${fb._id}"] .mg-segno-fermata, .mg-item:has-text("${fb.name.slice(0, 12)}") .mg-segno-fermata`).first();
    await expect(s).toHaveAttribute('data-forma', 'rombo');
    expect(await colore(s)).toBe(AZZURRO);
    const box = await s.boundingBox();
    expect(box.width).toBeGreaterThan(8);
    await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
    const rombo = page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]');
    await expect(rombo).toHaveClass(/mg-forma--locale/);
    expect(await colore(rombo)).toBe(AZZURRO);
    await rombo.click();
    await expect(page.locator('#mgSideTitle')).toHaveText('Richiede lavoro locale');
    const testo = await page.locator('#mgSideBody').innerText();
    console.log(fb._id, '→', JSON.stringify(testo.slice(0, 400)));
    await page.locator('#mgDetail, #mgMain, body').first().screenshot({ path: `tests/.shots/v1060-${fb._id}.png` });
  }
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/v1060-pagina-${tema}.png` });
  }
});

test('documento ancora in proiezione di lista: rombo azzurro subito, poi il dettaglio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [{ ...base, _id: 'p', seq: 905, name: 'Solo lista', text: 'p', _proiezione: true }]);
  const s = page.locator('.mg-segno-fermata').first();
  await expect(s).toHaveAttribute('data-forma', 'rombo');
  expect(await colore(s)).toBe(AZZURRO);
  await page.evaluate(() => window.__mgTest.openDetail('p'));
  const rombo = page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]');
  await expect(rombo).toHaveClass(/mg-forma--locale/);
  expect(await colore(rombo)).toBe(AZZURRO);
  await rombo.click();
  console.log('proiezione →', JSON.stringify((await page.locator('#mgSideBody').innerText()).slice(0, 300)));
});
