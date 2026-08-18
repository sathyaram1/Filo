// SPEC DI VERIFICA INDIPENDENTE, parte 2 (temporaneo).
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FBS = [
  { _id: 'fb-a', name: 'Titolo A', text: 'Testo A', seq: 401, subSeq: 0,
    status: 'new', clientId: 'tizio@example.com', createdAt: '2026-06-01T10:00:00Z', images: [],
    userNote: 'FRASE-A' },
  { _id: 'fb-b', name: 'Titolo B', text: 'Testo B', seq: 402, subSeq: 0,
    status: 'new', clientId: 'caio@example.com', createdAt: '2026-06-02T10:00:00Z', images: [],
    userNote: 'FRASE-B' },
  { _id: 'fb-queue', name: 'In lavorazione', text: 'Testo Q', seq: 403, subSeq: 0,
    status: 'working', clientId: 'tizio@example.com', createdAt: '2026-06-03T10:00:00Z', images: [] },
  { _id: 'fb-arch', name: 'Archiviato', text: 'Testo R', seq: 404, subSeq: 0,
    status: 'archived', clientId: 'tizio@example.com', createdAt: '2026-06-04T10:00:00Z', images: [] },
  { _id: 'fb-nokey', name: 'Report cifrato', text: 'Testo K', seq: 405, subSeq: 0,
    status: 'done', clientId: 'tizio@example.com', createdAt: '2026-05-01T10:00:00Z', images: [],
    notes: 'FENC1:AAAABBBBCCCCDDDD==', userNote: 'la frase in chiaro' },
];

async function boot(openTab, { delay = 0, tab = 'inbox' } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate((d) => {
    window.__sent = [];
    window.filo.message = async (msg) => {
      window.__sent.push(JSON.parse(JSON.stringify(msg)));
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true };
      if (d) await new Promise((r) => setTimeout(r, d));
      return { ok: true };
    };
  }, delay);
  await page.evaluate(([t, fbs]) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab(t);
  }, [tab, FBS]);
  return page;
}

const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.type === 'feedback_update'));

test('A. salvataggio LENTO + l-owner passa a un altro feedback: la casella e la conversazione devono seguire il feedback aperto', async ({ openTab }) => {
  const page = await boot(openTab, { delay: 1500 });
  await page.click('.mg-item[data-id="fb-a"]');
  await page.fill('#mgUserNoteText', 'frase-nuova-per-A');
  await page.click('#mgUserNoteBtn');           // parte il salvataggio lento
  await page.click('.mg-item[data-id="fb-b"]'); // l-owner intanto apre B
  await expect(page.locator('#mgUserNoteText')).toHaveValue('FRASE-B');
  await page.waitForTimeout(2500);              // il salvataggio di A atterra

  // Il feedback aperto e ancora B: la casella deve mostrare la frase di B,
  // non quella appena salvata su A.
  const titolo = await page.locator('#mgDetail').innerText();
  expect(titolo).toContain('Titolo B');
  await expect(page.locator('#mgUserNoteText')).toHaveValue('FRASE-B');

  // E se ora salva, deve salvare su B (non riscrivere A).
  await page.fill('#mgUserNoteText', 'seconda-frase-B');
  await page.click('#mgUserNoteBtn');
  await page.waitForTimeout(2500);
  const msgs = await sent(page);
  expect(msgs[msgs.length - 1]).toMatchObject({ id: 'fb-b', userNote: 'seconda-frase-B' });
});

test('B. la casella c-e su TUTTE le schede da cui si lavora (In coda, Archiviati)', async ({ openTab }) => {
  const page = await boot(openTab, { tab: 'queue' });
  await page.click('.mg-item[data-id="fb-queue"]');
  await expect(page.locator('#mgUserNote')).toBeVisible();
  await page.fill('#mgUserNoteText', 'frase in coda');
  await page.click('#mgUserNoteBtn');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText(/salvata/i);

  await page.evaluate(() => window.__mgTest.setTab('archived'));
  await page.click('.mg-item[data-id="fb-arch"]');
  await expect(page.locator('#mgUserNote')).toBeVisible();
  await page.fill('#mgUserNoteText', 'frase archiviata');
  await page.click('#mgUserNoteBtn');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText(/salvata/i);
  const msgs = await sent(page);
  expect(msgs.map((m) => m.id)).toEqual(['fb-queue', 'fb-arch']);
});

test('C. senza chiave privata: la conversazione e illeggibile ma la frase si legge e si riscrive', async ({ openTab }) => {
  const page = await boot(openTab, { tab: 'resolved' });
  await page.click('.mg-item[data-id="fb-nokey"]');
  const thread = await page.locator('#mgThread').innerText();
  expect(thread).toContain('la frase in chiaro');     // la frase e visibile nella conversazione
  expect(thread).toMatch(/cifrat|chiave/i);           // il report no
  await expect(page.locator('#mgUserNoteText')).toHaveValue('la frase in chiaro');
  await page.fill('#mgUserNoteText', 'frase riscritta senza chiave');
  await page.click('#mgUserNoteBtn');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText(/salvata/i);
  // La conversazione deve rispecchiare subito la frase nuova.
  await expect(page.locator('#mgThread')).toContainText('frase riscritta senza chiave');
});

test('D. salvataggio fallito: non deve dire "salvata" ne bruciare il testo', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.evaluate(() => {
    window.filo.message = async (msg) => {
      window.__sent.push(JSON.parse(JSON.stringify(msg)));
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true };
      return { ok: false, error: 'permesso negato dal server' };
    };
  });
  await page.click('.mg-item[data-id="fb-a"]');
  await page.fill('#mgUserNoteText', 'testo che non deve andare perso');
  await page.click('#mgUserNoteBtn');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText(/permesso negato|errore/i);
  await expect(page.locator('#mgUserNoteText')).toHaveValue('testo che non deve andare perso');
  // Il bottone deve tornare cliccabile per riprovare.
  await expect(page.locator('#mgUserNoteBtn')).toBeEnabled();
});

test('E. dai risultati della ricerca: la casella segue il feedback aperto dal risultato', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', 'Titolo B');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const results = page.locator('.mg-item[data-id="fb-b"]');
  if (await results.count()) {
    await results.first().click();
    await expect(page.locator('#mgUserNote')).toBeVisible();
    await expect(page.locator('#mgUserNoteText')).toHaveValue('FRASE-B');
  }
});
