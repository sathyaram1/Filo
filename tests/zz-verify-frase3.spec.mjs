// Diagnostico: cosa vede davvero l-owner quando il salvataggio lento atterra
// mentre ha gia aperto un altro feedback.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const FBS = [
  { _id: 'fb-a', name: 'Titolo A', text: 'Testo A', seq: 401, subSeq: 0,
    status: 'new', clientId: 'tizio@example.com', createdAt: '2026-06-01T10:00:00Z', images: [], userNote: 'FRASE-A' },
  { _id: 'fb-b', name: 'Titolo B', text: 'Testo B', seq: 402, subSeq: 0,
    status: 'new', clientId: 'caio@example.com', createdAt: '2026-06-02T10:00:00Z', images: [], userNote: 'FRASE-B' },
];

test('diagnostico travaso', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => {
    window.__sent = [];
    window.filo.message = async (msg) => {
      window.__sent.push(JSON.parse(JSON.stringify(msg)));
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true };
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true };
    };
  });
  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);

  await page.click('.mg-item[data-id="fb-a"]');
  await page.fill('#mgUserNoteText', 'FRASE-NUOVA-DI-A');
  await page.click('#mgUserNoteBtn');
  await page.click('.mg-item[data-id="fb-b"]');

  const prima = {
    casella: await page.inputValue('#mgUserNoteText'),
    conversazione: (await page.locator('#mgThread').innerText()).slice(0, 120),
  };
  await page.waitForTimeout(1200);
  const dopo = {
    casella: await page.inputValue('#mgUserNoteText'),
    conversazione: (await page.locator('#mgThread').innerText()).slice(0, 120),
    messaggio: await page.locator('#mgUserNoteMsg').innerText(),
    selezionatoInLista: await page.locator('.mg-item--selected').getAttribute('data-id'),
  };
  console.log('\n>>> APERTO B, subito dopo il click:', JSON.stringify(prima, null, 2));
  console.log('>>> APERTO B, dopo che atterra il salvataggio di A:', JSON.stringify(dopo, null, 2));

  // Ora l-owner preme di nuovo Salva credendo di lavorare su B.
  await page.click('#mgUserNoteBtn');
  await page.waitForTimeout(1200);
  const inviati = await page.evaluate(() => window.__sent.filter((m) => m.type === 'feedback_update'));
  console.log('>>> SCRITTURE INVIATE:', JSON.stringify(inviati, null, 2));
  expect(true).toBe(true);
});
