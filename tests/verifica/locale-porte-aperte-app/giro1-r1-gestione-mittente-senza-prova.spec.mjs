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

  expect(await autore(page, 'FINTO_OWNER')).not.toContain('Owner');
  expect(await autore(page, 'FINTA_LOCALE')).not.toContain('sessione locale');
  expect(await autore(page, 'FINTA_ROUTINE')).not.toContain('verifica');

  // Nel dettaglio: l'intestazione non dice «Da Owner», e la segnalazione è una bolla dell'utente.
  await page.locator('.mg-item[data-id="FINTO_OWNER"]').click();
  await expect(page.locator('#mgDetailHead, .mg-detail-head').first()).toBeVisible();
  await expect(page.locator('.mg-sender-link')).not.toContainText('Owner');
  await page.locator('.mg-item[data-id="FINTA_ROUTINE"]').click();
  await expect(page.locator('.mg-sender-link')).not.toContainText('Claude');
  await expect(page.getByText('Filo (segnalazione automatica)')).toHaveCount(0);
});

test('senza prova la dashboard non scrive «mittente fidato»', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  const verdicts = ['A', 'B', 'C', 'D'].map((j) => ({ judge: j, class: j === 'A' ? 'attack' : 'aligned', reasoning: 'x' }));
  await seed(page, [{
    _id: 'SENZA_PROVA', seq: 905, subSeq: 0, name: 'Senza prova', clientId: 'owner:qualcuno', status: 'unlabeled',
    text: 'scritto da chiunque', createdAt: '2026-09-30T10:04:00Z',
    pipeline: { verdicts, expectedJudges: ['A', 'B', 'C', 'D'], decidedAt: '2026-09-30T10:05:00Z' },
  }]);
  await page.locator('.mg-item[data-id="SENZA_PROVA"]').click();
  await page.waitForTimeout(500);
  await expect(page.getByText(/mittente fidato/i)).toHaveCount(0);
});
