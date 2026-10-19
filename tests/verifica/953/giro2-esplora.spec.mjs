// esplorazione #953 giro 2: pannello del mittente per una segnalazione di Filo per conto dell'owner.
import { test, expect } from '../../fixtures/electron.mjs';

const base = { status: 'todo', statusPublic: 'open', images: [], notes: '', text: 'Testo.' };
const FBS = [
  { ...base, _id: 'fch', seq: 9909, createdAt: '2026-09-01T09:00:00Z', name: 'Chat di un estraneo', clientId: 'filo:chat' },
  { ...base, _id: 'fco', seq: 9911, createdAt: '2026-10-01T09:00:00Z', name: 'Chat owner dopo una pagina', clientId: 'filo:chat', senderProof: 'admin' },
];

test('pannello mittente', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); }, FBS);
  await page.evaluate(() => window.__mgTest.openDetail('fco'));
  await expect(page.locator('#senderLink')).toContainText('per conto dell');
  await page.locator('#senderLink').click();
  await page.waitForTimeout(500);
  const info = await page.locator('.mg-sender-info').first().innerText();
  console.log('PANNELLO>>>', info);
  await page.screenshot({ path: 'tests/.shots/953-g2-mittente.png' });
});
