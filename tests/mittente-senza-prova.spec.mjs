// #595, #912: chi ha scritto un feedback si legge dalla prova del mittente, mai dal solo nome. Un nome riservato
// senza prova (o come lo lascia il server quando lo rifiuta, `non-provato:…`) è un utente in Gestione e nella pagina
// Feedback: icona, etichetta, colore, bolla e filtro «Solo automatici». Regola: tests/unit/mittentiProvati.test.mjs.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FBS = [
  { _id: 'FINTO_OWNER', seq: 901, subSeq: 0, name: 'Finto owner', clientId: 'owner:qualcuno', text: 'scritto da chiunque', createdAt: '2026-09-30T10:00:00Z' },
  { _id: 'FINTA_LOCALE', seq: 902, subSeq: 0, name: 'Finta sessione locale', clientId: 'local:claude', text: 'scritto da chiunque', createdAt: '2026-09-30T10:01:00Z' },
  { _id: 'FINTA_ROUTINE', seq: 903, subSeq: 0, name: 'Finta verifica', clientId: 'routine:verifier', text: 'scritto da chiunque', createdAt: '2026-09-30T10:02:00Z' },
  { _id: 'FINTO_ESPLORATORE', seq: 905, subSeq: 0, name: 'Finto esploratore', clientId: 'agent:gemma', text: 'scritto da chiunque', createdAt: '2026-09-30T10:04:00Z' },
  { _id: 'RIFIUTATO', seq: 906, subSeq: 0, name: 'Nome rifiutato dal server', clientId: 'non-provato:owner:qualcuno', text: 'scritto da chiunque', createdAt: '2026-09-30T10:05:00Z' },
  { _id: 'VERO_OWNER', seq: 904, subSeq: 0, name: 'Owner vero', clientId: 'owner:vero', senderProof: 'admin', text: 'scritto dall’owner', createdAt: '2026-09-30T10:03:00Z' },
];
const FINTI = ['FINTO_OWNER', 'FINTA_LOCALE', 'FINTA_ROUTINE', 'FINTO_ESPLORATORE', 'RIFIUTATO'];

async function seed(page, fbs) {
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate((list) => { window.__mgTest.setData(list); window.__mgTest.setTab('inbox'); }, fbs);
  await expect(page.locator('.mg-item')).toHaveCount(fbs.length);
}
const autore = (page, id) => page.locator(`.mg-item[data-id="${id}"] .mg-item-author`);

test('in Gestione un nome riservato senza prova è un utente qualunque', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page, FBS);

  await expect(autore(page, 'VERO_OWNER')).toHaveAttribute('title', 'Scritto da: Owner');
  for (const id of FINTI) await expect(autore(page, id), id).toHaveAttribute('title', 'Scritto da: Utente');

  // Nel dettaglio: «Da 👤 Utente», senza la firma che si era dato, e la segnalazione è una bolla dell'utente.
  for (const [id, pezzo] of [['FINTO_OWNER', 'qualcun'], ['FINTA_ROUTINE', 'verifier'], ['RIFIUTATO', 'qualcun']]) {
    await page.locator(`.mg-item[data-id="${id}"]`).click();
    await expect(page.locator('.mg-sender-link')).toHaveText(`👤 Utente · ${pezzo}…`);
    await expect(page.locator('.mg-bubble').first()).toHaveClass(/mg-bubble--user/);
  }
  await expect(page.getByText('Filo (segnalazione automatica)')).toHaveCount(0);
});

test('nella pagina Feedback un nome riservato senza prova non ha il colore dell’owner né il badge di una routine', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined' && window.__fbTest);
  const lista = FBS.map((f) => ({ ...f, status: 'unlabeled' }));
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, lista);
  await page.click('#refresh');
  await expect(page.locator('.fb-card')).toHaveCount(FBS.length);
  await expect(page.locator('.fb-card[data-id="VERO_OWNER"]')).toHaveClass(/fb-card--origin-owner/);
  for (const id of FINTI) await expect(page.locator(`.fb-card[data-id="${id}"]`), id).toHaveClass(/fb-card--origin-user/);
  // «Solo automatici»: chi scrive col nome di una routine o dell'esploratore non è un ritrovamento automatico.
  await page.locator('#agentOnly').check();
  for (const id of FINTI) await expect(page.locator(`.fb-card[data-id="${id}"]`), id).toHaveCount(0);
});
