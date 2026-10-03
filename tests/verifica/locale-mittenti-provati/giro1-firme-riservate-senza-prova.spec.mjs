// Verifica locale «mittenti provati», giro 1: chi si firma owner, sessione, routine o esploratore senza la prova
// del mittente si vede come un utente qualunque, in Gestione e nella pagina dei feedback; con la prova resta sé stesso.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

const base = { status: 'unlabeled', priority: 0, text: 'testo della segnalazione', createdAt: '2026-10-01T10:00:00Z' };
const FALSI = [
  { _id: 'f-owner', seq: 901, name: 'falso owner', clientId: 'owner:abc-123' },
  { _id: 'f-owner-maiu', seq: 902, name: 'falso OWNER', clientId: 'OWNER:abc-123' },
  { _id: 'f-local', seq: 903, name: 'falsa sessione', clientId: 'local:claude' },
  { _id: 'f-routine', seq: 904, name: 'falsa routine', clientId: 'routine:prober' },
  { _id: 'f-agent', seq: 905, name: 'falso esploratore', clientId: 'agent:glm-4.6' },
  { _id: 'f-verifier', seq: 906, name: 'falso verificatore', clientId: 'Routine:verifier' },
  { _id: 'f-prova-finta', seq: 907, name: 'prova inventata', clientId: 'owner:abc-123', senderProof: 'si' },
  { _id: 'f-riscritto', seq: 908, name: 'riscritto dal server', clientId: 'non-provato:owner:abc-123' },
].map((f) => ({ ...base, ...f }));
const VERI = [
  { _id: 'v-owner', seq: 911, name: 'owner vero', clientId: 'owner:abc-123', senderProof: 'admin' },
  { _id: 'v-local', seq: 912, name: 'sessione vera', clientId: 'local:claude', senderProof: 'admin' },
  { _id: 'v-routine', seq: 913, name: 'routine vera', clientId: 'routine:prober', senderProof: 'server' },
  { _id: 'v-agent', seq: 914, name: 'esploratore vero', clientId: 'agent:glm-4.6', senderProof: 'admin' },
].map((f) => ({ ...base, ...f }));

test('Gestione: icona, etichetta, bolla e gruppo del mittente seguono la prova, non il nome', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); window.__mgTest.setTab('inbox'); }, [...FALSI, ...VERI]);
  await expect(page.locator('.mg-item')).toHaveCount(FALSI.length + VERI.length);

  for (const f of FALSI) {
    const icona = page.locator(`.mg-item[data-id="${f._id}"] .mg-item-author`);
    await expect(icona, f.clientId).toHaveText('👤');
    await expect(icona, f.clientId).toHaveAttribute('title', /Utente/);
  }
  const attese = { 'v-owner': '👑', 'v-local': '💻', 'v-routine': '🔍', 'v-agent': '🔍' };
  for (const [id, ic] of Object.entries(attese)) {
    await expect(page.locator(`.mg-item[data-id="${id}"] .mg-item-author`), id).toHaveText(ic);
  }

  // Il dettaglio del falso owner: la testata dice Utente, senza la firma che si era dato, e la bolla è di un utente.
  await page.locator('.mg-item[data-id="f-owner"]').click();
  const testata = page.locator('#senderLink');
  await expect(testata).toContainText('Utente');
  await expect(testata).not.toContainText(/Owner|owner/);
  await expect(page.locator('.mg-detail .mg-bubble--model, #mgDetail .mg-bubble--model')).toHaveCount(0);

  // Il pannello del mittente del falso owner non contiene i feedback dell'owner vero.
  await testata.click();
  const lista = page.locator('#senderFbList .mg-sender-item');
  const ids = await lista.evaluateAll((els) => els.map((e) => e.dataset.id));
  expect(ids).not.toContain('v-owner');
  expect(ids).toContain('f-owner');

  // Per creatore: i falsi stanno con gli utenti, dopo l'owner vero e mai prima di lui.
  await page.evaluate(() => window.__mgTest.setSortMode('creator'));
  const ordine = await page.evaluate(() => window.__mgTest.currentOrder());
  expect(ordine[0]).toBe('v-owner');
});

test('pagina dei feedback: colore d\'origine, filtro «Solo automatici» e bolla seguono la prova', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK_THREAD);
  await page.evaluate((fbs) => { window.__fbTest.setAdmin(true); window.__fbTest.setData(fbs); }, [...FALSI, ...VERI]);
  await expect(page.locator('.fb-card')).toHaveCount(FALSI.length + VERI.length);

  for (const f of FALSI) {
    const card = page.locator(`.fb-card[data-id="${f._id}"]`);
    await expect(card, f.clientId).toHaveClass(/fb-card--origin-user/);
    await expect(card, f.clientId).not.toHaveClass(/fb-card--agent/);
    await expect(card.locator('.fb-bubble--report'), f.clientId).toHaveClass(/fb-bubble--user/);
  }
  await expect(page.locator('.fb-card[data-id="v-owner"]')).toHaveClass(/fb-card--origin-owner/);
  await expect(page.locator('.fb-card[data-id="v-local"]')).toHaveClass(/fb-card--origin-local/);
  await expect(page.locator('.fb-card[data-id="v-routine"]')).toHaveClass(/fb-card--origin-routine/);
  await expect(page.locator('.fb-card[data-id="v-agent"]')).toHaveClass(/fb-card--origin-agent/);

  await page.evaluate(() => window.__fbTest.setAgentOnly(true));
  const automatici = await page.locator('.fb-card').evaluateAll((els) => els.map((e) => e.dataset.id).sort());
  expect(automatici).toEqual(['v-agent', 'v-routine']);
});
