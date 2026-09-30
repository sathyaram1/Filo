// Verifica locale «lavori locali», rilievo 7: sul lavoro aperto da una sessione, chi ha messo il segno
// «solo in locale» si legge come in testata (Claude, sessione locale), non come l'identificativo grezzo.
import { test, expect } from '../../fixtures/electron.mjs';

const DOC = {
  _id: 'loc', _updateTime: 'v1', seq: 950, subSeq: 0, name: 'Lavoro della sessione', text: 'Testo',
  status: 'todo', statusPublic: 'open', clientId: 'local:claude', senderProof: 'admin',
  localOnly: { by: 'local:claude', at: Date.UTC(2026, 8, 30, 10) },
  createdAt: new Date(Date.UTC(2026, 8, 30, 10)).toISOString(), images: [],
  pipeline: { skipped: 'local_proven', stage: 'local', action: 'owner_accepted' },
};

test('il tasto «Solo locale» dice chi ha messo il segno con parole da persona', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([{ ...d }]);
    window.__mgTest.setTab('local');
    window.__mgTest.openDetail('loc');
  }, DOC);
  const tasto = page.locator('#mgLocalBtn');
  await expect(tasto).toBeVisible();
  await expect(tasto).toHaveText(/Solo locale/);
  const titolo = await tasto.getAttribute('title');
  expect(titolo).not.toContain('local:claude');
});
