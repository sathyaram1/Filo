// #497 — quarto giro: la sezione che si richiude da sola, e la frase scritta
// ma non salvata quando parte un'azione di stato.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

function fb(over) {
  return {
    _id: 'x', text: 'Il bottone non fa niente', name: 'Bottone morto',
    seq: 700, subSeq: 0, clientId: 'tester@example.com',
    createdAt: '2026-09-01T10:00:00Z', images: [],
    status: 'todo', statusPublic: 'open', notes: '', ...over,
  };
}
async function prepara(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
  });
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
}
async function apri(page, id, tab) {
  await page.evaluate(({ i, t }) => { window.__mgTest.setTab(t); window.__mgTest.openDetail(i); }, { i: id, t: tab });
  await expect(page.locator('#mgDetail')).toBeVisible();
}

test('#497 U — sezione aperta e non toccata: un aggiornamento remoto la richiude sotto le mani?', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 'u1', status: 'todo', userNote: 'frase salvata' })]);
  await apri(page, 'u1', 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNote')).toBeVisible();
  await page.locator('#mgThread').click({ position: { x: 5, y: 5 } });
  const rid = await page.evaluate(() => window.__mgTest.rerenderIfIdle('u1'));
  const aperta = await page.locator('#mgUserNote').isVisible();
  console.log('AGGIORNAMENTO REMOTO → ridisegnato:', rid, 'sezione ancora aperta:', aperta);
});

test('#497 V — frase scritta e non salvata + azione di stato: manage', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 'v1', status: 'done', statusPublic: 'closed' })]);
  await apri(page, 'v1', 'resolved');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Ora il bottone funziona.');
  await page.locator('#mgArchiveBtn').click();     // archivia senza premere "Salva la frase"
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThanOrEqual(1);
  const inviati = await page.evaluate(() => window.__updates.map((u) => ({ status: u.status, userNote: u.userNote })));
  console.log('MANAGE — cosa è partito:', JSON.stringify(inviati));
  const conFrase = inviati.some((u) => u.userNote === 'Ora il bottone funziona.');
  console.log('MANAGE — la frase è arrivata al destinatario?', conFrase);
});

test('#497 V bis — la stessa gesture sulla gemella (pagina Feedback)', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForFunction(() => window.__fbTest && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
  });
  await page.evaluate((l) => window.__fbTest.setData(l), [fb({ _id: 'w1', status: 'done', statusPublic: 'closed' })]);
  await page.evaluate(() => window.__fbTest.setTab('resolved'));
  await page.waitForTimeout(300);
  const campo = page.locator('.fb-usernote').first();
  if (await campo.count()) {
    await campo.fill('Ora il bottone funziona.');
    const arch = page.locator('.fb-act').filter({ hasText: 'Archivia' }).first();
    await arch.click();
    await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThanOrEqual(1);
    const inviati = await page.evaluate(() => window.__updates.map((u) => ({ status: u.status, userNote: u.userNote })));
    console.log('GEMELLA — cosa è partito:', JSON.stringify(inviati));
  } else {
    console.log('GEMELLA — nessuna casella frase in questa sezione');
  }
});

test('#497 W — Esc chiude la sezione appena aperta?', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 'x1', status: 'todo' })]);
  await apri(page, 'x1', 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.keyboard.press('Escape');
  console.log('DOPO ESC → aperta:', await page.locator('#mgUserNote').isVisible());
});
