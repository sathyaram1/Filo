// Verifica #2575 giro 1, rilievo 2: sulla pagina dei feedback la stessa bocciatura offre «Rimanda in correzione», ma
// il tasto manda alla cieca: niente avviso a testo mancante, e il commento vecchio (scritto prima della bocciatura)
// resta con un'ora nuova, così a chi corregge arriva come se fosse la correzione.

import { test, expect } from '../../fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

const BOCCIATA = {
  _id: 'fb-2338', seq: 2338, subSeq: 0, status: 'design', statusReason: 'secaudit', statusPublic: 'open', fiducia: 'fidato',
  name: 'Bocciato dal controllo', text: 'Il tasto salva nel posto sbagliato.', clientId: 'owner:test',
  createdAt: '2026-11-10T08:00:00Z', branch: 'worker/fb-2338',
  reviewDecision: 'accepted', reviewComment: 'Ok, procedi pure.', reviewedAt: '2026-11-10T09:00:00.000Z',
  livelli: { l4: { esito: 'fail', at: '2026-11-17T10:00:00.000Z' } },
};

async function setupAdmin(page, items) {
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
  }, items);
  await page.waitForFunction(() => document.querySelectorAll('.fb-card').length > 0, null, { timeout: 10_000 });
}

test('r1 il primo clic su «Rimanda in correzione» senza testo non manda alla cieca, come in Gestione', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, [BOCCIATA]);
  const tasto = page.locator('.fb-act[data-id="fb-2338"][data-to="todo"]');
  await expect(tasto).toHaveText('Rimanda in correzione');
  await page.screenshot({ path: 'tests/.shots/verifica-2575-pagina-feedback.png' });
  await tasto.click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__updates)).toEqual([]);
});

test('r1 rimandata in correzione, il commento scritto prima della bocciatura non torna valido con un\'ora nuova', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, [BOCCIATA]);
  const tasto = page.locator('.fb-act[data-id="fb-2338"][data-to="todo"]');
  await tasto.click();
  await page.waitForTimeout(400);
  if (!(await page.evaluate(() => window.__updates.length))) {
    await tasto.click();
  }
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const u = (await page.evaluate(() => window.__updates))[0];
  expect(u.status).toBe('todo');
  // Un'ora nuova porta con sé il testo di adesso: senza, il commento del 10/11 arriva a chi corregge come correzione.
  if (u.reviewedAt) expect(u).toHaveProperty('reviewComment');
  expect(u.reviewComment || '').not.toBe('Ok, procedi pure.');
});
