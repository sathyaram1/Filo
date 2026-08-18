// VERIFICA INDIPENDENTE (temporaneo) - stress: la guardia non deve rompere il
// caso normale ne' spostare messaggi d'errore sul feedback sbagliato.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function mk(id, seq, over = {}) {
  return {
    _id: id, text: `TESTO-${id}`, name: `Titolo ${id}`, seq, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-06-22T10:00:00Z', images: [],
    pipeline: {
      action: 'block_attack', l1Category: 'dangerous', l2Class: 'attack', stage: 'L2',
      verdicts: [{ judge: 'A', class: 'attack', reasoning: 'x' }],
      filoSummary: 'attacco', decidedAt: '2026-06-22T10:01:00Z',
    },
    ...over,
  };
}

async function setup(openTab, fbs, { fail = false, delay = 400 } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW && window.filo);
  await page.evaluate(({ d, f }) => {
    const orig = window.filo.message.bind(window.filo);
    window.__updates = [];
    window.filo.message = (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        return new Promise((res) => setTimeout(
          () => res(f ? { ok: false, error: 'ERRORE-FINTO' } : { ok: true }), d));
      }
      return orig(msg);
    };
  }, { d: delay, f: fail });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((list) => { window.__mgTest.setData(list); window.__mgTest.setTab('inbox'); }, fbs);
  return page;
}

async function openItem(page, id) {
  await page.locator(`.mg-item[data-id="${id}"]`).click();
  await expect(page.locator('#mgThread')).toContainText(`TESTO-${id}`);
}

test('NON-REGRESSIONE: senza cambio feedback il pannello si chiude come prima', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101), mk('B', 102)]);
  await openItem(page, 'A');
  await page.locator('#mgArchiveBtn').click();
  await page.waitForTimeout(900);
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('#mgDetailEmpty')).toBeVisible();
  // e il feedback e' davvero uscito dai Ricevuti
  await expect(page.locator('.mg-item[data-id="A"]')).toHaveCount(0);
  await expect(page.locator('.mg-item[data-id="B"]')).toHaveCount(1);
});

test('ERRORE tardivo: il messaggio non finisce sul feedback sbagliato', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101), mk('B', 102)], { fail: true });
  await openItem(page, 'A');
  await page.locator('#mgArchiveBtn').click();
  await openItem(page, 'B');
  await page.waitForTimeout(900);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgThread')).toContainText('TESTO-B');
  await expect(page.locator('#mgManageMsg')).toHaveText('');
  await expect(page.locator('#mgActionMsg')).toHaveText('');
});

test('ERRORE senza cambio feedback: il messaggio si vede', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101), mk('B', 102)], { fail: true });
  await openItem(page, 'A');
  await page.locator('#mgArchiveBtn').click();
  await expect(page.locator('#mgManageMsg')).toContainText('ERRORE-FINTO', { timeout: 5000 });
  await expect(page.locator('#mgDetail')).toBeVisible();
});

test('dopo il salvataggio in background, il pannello di B resta usabile', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101), mk('B', 102)]);
  await openItem(page, 'A');
  await page.locator('#mgAcceptBtn').click();
  await openItem(page, 'B');
  await page.waitForTimeout(900);
  // i controlli di B non sono rimasti disabilitati dal comando precedente
  await expect(page.locator('#mgArchiveBtn')).toBeEnabled();
  await expect(page.locator('#mgAcceptBtn')).toBeEnabled();
  await page.locator('#mgArchiveBtn').click();
  await page.waitForTimeout(900);
  await expect(page.locator('#mgDetail')).toBeHidden();
  expect(await page.evaluate(() => window.__updates.length)).toBe(2);
});

test('doppio clic rapido + cambio feedback', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101), mk('B', 102)]);
  await openItem(page, 'A');
  await page.locator('#mgArchiveBtn').dblclick();
  await openItem(page, 'B');
  await page.waitForTimeout(1200);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgThread')).toContainText('TESTO-B');
});

test('tre feedback: torno su A dopo che la risposta e\' atterrata', async ({ openTab }) => {
  const page = await setup(openTab, [mk('A', 101), mk('B', 102), mk('C', 103)]);
  await openItem(page, 'A');
  await page.locator('#mgArchiveBtn').click();
  await openItem(page, 'C');
  await page.waitForTimeout(900);
  await expect(page.locator('#mgThread')).toContainText('TESTO-C');
  // A e' uscito dai Ricevuti: la lista si e' comunque aggiornata
  await expect(page.locator('.mg-item[data-id="A"]')).toHaveCount(0);
  await page.evaluate(() => window.__mgTest.setTab('archived'));
  await openItem(page, 'A');
  await expect(page.locator('#mgArchiveBtn')).toHaveText('Ripristina');
});
