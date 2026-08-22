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

// ─── #443: la provenienza vera, non "un'automazione qualunque" ───────────────
//
// Prima di questo, tre automazioni molto diverse (chi esplora l'app, chi
// implementa una modifica, chi verifica il lavoro di un altro) arrivavano tutte
// come 'Claude', e Filo che scrive per conto di un utente si presentava come
// l'utente stesso — che è il caso da cui nasce il feedback. Togliendo il fix,
// P/W/V collassano su 🤖 e F diventa 👤: tutti gli assert qui sotto diventano
// rossi.
const FBS_ORIGINI = [
  { _id: 'P', seq: 50, subSeq: 0, priority: 0, name: 'Esplorazione', clientId: 'routine:prober',   createdAt: '2026-08-05T10:00:00Z' },
  { _id: 'W', seq: 51, subSeq: 0, priority: 0, name: 'Sviluppo',     clientId: 'routine:new-work', createdAt: '2026-08-05T11:00:00Z' },
  { _id: 'V', seq: 52, subSeq: 0, priority: 0, name: 'Verifica',     clientId: 'routine:verifier', createdAt: '2026-08-05T12:00:00Z' },
  { _id: 'F', seq: 53, subSeq: 0, priority: 0, name: 'Da Filo',      clientId: 'filo:chat',        createdAt: '2026-08-05T13:00:00Z' },
  // La sessione locale: Claude che lavora sulla macchina dell'owner.
  { _id: 'L', seq: 54, subSeq: 0, priority: 0, name: 'Sessione locale', clientId: 'local:claude',  createdAt: '2026-08-05T14:00:00Z' },
];

test('le tre automazioni, la sessione locale e Filo-per-conto-di-un-utente si distinguono in lista', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate((fbs) => {
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('inbox');
  }, FBS_ORIGINI);
  await expect(page.locator('.mg-item')).toHaveCount(5);

  const iconOf  = (id) => page.locator(`.mg-item[data-id="${id}"] .mg-item-author`).textContent();
  const titleOf = (id) => page.locator(`.mg-item[data-id="${id}"] .mg-item-author`).getAttribute('title');

  // Cinque icone DIVERSE: è il punto: nessuna coppia deve collassare.
  const icons = [await iconOf('P'), await iconOf('W'), await iconOf('V'), await iconOf('F'), await iconOf('L')];
  expect(new Set(icons).size).toBe(5);
  expect(icons).toEqual(['🔍', '🔧', '🧪', '🧵', '💻']);

  // E l'etichetta dice quale mestiere, non solo "Claude".
  expect(await titleOf('P')).toContain('esplorazione');
  expect(await titleOf('W')).toContain('sviluppo');
  expect(await titleOf('V')).toContain('verifica');
  expect(await titleOf('F')).toContain('per conto di un utente');
  expect(await titleOf('L')).toContain('sessione locale');
});

// La provenienza nuova: un feedback aperto da una sessione locale non deve
// arrivare in dashboard come "un utente qualunque" (che è ciò che succedeva
// depositandolo dalla strada dell'app) né confondersi con l'esploratore o con
// le automazioni in cloud. Senza il ramo dedicato l'icona torna 👤 e l'etichetta
// "Utente": entrambi gli assert diventano rossi.
test('un feedback della sessione locale si legge come tale, non come utente né come automazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate((fbs) => {
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('inbox');
  }, FBS_ORIGINI);

  const author = page.locator('.mg-item[data-id="L"] .mg-item-author');
  await expect(author).toHaveText('💻');
  await expect(author).toHaveAttribute('title', 'Scritto da: Claude (sessione locale)');

  // Anche l'intestazione del dettaglio dichiara la provenienza (e non mostra
  // un pezzo di identificativo grezzo, che è il trattamento riservato agli
  // utenti esterni).
  await page.locator('.mg-item[data-id="L"]').click();
  const link = page.locator('#senderLink');
  await expect(link).toHaveText('💻 Claude (sessione locale)');
  await expect(link).toHaveAttribute('title', 'local:claude');
});

test('l’intestazione del dettaglio dice CHI ha scritto, non l’identificativo grezzo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate((fbs) => {
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('inbox');
  }, FBS_ORIGINI);

  // Il caso del feedback: "filo:chat" non dice a nessuno che dietro c'è un utente.
  await page.locator('.mg-item[data-id="F"]').click();
  const link = page.locator('#senderLink');
  await expect(link).toHaveText(/Filo \(per conto di un utente\)/);
  // L'identificativo grezzo resta ispezionabile (non è stato buttato via).
  await expect(link).toHaveAttribute('title', 'filo:chat');

  // Un'automazione dichiara il proprio mestiere.
  await page.locator('.mg-item[data-id="V"]').click();
  await expect(page.locator('#senderLink')).toHaveText(/Claude \(verifica\)/);
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
