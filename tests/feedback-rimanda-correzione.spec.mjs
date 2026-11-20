// #2575: nella pagina dei feedback «Rimanda in correzione» fa quello che fa in Gestione. Il primo clic apre la casella
// del testo per chi corregge con l'avviso armato; scritto il testo, il tasto lo manda; a casella vuota il secondo gesto
// manda lo stesso. In ogni caso il commento parte col suo testo: quello vecchio, con l'ora nuova, sembrerebbe la correzione.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

const BOCCIATA = {
  _id: 'fb-2338', seq: 2338, subSeq: 0, status: 'design', statusReason: 'secaudit', statusPublic: 'open', fiducia: 'fidato',
  name: 'Bocciato dal controllo', text: 'Il tasto salva nel posto sbagliato.', clientId: 'owner:test',
  createdAt: '2026-11-10T08:00:00Z', branch: 'worker/fb-2338',
  reviewDecision: 'accepted', reviewComment: 'Ok, procedi pure.', reviewedAt: '2026-11-10T09:00:00.000Z',
  livelli: { l4: { esito: 'fail', at: '2026-11-17T10:00:00.000Z' } },
};

async function apri(page, items) {
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

const aggiornamenti = (page) => page.evaluate(() => window.__updates);
const tastoDi = (page) => page.locator('.fb-act[data-id="fb-2338"][data-to="todo"]');

test('il primo clic apre la casella con l’avviso; scritto il testo (Invio va a capo), Ctrl+Invio lo manda a chi corregge', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await apri(page, [BOCCIATA]);
  const tasto = tastoDi(page);
  await expect(tasto).toHaveText('Rimanda in correzione');
  const prima = await tasto.boundingBox();
  await tasto.click();
  const casella = page.locator('.fb-correzione-text');
  await expect(casella).toBeFocused();
  await expect(casella).toHaveAttribute('placeholder', /non saprà cosa correggere/);
  await expect(tasto).toHaveText('Manda lo stesso');
  const armato = await tasto.boundingBox();
  expect([armato.x, armato.width >= prima.width - 0.5]).toEqual([prima.x, true]);
  expect(await aggiornamenti(page)).toEqual([]);
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/2575-feedback-correzione-${tema}.png` });
  }

  await page.keyboard.type('Niente host nuovi.');
  await expect(tasto).toHaveText('Rimanda in correzione');
  await expect(casella).toHaveAttribute('placeholder', /arriva a chi corregge/);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Tieni i dati in locale.');
  expect(await aggiornamenti(page)).toEqual([]);
  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => (await aggiornamenti(page)).length).toBe(1);
  expect((await aggiornamenti(page))[0]).toMatchObject({
    id: 'fb-2338', status: 'todo', reviewDecision: 'accepted', reviewComment: 'Niente host nuovi.\nTieni i dati in locale.',
  });
});

test('a casella vuota il secondo clic manda lo stesso, e il commento vecchio non riparte con l’ora nuova', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await apri(page, [BOCCIATA]);
  const tasto = tastoDi(page);
  await tasto.click();
  await expect(tasto).toHaveText('Manda lo stesso');
  await page.waitForTimeout(400);
  expect(await aggiornamenti(page)).toEqual([]);
  await tasto.click();
  await expect.poll(async () => (await aggiornamenti(page)).length).toBe(1);
  expect((await aggiornamenti(page))[0]).toMatchObject({ status: 'todo', reviewComment: '' });
});

test('sulle altre fermate «→ In coda» manda al primo clic, senza casella', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await apri(page, [Object.assign({}, BOCCIATA, { statusReason: 'clarify', livelli: {} })]);
  const tasto = tastoDi(page);
  await expect(tasto).toHaveText('→ In coda');
  await tasto.click();
  await expect.poll(async () => (await aggiornamenti(page)).length).toBe(1);
  await expect(page.locator('.fb-correzione-text')).toHaveCount(0);
});
