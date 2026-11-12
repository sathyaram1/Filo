// #597: un'immagine che il server non ha aperto per i giudici (troppo grande, oltre le prime tre, indirizzo
// rifiutato…) non sparisce in silenzio: il giudice aperto in Gestione dice quale e perché.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FB = {
  _id: 'fb-immagini-597',
  text: 'Lo screenshot mostra il menu tagliato.',
  name: 'Menu tagliato',
  seq: 597, subSeq: 0, status: 'new',
  clientId: 'tester@example.com', createdAt: '2026-10-18T10:00:00Z',
  images: ['a', 'b', 'c', 'd'],
  pipeline: {
    action: 'human_review', l1Category: 'clean', l2Class: 'aligned', l2Unfiltered: true, stage: 'L2',
    expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
    missingJudges: ['dynamic'],
    verdicts: [
      { judge: 'fixed_1', class: 'aligned', reasoning: 'Bug reale.', model: 'modello/uno' },
      { judge: 'fixed_2', class: 'aligned', reasoning: 'Allineato.', model: 'modello/due' },
      { judge: 'fixed_3', class: 'aligned', reasoning: 'Ok.', model: 'modello/tre' },
    ],
    immaginiNonAperte: [
      { n: 2, motivo: 'troppo grande (oltre 8 MB)' },
      { n: 4, motivo: 'i modelli ricevono le prime 3 immagini' },
    ],
    decidedAt: '2026-10-18T10:01:00Z',
  },
};

async function apri(openTab, fb) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW && window.filo);
  await page.evaluate((f) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([f]); }, fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgLivelliRow .mg-dot')).toHaveCount(4);
  return page;
}

test('il giudice aperto dice quali immagini non ha visto e perché', async ({ openTab }) => {
  const page = await apri(openTab, FB);
  await page.locator('#mgLivelliRow .mg-dot--aligned').first().click();
  const riga = page.locator('#mgSide .mg-judge-nonviste');
  await expect(riga).toHaveText([
    'Immagine 2 non vista dai giudici: troppo grande (oltre 8 MB).',
    'Immagine 4 non vista dai giudici: i modelli ricevono le prime 3 immagini.',
  ]);
  await expect(page.locator('#mgSide .mg-reasoning')).toHaveText('Bug reale.');
  // Una frase va a capo fra le parole, non a metà parola come un nome di modello.
  expect(await riga.first().evaluate((el) => getComputedStyle(el).wordBreak)).toBe('normal');
  await page.locator('#mgSide').screenshot({ path: 'tests/.shots/597-immagini-non-viste.png' });

  // Anche il giudice che non ha votato lo dice: il buco delle immagini non dipende dal verdetto.
  await page.locator('#mgLivelliRow .mg-dot--empty').click();
  await expect(page.locator('#mgSide .mg-judge-nonviste').first()).toContainText('Immagine 2 non vista dai giudici');
});

test('senza immagini rimaste fuori il giudice non mostra nessuna riga in più', async ({ openTab }) => {
  const { immaginiNonAperte, ...pipeline } = FB.pipeline; // eslint-disable-line no-unused-vars
  const page = await apri(openTab, { ...FB, _id: 'fb-immagini-597-b', pipeline });
  await page.locator('#mgLivelliRow .mg-dot--aligned').first().click();
  await expect(page.locator('#mgSide .mg-reasoning')).toHaveText('Bug reale.');
  await expect(page.locator('#mgSide .mg-judge-nonviste')).toHaveCount(0);
});
