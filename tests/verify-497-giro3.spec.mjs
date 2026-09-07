// #497 — terzo giro: la bozza della frase e i cammini che la ributtano via.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

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

test('#497 R — riclicco la stessa segnalazione in lista: la bozza della frase sopravvive?', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 's1', status: 'todo', userNote: 'vecchia' })]);
  await apri(page, 's1', 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('bozza non ancora salvata');

  // stesso feedback, cliccato in lista (nessun cambio di selezione)
  await page.locator('#mgList .mg-item').first().click();
  const dopo = await page.locator('#mgUserNoteText').inputValue();
  const aperta = await page.locator('#mgUserNote').isVisible();
  console.log('DOPO IL RICLICK →', JSON.stringify(dopo), 'sezione aperta:', aperta);
  expect(dopo, 'la bozza della frase è stata buttata via da un clic sulla stessa scheda').toBe('bozza non ancora salvata');
});

test('#497 S — la stessa prova sulla nota di lavorazione (textarea): come si comporta la gemella nella stessa pagina', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 's2', status: 'done', statusPublic: 'closed' })]);
  await apri(page, 's2', 'resolved');
  await page.locator('#mgReopenBtn').click();
  await page.locator('#mgReopenText').fill('bozza di riapertura');
  await page.locator('#mgList .mg-item').first().click();
  const visibile = await page.locator('#mgReopen').isVisible();
  const testo = await page.locator('#mgReopenText').inputValue();
  console.log('RIAPERTURA DOPO RICLICK → visibile:', visibile, JSON.stringify(testo));
});

test('#497 T — cambio tab con una bozza aperta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 't1', status: 'todo' })]);
  await apri(page, 't1', 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('bozza');
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const v = await page.locator('#mgUserNoteText').inputValue();
  const vis = await page.locator('#mgDetail').isVisible();
  console.log('DOPO CAMBIO TAB → dettaglio visibile:', vis, JSON.stringify(v));
});
