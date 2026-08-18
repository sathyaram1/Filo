// Cattura visiva temporanea: come si vede la casella della frase nel pannello.
// Non è un controllo, è una fotografia da guardare. Va cancellata dopo.
import { test } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

test('foto del pannello con la casella della frase', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([{
      _id: 'foto-1',
      text: 'Quando incollo un\'immagine nella chat non succede niente, e non capisco se è un mio errore.',
      name: 'Incollare un\'immagine nella chat',
      seq: 901, subSeq: 0,
      clientId: 'tester@example.com',
      createdAt: '2026-08-18T10:00:00Z',
      images: [],
      status: 'done', statusPublic: 'closed',
      notes: 'Report della lavorazione: la causa era altrove, l\'immagine non veniva mai agganciata al messaggio.',
      userNote: 'Ora puoi incollare un\'immagine direttamente nella chat.',
    }]);
    window.__mgTest.setTab('resolved');
    window.__mgTest.openDetail('foto-1');
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/manage-frase.png', fullPage: false });
});
