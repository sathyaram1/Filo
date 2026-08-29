// La dashboard feedback mostra il numero progressivo (#22, #22.1) e il titolo
// breve generato dall'LLM all'invio, e li rende ricercabili. I dati vengono
// iniettati stubbando SN_FEEDBACK.list nella pagina: niente dipendenza da
// Firestore live, il test asserisce il rendering vero.

import { test, expect } from './fixtures/electron.mjs';

// Ordinati per data DESC, come li consegna SN_FEEDBACK.list vero.
const FAKE = [
  {
    _id: 'sub1',
    text: 'Implementare la rotazione automatica delle chiavi',
    name: 'rotazione chiavi',
    seq: 22,
    subSeq: 1,
    // clientId neutro: questo spec verifica numero (#22.1) + titolo + ricerca,
    // che dipendono da seq/subSeq/name, NON dall'origine. La categorizzazione
    // per origine (routine → filtro "Solo automatici") è coperta da feedback-agent-tab.spec.
    clientId: 'web-7f3a',
    createdAt: '2026-06-12T11:00:00Z',
  },
  {
    _id: 'spec1',
    text: 'Spec corposa sulla gestione dei segreti',
    name: 'gestione segreti',
    seq: 22,
    subSeq: 0,
    createdAt: '2026-06-12T10:00:00Z',
  },
  {
    _id: 'old1',
    text: 'Feedback storico senza numero né titolo',
    createdAt: '2026-06-01T09:00:00Z',
  },
];

async function loadFakes(page) {
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((items) => {
    SN_FEEDBACK.list = async () => items;
  }, FAKE);
  await page.click('#refresh');
  await expect(page.locator('.fb-card')).toHaveCount(3);
}

test('dashboard: numero e titolo visibili sulle card (#22, #22.1)', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await loadFakes(page);

  const titles = page.locator('.fb-title');
  await expect(titles).toHaveCount(2); // il feedback storico non ne ha
  // Traccia visiva della run (tests/.shots/ è gitignorata).
  await page.screenshot({ path: 'tests/.shots/feedback-numbering.png' }).catch(() => {});
  await expect(titles.nth(0)).toContainText('#22.1');
  await expect(titles.nth(0)).toContainText('rotazione chiavi');
  await expect(titles.nth(1)).toContainText('#22');
  await expect(titles.nth(1)).toContainText('gestione segreti');
});

test('dashboard: la ricerca trova per numero e per titolo', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await loadFakes(page);

  await page.fill('#search', '#22.1');
  await expect(page.locator('.fb-card')).toHaveCount(1);
  await expect(page.locator('.fb-card')).toContainText('rotazione chiavi');

  await page.fill('#search', 'gestione segreti');
  await expect(page.locator('.fb-card')).toHaveCount(1);
  await expect(page.locator('.fb-card')).toContainText('#22');

  await page.fill('#search', '');
  await expect(page.locator('.fb-card')).toHaveCount(3);
});
