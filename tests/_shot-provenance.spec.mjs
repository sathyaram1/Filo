// Temporaneo: cattura visiva delle icone di provenienza (#443). Da cancellare.
import { test } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const FBS = [
  { _id: 'A', seq: 10, subSeq: 0, priority: 0, name: 'Scritto dall’owner',            clientId: 'owner:me',         createdAt: '2026-08-05T09:00:00Z' },
  { _id: 'B', seq: 11, subSeq: 0, priority: 0, name: 'Scritto da un utente',          clientId: 'caf22093-aaaa',    createdAt: '2026-08-05T10:00:00Z' },
  { _id: 'F', seq: 12, subSeq: 0, priority: 0, name: 'Filo, per conto di un utente',  clientId: 'filo:chat',        createdAt: '2026-08-05T11:00:00Z' },
  { _id: 'P', seq: 13, subSeq: 0, priority: 0, name: 'Trovato esplorando l’app',      clientId: 'routine:prober',   createdAt: '2026-08-05T12:00:00Z' },
  { _id: 'W', seq: 14, subSeq: 0, priority: 0, name: 'Emerso implementando',          clientId: 'routine:new-work', createdAt: '2026-08-05T13:00:00Z' },
  { _id: 'V', seq: 15, subSeq: 0, priority: 0, name: 'Emerso verificando',            clientId: 'routine:verifier', createdAt: '2026-08-05T14:00:00Z' },
  { _id: 'C', seq: 16, subSeq: 0, priority: 0, name: 'Automazione non firmata',       clientId: 'routine:routine',  createdAt: '2026-08-05T15:00:00Z' },
];

test('shot provenienza', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); window.__mgTest.setTab('inbox'); }, FBS);
  await page.locator('.mg-item[data-id="F"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/provenienza-lista.png' });
});
