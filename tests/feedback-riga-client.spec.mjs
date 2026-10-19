// #912: nella pagina dei feedback la riga «client:» di chi si era dato un nome riservato senza prova non mostra quella
// firma e non si riduce a «non-provato:» uguale per tutti; con la prova vera la riga resta com'è.
import { test, expect } from './fixtures/electron.mjs';

const base = { status: 'unlabeled', priority: 0, text: 'testo', createdAt: '2026-10-01T10:00:00Z' };
const FBS = [
  { _id: 'riscritto-1', seq: 1, name: 'riscritto 1', clientId: 'non-provato:owner:abc-111' },
  { _id: 'riscritto-2', seq: 2, name: 'riscritto 2', clientId: 'non-provato:local:claude' },
  { _id: 'vecchio', seq: 3, name: 'vecchio senza prova', clientId: 'owner:abc-222' },
  { _id: 'vero', seq: 4, name: 'owner vero', clientId: 'owner:abc-333', senderProof: 'admin' },
].map((f) => ({ ...base, ...f }));

async function rigaClient(page, id) {
  const righe = (await page.locator(`.fb-card[data-id="${id}"]`).innerText()).split('\n').map((l) => l.trim());
  return righe.find((l) => /^client:/.test(l)) || '';
}

test('pagina dei feedback: la riga del mittente senza prova non porta la firma riservata', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK_THREAD);
  await page.evaluate((fbs) => { window.__fbTest.setAdmin(true); window.__fbTest.setData(fbs); }, FBS);
  await expect(page.locator('.fb-card')).toHaveCount(FBS.length);
  expect(await rigaClient(page, 'riscritto-1')).toBe('client: abc-111');
  expect(await rigaClient(page, 'riscritto-2')).toBe('client: claude');
  expect(await rigaClient(page, 'vecchio')).toBe('client: abc-222');
  expect(await rigaClient(page, 'vero')).toBe('client: owner:abc-33');
});
