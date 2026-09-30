// Verifica locale porte-aperte-app, giro 1, rilievo 1: in Gestione chi ha scritto un feedback
// si legge ancora dal solo prefisso. Senza la prova del mittente non deve comparire come owner,
// sessione locale o routine, né come «mittente fidato».
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FBS = [
  { _id: 'FINTO_OWNER', seq: 901, subSeq: 0, name: 'Finto owner', clientId: 'owner:qualcuno', text: 'scritto da chiunque', createdAt: '2026-09-30T10:00:00Z' },
  { _id: 'FINTA_LOCALE', seq: 902, subSeq: 0, name: 'Finta sessione locale', clientId: 'local:claude', text: 'scritto da chiunque', createdAt: '2026-09-30T10:01:00Z' },
  { _id: 'FINTA_ROUTINE', seq: 903, subSeq: 0, name: 'Finta verifica', clientId: 'routine:verifier', text: 'scritto da chiunque', createdAt: '2026-09-30T10:02:00Z' },
  { _id: 'VERO_OWNER', seq: 904, subSeq: 0, name: 'Owner vero', clientId: 'owner:vero', senderProof: 'admin', text: 'scritto dall’owner', createdAt: '2026-09-30T10:03:00Z' },
];

async function seed(page, fbs) {
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate((list) => { window.__mgTest.setData(list); window.__mgTest.setTab('inbox'); }, fbs);
  await expect(page.locator('.mg-item')).toHaveCount(fbs.length);
}
const autore = (page, id) => page.locator(`.mg-item[data-id="${id}"] .mg-item-author`).getAttribute('title');

test('un feedback senza prova non compare scritto dall’owner, dalla sessione locale o da una routine', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page, FBS);

  // Il feedback vero dell'owner resta dell'owner.
  expect(await autore(page, 'VERO_OWNER')).toContain('Owner');

  expect.soft(await autore(page, 'FINTO_OWNER')).not.toContain('Owner');
  expect.soft(await autore(page, 'FINTA_LOCALE')).not.toContain('sessione locale');
  expect.soft(await autore(page, 'FINTA_ROUTINE')).not.toContain('verifica');

  // Nel dettaglio: l'intestazione non dice «Da Owner», e la segnalazione è una bolla dell'utente.
  await page.locator('.mg-item[data-id="FINTO_OWNER"]').click();
  await expect(page.locator('#mgDetailHead, .mg-detail-head').first()).toBeVisible();
  await expect.soft(page.locator('.mg-sender-link')).not.toContainText('Owner');
  await page.locator('.mg-item[data-id="FINTA_ROUTINE"]').click();
  await expect.soft(page.locator('.mg-sender-link')).not.toContainText('Claude');
  await expect.soft(page.getByText('Filo (segnalazione automatica)')).toHaveCount(0);
});

test('nella pagina Feedback un feedback senza prova non ha il colore dell’owner né il badge di una routine', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK_THREAD);
  await page.evaluate((list) => { window.__fbTest.setAdmin(true); window.__fbTest.setData(list); }, FBS);
  await expect(page.locator('.fb-card[data-id="VERO_OWNER"]')).toHaveClass(/fb-card--origin-owner/);
  await expect.soft(page.locator('.fb-card[data-id="FINTO_OWNER"]')).not.toHaveClass(/fb-card--origin-owner/);
  await page.evaluate(() => window.__fbTest.setAgentOnly(true));
  await expect.soft(page.locator('.fb-card[data-id="FINTA_ROUTINE"]')).toHaveCount(0);
});
