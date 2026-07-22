// Spec Playwright per la pagina di gestione (filo://manage/): icona d'autore
// su ogni card + menu di riordino (tasto destro / glifo) sull'intestazione.
//
// Feedback #364. Assert di COMPORTAMENTO (non "assenza d'errore"):
//   - ogni card mostra l'icona giusta di CHI ha scritto il feedback
//     (owner / utente / Claude / Filo automatico), derivata dal clientId;
//   - il tasto destro sull'intestazione della lista APRE un menu di ordinamento;
//   - scegliere "per numero" / "per priorità" / "per creatore" RIORDINA
//     davvero le card (asserito sull'ordine dei #N nel DOM);
//   - "Ordine predefinito" ripristina l'ordine di partenza.
//
// Senza il fix ogni assert d'ordine diventa rosso (l'ordine resta quello
// predefinito) e le icone d'autore non esistono.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// Quattro feedback "unlabeled" (nessuna pipeline → tab Ricevuti), uno per ogni
// categoria d'autore, con numero/priorità/creatore distinti così i tre criteri
// di ordinamento danno tre ordini DIVERSI e non ambigui.
const FBS = [
  { _id: 'A', seq: 10, subSeq: 0, priority: 3, name: 'Owner fb',  clientId: 'owner:me',            createdAt: '2026-06-20T10:00:00Z' },
  { _id: 'B', seq: 30, subSeq: 0, priority: 1, name: 'User fb',   clientId: 'tester@example.com',  createdAt: '2026-06-22T10:00:00Z' },
  { _id: 'C', seq: 20, subSeq: 0, priority: 2, name: 'Claude fb', clientId: 'routine:nightly',     createdAt: '2026-06-21T10:00:00Z' },
  { _id: 'D', seq:  5, subSeq: 0, priority: 0, name: 'Filo fb',   clientId: 'auto:complaint',      createdAt: '2026-06-19T10:00:00Z' },
];

async function seed(page) {
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate((fbs) => {
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('inbox');
  }, FBS);
  await expect(page.locator('.mg-item')).toHaveCount(4);
}

// Ordine dei #N attualmente mostrati in lista (DOM order).
async function numOrder(page) {
  return page.locator('.mg-item .mg-item-num').allTextContents();
}

test('ogni card mostra l’icona di chi ha scritto il feedback (owner/utente/Claude/Filo)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  // Un'icona d'autore per card.
  await expect(page.locator('.mg-item .mg-item-author')).toHaveCount(4);

  // Il title dell'icona dichiara la categoria corretta, derivata dal clientId.
  const titleOf = (id) => page.locator(`.mg-item[data-id="${id}"] .mg-item-author`).getAttribute('title');
  expect(await titleOf('A')).toContain('Owner');
  expect(await titleOf('B')).toContain('Utente');
  expect(await titleOf('C')).toContain('Claude');
  expect(await titleOf('D')).toContain('Filo');

  // E l'emoji giusta (owner 👑 · utente 👤 · Claude 🤖 · Filo 🧵).
  const iconOf = (id) => page.locator(`.mg-item[data-id="${id}"] .mg-item-author`).textContent();
  expect(await iconOf('A')).toBe('👑');
  expect(await iconOf('B')).toBe('👤');
  expect(await iconOf('C')).toBe('🤖');
  expect(await iconOf('D')).toBe('🧵');
});

test('il tasto destro sull’intestazione apre il menu di ordinamento', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  // Nessun menu all'inizio.
  await expect(page.locator('.mg-ctxmenu')).toHaveCount(0);

  // Tasto destro sull'intestazione → menu con le 4 voci.
  await page.locator('#mgListHeadRow').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await expect(page.locator('.mg-ctxmenu .sn-select-option')).toHaveCount(4);
  // La voce attiva (predefinito) è marcata col ✓.
  await expect(page.locator('.mg-ctxmenu .sn-select-option.sn-selected')).toHaveText(/Ordine predefinito/);
});

test('riordina per numero / priorità / creatore dal menu, e ripristina il predefinito', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  // Ordine predefinito (unlabeled → recenza DESC): B(22) C(21) A(20) D(19).
  expect(await numOrder(page)).toEqual(['#30', '#20', '#10', '#5']);

  // Apri col glifo ⇅ e scegli "Per numero" → #N decrescente: 30,20,10,5.
  await page.locator('#mgSortBtn').click();
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Per numero' }).click();
  await expect(page.locator('.mg-ctxmenu')).toHaveCount(0);
  expect(await numOrder(page)).toEqual(['#30', '#20', '#10', '#5']);
  // Il glifo si evidenzia (ordinamento non predefinito attivo).
  await expect(page.locator('#mgSortBtn')).toHaveClass(/mg-sort-btn--active/);

  // "Per priorità" → 3,2,1,0 = A(#10) C(#20) B(#30) D(#5).
  await page.locator('#mgSortBtn').click();
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Per priorità' }).click();
  expect(await numOrder(page)).toEqual(['#10', '#20', '#30', '#5']);

  // "Per creatore" → owner, utente, Claude, Filo = A(#10) B(#30) C(#20) D(#5).
  await page.locator('#mgSortBtn').click();
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Per creatore' }).click();
  expect(await numOrder(page)).toEqual(['#10', '#30', '#20', '#5']);

  // "Ordine predefinito" ripristina l'ordine di partenza e spegne il glifo.
  await page.locator('#mgSortBtn').click();
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Ordine predefinito' }).click();
  expect(await numOrder(page)).toEqual(['#30', '#20', '#10', '#5']);
  await expect(page.locator('#mgSortBtn')).not.toHaveClass(/mg-sort-btn--active/);
});
