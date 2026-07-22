// Verifier adversarial stress test per feedback #364 (icona autore + riordino).
// NON committato come parte del fix: verifica black-box del comportamento sotto
// input limite. Cancellabile dopo la verifica.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function seed(page, fbs) {
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate((x) => { window.__mgTest.setData(x); window.__mgTest.setTab('inbox'); }, fbs);
}
async function numOrder(page) {
  return page.locator('.mg-item .mg-item-num').allTextContents();
}

test('XSS: titolo e clientId ostili non eseguono script; icona presente', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  let alerted = false;
  page.on('dialog', async (d) => { alerted = true; await d.dismiss(); });
  await seed(page, [
    { _id: 'X', seq: 1, subSeq: 0, priority: 0,
      name: '<img src=x onerror=alert(1)><script>alert(2)</script>',
      clientId: 'owner:<script>alert(3)</script>', createdAt: '2026-06-20T10:00:00Z' },
  ]);
  await expect(page.locator('.mg-item')).toHaveCount(1);
  // Nessuna <img>/<script> iniettata dentro la card.
  await expect(page.locator('.mg-item img')).toHaveCount(0);
  await expect(page.locator('.mg-item .mg-item-author')).toHaveCount(1);
  // clientId che inizia con owner: → icona owner, testo grezzo non interpretato.
  expect(await page.locator('.mg-item .mg-item-author').textContent()).toBe('👑');
  await page.waitForTimeout(200);
  expect(alerted).toBe(false);
});

test('stato vuoto: nessuna card, tasto destro e glifo non crashano', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page, []);
  await expect(page.locator('.mg-item')).toHaveCount(0);
  await page.locator('#mgSortBtn').click();
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Per numero' }).click();
  // Ancora nessuna card, nessun errore.
  await expect(page.locator('.mg-item')).toHaveCount(0);
  await page.locator('#mgListHeadRow').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
});

test('la scelta di ordinamento persiste alla riapertura della pagina', async ({ openTab }) => {
  const fbs = [
    { _id: 'A', seq: 10, subSeq: 0, priority: 3, name: 'a', clientId: 'owner:me', createdAt: '2026-06-20T10:00:00Z' },
    { _id: 'B', seq: 30, subSeq: 0, priority: 1, name: 'b', clientId: 'u@x', createdAt: '2026-06-22T10:00:00Z' },
    { _id: 'C', seq: 20, subSeq: 0, priority: 2, name: 'c', clientId: 'routine:n', createdAt: '2026-06-21T10:00:00Z' },
  ];
  const p1 = await openTab(URL);
  await p1.waitForLoadState('domcontentloaded');
  await seed(p1, fbs);
  await p1.locator('#mgSortBtn').click();
  await p1.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Per numero' }).click();
  expect(await numOrder(p1)).toEqual(['#30', '#20', '#10']);

  // Riapri la pagina in una nuova tab: la scelta deve essere ricordata.
  const p2 = await openTab(URL);
  await p2.waitForLoadState('domcontentloaded');
  await seed(p2, fbs);
  await expect(p2.locator('#mgSortBtn')).toHaveClass(/mg-sort-btn--active/);
  expect(await numOrder(p2)).toEqual(['#30', '#20', '#10']);
});

test('per creatore: stabile a parità di categoria (raggruppa senza mischiare)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  // Due utenti + due Claude, ordine di partenza noto.
  await seed(page, [
    { _id: 'U1', seq: 50, subSeq: 0, priority: 0, name: 'u1', clientId: 'a@x', createdAt: '2026-06-25T10:00:00Z' },
    { _id: 'K1', seq: 40, subSeq: 0, priority: 0, name: 'k1', clientId: 'agent:one', createdAt: '2026-06-24T10:00:00Z' },
    { _id: 'U2', seq: 30, subSeq: 0, priority: 0, name: 'u2', clientId: 'b@x', createdAt: '2026-06-23T10:00:00Z' },
    { _id: 'K2', seq: 20, subSeq: 0, priority: 0, name: 'k2', clientId: 'routine:two', createdAt: '2026-06-22T10:00:00Z' },
  ]);
  await page.locator('#mgSortBtn').click();
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Per creatore' }).click();
  // utenti (U1,U2) prima dei Claude (K1,K2); dentro ogni gruppo l'ordine di
  // partenza (recenza) è conservato.
  expect(await numOrder(page)).toEqual(['#50', '#30', '#40', '#20']);
});

test('doppio click rapido sul glifo non lascia due menu aperti', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page, [
    { _id: 'A', seq: 10, subSeq: 0, priority: 0, name: 'a', clientId: 'owner:me', createdAt: '2026-06-20T10:00:00Z' },
  ]);
  await page.locator('#mgSortBtn').click();
  await page.locator('#mgSortBtn').click();
  // Al massimo un menu aperto.
  await expect(page.locator('.mg-ctxmenu')).toHaveCount(1);
});

test('screenshot visivo della lista con le quattro icone', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page, [
    { _id: 'A', seq: 10, subSeq: 0, priority: 3, name: 'Owner fb',  clientId: 'owner:me',      createdAt: '2026-06-20T10:00:00Z' },
    { _id: 'B', seq: 30, subSeq: 0, priority: 1, name: 'User fb',   clientId: 'tester@x.com',  createdAt: '2026-06-22T10:00:00Z' },
    { _id: 'C', seq: 20, subSeq: 0, priority: 2, name: 'Claude fb', clientId: 'routine:n',     createdAt: '2026-06-21T10:00:00Z' },
    { _id: 'D', seq:  5, subSeq: 0, priority: 0, name: 'Filo fb',   clientId: 'auto:complaint', createdAt: '2026-06-19T10:00:00Z' },
  ]);
  await expect(page.locator('.mg-item')).toHaveCount(4);
  await page.locator('#mgSortBtn').click();
  await page.screenshot({ path: 'tests/.shots/verify-364-manage.png' });
});
