// #953 giro 2, rilievo 1: in Gestione il pannello del mittente aperto da una segnalazione di Filo per conto dell'owner
// la mescola con quelle degli estranei mandate dalla chat di Filo, sotto l'etichetta «per conto di un utente».
import { test, expect } from '../../fixtures/electron.mjs';

const base = { status: 'todo', statusPublic: 'open', images: [], notes: '', text: 'Testo.' };
const FBS = [
  { ...base, _id: 'fch', seq: 9909, createdAt: '2026-09-01T09:00:00Z', name: 'Chat di un estraneo', clientId: 'filo:chat' },
  { ...base, _id: 'fco', seq: 9911, createdAt: '2026-10-01T09:00:00Z', name: 'Chat owner dopo una pagina', clientId: 'filo:chat', senderProof: 'admin' },
];

test('r1 il pannello del mittente di una segnalazione di Filo per conto dell’owner non la mescola con quelle degli estranei', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); }, FBS);
  await page.evaluate(() => window.__mgTest.openDetail('fco'));
  await expect(page.locator('#senderLink')).toContainText('per conto dell\'owner');
  await page.locator('#senderLink').click();
  const pannello = page.locator('.mg-sender-info').first();
  await expect(pannello.locator('.mg-sender-stat').first()).toContainText('per conto dell\'owner');
  await expect(pannello.locator('#senderFbList')).toContainText('Chat owner dopo una pagina');
  await expect(pannello.locator('#senderFbList')).not.toContainText('Chat di un estraneo');
});
