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
  // #953: quello che Filo manda dalla copia dell'owner lo dice, e senza la prova resta di un utente.
  { ...base, _id: 'och', seq: 9907, name: 'Dalla chat dell’owner', clientId: 'owner:filo:chat', senderProof: 'admin' },
  { ...base, _id: 'oau', seq: 9908, name: 'Automatica dell’owner', clientId: 'auto:complaint', senderProof: 'admin' },
  { ...base, _id: 'fch', seq: 9909, name: 'Dalla chat di un utente', clientId: 'filo:chat' },
  { ...base, _id: 'fin', seq: 9910, name: 'Chat dell’owner senza prova', clientId: 'owner:filo:chat' },
  // Scritta dopo aver letto testo di altri: porta la prova ma resta di Filo, e passa dai giudici.
  { ...base, _id: 'fco', seq: 9911, name: 'Chat dell’owner dopo una pagina', clientId: 'filo:chat', senderProof: 'admin' },
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
  expect(visti.och).toBe('Owner (scritto da Filo)');
  expect(visti.oau).toBe('Filo (per conto dell\'owner)');
  expect(visti.fil).toBe('Filo (per conto di un utente)');
  expect(visti.fch).toBe('Filo (per conto di un utente)');
  expect(visti.fin).toBe('Utente');
  expect(visti.fco).toBe('Filo (per conto dell\'owner)');
});

test('il pannello del mittente tiene a parte quello che Filo manda per conto dell’owner', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); }, FBS);
  const pannello = async (id) => {
    await page.evaluate((x) => window.__mgTest.openDetail(x), id);
    await page.locator('#senderLink').click();
    const info = page.locator('.mg-sender-info').first();
    await expect(info.locator('#senderFbList')).toBeVisible();
    return {
      chi: (await info.locator('.mg-sender-stat').first().textContent()).trim(),
      mittente: (await info.locator('.mg-sender-stat').nth(1).textContent()).trim(),
      voci: await info.locator('#senderFbList .mg-sender-item').evaluateAll((els) => els.map((e) => e.dataset.id).sort()),
    };
  };
  expect(await pannello('fco')).toEqual({ chi: '🧵 Filo (per conto dell\'owner)', mittente: 'filo:chat', voci: ['fco'] });
  expect(await pannello('fch')).toEqual({ chi: '🧵 Filo (per conto di un utente)', mittente: 'filo:chat', voci: ['fch'] });
  expect(await pannello('oau')).toEqual({ chi: '🧵 Filo (per conto dell\'owner)', mittente: 'auto:complaint', voci: ['oau'] });
  expect(await pannello('fil')).toEqual({ chi: '🧵 Filo (per conto di un utente)', mittente: 'auto:complaint', voci: ['fil'] });
});

test('in lista l’icona dice per conto di chi ha scritto Filo', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  // Senza verdetto dei giudici: stanno nei Ricevuti, la sezione con cui la pagina si apre.
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); }, FBS.map((fb) => ({ ...fb, status: 'unlabeled' })));
  const titolo = (id) => page.locator(`.mg-item[data-id="${id}"] .mg-item-author`).first().getAttribute('title');
  await expect.poll(() => titolo('och')).toBe('Scritto da: Owner (scritto da Filo)');
  expect(await titolo('oau')).toBe('Scritto da: Filo (per conto dell\'owner)');
  expect(await titolo('fil')).toBe('Scritto da: Filo (per conto di un utente)');
  await page.evaluate(() => window.__mgTest.openDetail('och'));
  await expect(page.locator('#senderLink')).toHaveText('👑 Owner (scritto da Filo)');
  await page.screenshot({ path: 'tests/.shots/953-gestione-autore.png' });
});
