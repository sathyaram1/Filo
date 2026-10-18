// Gestione: la prima bolla della conversazione nomina chi ha scritto il feedback come la testata del dettaglio.
// Prima diceva «Utente» sulle pratiche dell'owner e «Filo (segnalazione automatica)» su quelle di sessioni e routine.
import { test, expect } from './fixtures/electron.mjs';

const base = { status: 'todo', statusPublic: 'open', createdAt: '2026-10-01T09:00:00Z', images: [], notes: '', text: 'Testo della segnalazione.' };
const FBS = [
  { ...base, _id: 'own', seq: 9901, name: 'Dell’owner', clientId: 'owner:me', senderProof: 'admin', localOnly: { by: 'owner', at: 1 } },
  { ...base, _id: 'ses', seq: 9902, name: 'Di una sessione', clientId: 'local:claude', senderProof: 'admin', localOnly: { by: 'local:claude', at: 1 } },
  { ...base, _id: 'rou', seq: 9903, name: 'Di una routine', clientId: 'routine:verifier', senderProof: 'server' },
  { ...base, _id: 'fil', seq: 9904, name: 'Di Filo per un utente', clientId: 'auto:complaint' },
  { ...base, _id: 'ute', seq: 9905, name: 'Di un utente', clientId: 'tester@example.com' },
  { ...base, _id: 'npr', seq: 9906, name: 'Prefisso senza prova', clientId: 'owner:finto' },
];

test('la prima bolla dice lo stesso autore della testata, per ogni mittente', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); }, FBS);
  const visti = {};
  for (const fb of FBS) {
    await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
    await expect(page.locator('#mgThread .mg-bubble-body').first()).toContainText('Testo della segnalazione.');
    const chi = (await page.locator('#mgThread .mg-bubble-who').first().textContent()).trim();
    const testata = (await page.locator('#senderLink').textContent()).trim();
    expect(testata, fb._id).toContain(chi);
    visti[fb._id] = chi;
  }
  expect(visti.own).toBe('Owner');
  expect(visti.ses).toBe('Claude (sessione locale)');
  expect(visti.ute).toBe('Utente');
  expect(visti.npr).not.toBe('Owner');
});
