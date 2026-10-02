// Esplorazione giro 9: la prima bolla e la testata dicono lo stesso autore, in Gestione e nella pagina gemella.
import { test, expect } from './../../fixtures/electron.mjs';

const base = { status: 'todo', statusPublic: 'open', createdAt: '2026-10-01T09:00:00Z', images: [], text: 'Testo della segnalazione.' };
const NOTE = 'Lavoro locale: verifica avviata (giro 1) sul ramo claude/x.';
const FBS = [
  { ...base, _id: 'own', seq: 9901, name: 'Dell’owner', clientId: 'owner:me', senderProof: 'admin', localOnly: { by: 'owner', at: 1 }, notes: NOTE },
  { ...base, _id: 'ses', seq: 9902, name: 'Di una sessione', clientId: 'local:claude', senderProof: 'admin', localOnly: { by: 'local:claude', at: 1 }, notes: NOTE, status: 'working' },
  { ...base, _id: 'sesnp', seq: 9903, name: 'Sessione senza prova', clientId: 'local:claude', notes: '' },
  { ...base, _id: 'rounp', seq: 9904, name: 'Routine senza prova', clientId: 'routine:verifier', notes: '' },
  { ...base, _id: 'age', seq: 9905, name: 'Esploratore', clientId: 'agent:glm', notes: '' },
  { ...base, _id: 'ute', seq: 9906, name: 'Di un utente', clientId: 'tester@example.com', notes: '' },
];

test('Gestione: bolla e testata per ogni mittente', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);
  const out = {};
  for (const fb of FBS) {
    await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
    await expect(page.locator('#mgThread .mg-bubble-body').first()).toContainText('Testo della segnalazione.');
    const chi = await page.locator('#mgThread .mg-bubble').allInnerTexts();
    const testata = (await page.locator('#senderLink').textContent()).trim();
    out[fb._id] = { chi, testata };
  }
  console.log(JSON.stringify(out, null, 1));
});

test('pagina gemella: bolla per ogni mittente', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => window.__fbTest);
  await page.evaluate((fbs) => { window.__fbTest.setAdmin(true); window.__fbTest.setData(fbs); }, FBS);
  const out = {};
  for (const tab of ['local', 'inbox', 'queue']) {
    await page.evaluate((t) => window.__fbTest.setTab(t), tab);
    await page.waitForTimeout(300);
    out[tab] = await page.evaluate(() => Array.from(document.querySelectorAll('.fb-card')).map((el) => el.innerText.replace(/\s+/g, ' ').slice(0, 400)));
  }
  console.log(JSON.stringify(out, null, 1));
  await page.evaluate(() => window.__fbTest.setTab('local'));
  await page.screenshot({ path: 'tests/.shots/giro9-gemella-local.png', fullPage: true });
});
