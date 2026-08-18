// VERIFICA INDIPENDENTE (temporaneo): il pannello di dettaglio non deve chiudersi
// sotto le mani dell'owner quando la risposta di un comando atterra DOPO che ha
// aperto un altro feedback.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function mk(id, seq, over = {}) {
  return {
    _id: id,
    text: `TESTO-${id}`,
    name: `Titolo ${id}`,
    seq,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-06-22T10:00:00Z',
    images: [],
    pipeline: {
      action: 'block_attack',
      l1Category: 'dangerous',
      l2Class: 'attack',
      stage: 'L2',
      verdicts: [{ judge: 'A', class: 'attack', reasoning: 'prompt injection' }],
      filoSummary: 'attacco',
      decidedAt: '2026-06-22T10:01:00Z',
    },
    ...over,
  };
}

// Canale finto: ~400ms di latenza su feedback_update, tutto il resto passa.
async function slowChannel(page, delay = 400) {
  await page.evaluate((d) => {
    const orig = window.filo.message.bind(window.filo);
    window.__updates = [];
    window.filo.message = (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        return new Promise((res) => setTimeout(() => res({ ok: true }), d));
      }
      return orig(msg);
    };
  }, delay);
}

async function setup(openTab, fbs) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW && window.filo);
  await slowChannel(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((list) => { window.__mgTest.setData(list); window.__mgTest.setTab('inbox'); }, fbs);
  return page;
}

// Apre il feedback cliccandolo nella lista, come farebbe l'owner.
async function openItem(page, id) {
  await page.locator(`.mg-item[data-id="${id}"]`).click();
  await expect(page.locator('#mgThread')).toContainText(`TESTO-${id}`);
}

async function assertStillShows(page, id) {
  // La risposta lenta e' ormai atterrata.
  await page.waitForTimeout(900);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgDetailEmpty')).toBeHidden();
  await expect(page.locator('#mgThread')).toContainText(`TESTO-${id}`);
}

test('archivia: il pannello resta sul feedback aperto nel frattempo', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101), mk('B', 102)]);
  await openItem(page, 'A');
  await expect(page.locator('#mgManage')).toBeVisible();
  await page.locator('#mgArchiveBtn').click();
  await openItem(page, 'B');
  await assertStillShows(page, 'B');
  // il comando e' comunque partito
  expect(await page.evaluate(() => window.__updates.length)).toBeGreaterThan(0);
});

test('ripristina (feedback archiviato): idem', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101, { status: 'archived' }), mk('B', 102)]);
  await openItem(page, 'B');           // per far comparire A serve la tab archiviati
  await page.evaluate(() => window.__mgTest.setTab('archived'));
  await openItem(page, 'A');
  await expect(page.locator('#mgArchiveBtn')).toHaveText('Ripristina');
  await page.locator('#mgArchiveBtn').click();
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await openItem(page, 'B');
  await assertStillShows(page, 'B');
});

test('accetta e sblocca: il pannello resta sul feedback aperto nel frattempo', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101), mk('B', 102)]);
  await openItem(page, 'A');
  await expect(page.locator('#mgActions')).toBeVisible();
  await page.locator('#mgAcceptBtn').click();
  await openItem(page, 'B');
  await assertStillShows(page, 'B');
});

test('conferma attacco: il pannello resta sul feedback aperto nel frattempo', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101), mk('B', 102)]);
  await openItem(page, 'A');
  await expect(page.locator('#mgConfirmBtn')).toBeVisible();
  await page.locator('#mgConfirmBtn').click();
  await openItem(page, 'B');
  await assertStillShows(page, 'B');
});

test('risposta a un chiarimento: il pannello resta sul feedback aperto nel frattempo', async ({ openTab }) => {
  const clar = mk('A', 101, { status: 'clarify', pipeline: undefined, notes: '' });
  const page = await setup(openTab, [clar, mk('B', 102)]);
  await openItem(page, 'A');
  await expect(page.locator('#mgClarify')).toBeVisible();
  await page.locator('#mgClarifyText').fill('ecco la mia risposta');
  await page.locator('#mgClarifyBtn').click();
  await openItem(page, 'B');
  await assertStillShows(page, 'B');
});
