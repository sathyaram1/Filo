// Verifica #2575 giro 2: esplorazione di Gestione e pagina dei feedback su «Rimanda in correzione».

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK_URL = 'filo://feedback/feedback.html';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-2338', name: 'Bocciato dal controllo', text: 'Il tasto salva nel posto sbagliato.',
    seq: 2338, subSeq: 0, status: 'design', statusReason: 'secaudit', statusPublic: 'open', fiducia: 'fidato',
    clientId: 'owner:test', createdAt: '2026-11-10T08:00:00Z', images: [], branch: 'worker/fb-2338',
    notes: "Report: fatto.\n\n--- Aggiornamento dell'agente del 17/11/26, 10:00 ---\nIl diff manda i dati a un host nuovo.",
    reviewDecision: 'accepted', reviewComment: 'Ok, procedi pure.', reviewedAt: '2026-11-10T09:00:00.000Z',
    livelli: { l4: { esito: 'fail', at: '2026-11-17T10:00:00.000Z' } },
  }, over);
}

async function apri(page, lista) {
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
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate((id) => window.__mgTest.openDetail(id), lista[0]._id);
}
const agg = (page) => page.evaluate(() => window.__updates);

test('gestione: soli spazi valgono come casella vuota', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()]);
  await expect(page.locator('#mgAcceptComment')).toHaveValue('');
  await page.locator('#mgAcceptComment').fill('    \n  ');
  await page.locator('#mgAcceptBtn').click();
  await expect(page.locator('#mgAcceptBtn')).toHaveText('Manda lo stesso');
  expect(await agg(page)).toEqual([]);
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/verifica-2575-g2-avviso-${tema}.png` });
  }
});

test('gestione: Cmd+Invio manda come Ctrl+Invio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()]);
  await page.locator('#mgAcceptComment').click();
  await page.keyboard.type('Niente host nuovi.');
  await page.keyboard.press('Meta+Enter');
  await expect.poll(async () => (await agg(page)).length).toBe(1);
  expect((await agg(page))[0]).toMatchObject({ status: 'todo', reviewComment: 'Niente host nuovi.' });
});

test('gestione: doppio clic a casella vuota non manda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()]);
  await page.locator('#mgAcceptBtn').dblclick();
  await page.waitForTimeout(500);
  expect(await agg(page)).toEqual([]);
});

test('gestione: armato su una pratica, passare a un altra disarma', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica(), pratica({ _id: 'fb-1918', seq: 1918, name: 'Altro bocciato' })]);
  await page.locator('#mgAcceptBtn').click();
  await expect(page.locator('#mgAcceptBtn')).toHaveText('Manda lo stesso');
  await page.evaluate(() => window.__mgTest.openDetail('fb-1918'));
  await expect(page.locator('#mgAcceptBtn')).toHaveText('Rimanda in correzione');
  await page.locator('#mgAcceptBtn').click();
  await page.waitForTimeout(400);
  expect(await agg(page)).toEqual([]);
});

test('pagina feedback: aspetto e testo che arriva', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await page.waitForFunction(() => Boolean(window.__fbTest), null, { timeout: 10_000 });
  await page.evaluate(() => window.__fbTest.whenReady());
  await page.evaluate((list) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
    window.__fbTest.setData(list);
    window.__fbTest.setTab('inbox');
  }, [pratica()]);
  await page.waitForFunction(() => document.querySelectorAll('.fb-card').length > 0, null, { timeout: 10_000 });
  const tasto = page.locator('.fb-act[data-id="fb-2338"][data-to="todo"]');
  await tasto.click();
  await page.waitForTimeout(300);
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/verifica-2575-g2-feedback-${tema}.png` });
  }
  const box = page.locator('.fb-correzione-text');
  await box.fill('Usa la coda che c’è già.');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  if (!(await agg(page)).length) await tasto.click();
  await expect.poll(async () => (await agg(page)).length).toBe(1);
  expect((await agg(page))[0]).toMatchObject({ status: 'todo', reviewComment: 'Usa la coda che c’è già.' });
});
