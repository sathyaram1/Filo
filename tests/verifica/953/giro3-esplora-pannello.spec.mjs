// #953 giro 3, esplorazione: il pannello del mittente per Filo per conto dell'owner, nei due temi.
import { test, expect } from '../../fixtures/electron.mjs';

const base = { status: 'todo', statusPublic: 'open', createdAt: '2026-10-01T09:00:00Z', images: [], notes: '', text: 'Testo.' };
const FBS = [
  { ...base, _id: 'fco', seq: 9911, name: 'Chat dell’owner dopo una pagina', clientId: 'filo:chat', senderProof: 'admin' },
  { ...base, _id: 'fco2', seq: 9912, name: 'Altra dell’owner dopo una pagina', clientId: 'filo:chat', senderProof: 'admin' },
  { ...base, _id: 'fch', seq: 9909, name: 'Dalla chat di un utente', clientId: 'filo:chat' },
  { ...base, _id: 'oau', seq: 9908, name: 'Automatica dell’owner', clientId: 'auto:complaint', senderProof: 'admin' },
];

for (const tema of ['light', 'dark']) {
  test(`pannello del mittente, tema ${tema}`, async ({ openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, tema);
    await page.evaluate((fbs) => { window.__mgTest.setData(fbs); }, FBS);
    await page.evaluate(() => window.__mgTest.openDetail('fco'));
    await page.locator('#senderLink').click();
    await expect(page.locator('#senderFbList .mg-sender-item')).toHaveCount(2);
    await page.screenshot({ path: `tests/.shots/953-g3-pannello-${tema}.png` });
  });
}
