// STRESS/ADVERSARIALE (verifier) — non da committare.
import { test, expect } from './fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';

const FBS = [
  { _id: 'fb-xss', name: '<img src=x onerror="window.__pwned=1">bad',
    text: 'sezioni owner unica icona', seq: 400, subSeq: 0, status: 'new',
    clientId: 't@e.com', createdAt: '2026-06-01T10:00:00Z', images: [] },
  { _id: 'fb-plain', name: 'Feedback normale',
    text: 'testo semplice sezioni', seq: 401, subSeq: 0, status: 'done',
    clientId: 't@e.com', createdAt: '2026-06-02T10:00:00Z', images: [] },
];

test('XSS: nome/reason con HTML non eseguono e sono escapati', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_SEARCH && window.filo);
  await page.evaluate(() => {
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'ai_request') return { ok: true, text: JSON.stringify([
        { id: 'fb-xss', reason: '<script>window.__pwned2=1</script>' } ]) };
      return { ok: false };
    };
  });
  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('sezioni owner');
  await page.locator('#mgSearchInput').press('Enter');
  await expect(page.locator('.mg-item')).toHaveCount(1);
  // Nessuno script eseguito.
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.evaluate(() => window.__pwned2)).toBeUndefined();
  // Il titolo mostrato è testo, l'onerror non c'è come attributo eseguibile.
  const imgs = await page.locator('.mg-item img[onerror]').count();
  expect(imgs).toBe(0);
});

test('query di soli spazi: nessuna chiamata al modello, resta invito', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => { window.__ai = 0; const o = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => { if (m && m.type === 'ai_request') window.__ai++; return o(m); }; });
  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('     ');
  await page.locator('#mgSearchInput').press('Enter');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__ai)).toBe(0);
  await expect(page.locator('#mgListEmpty')).toBeVisible();
});

test('modello risponde spazzatura → ripiego per parole e lo dichiara', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => { window.filo.message = async (m) =>
    (m && m.type === 'ai_request') ? { ok: true, text: 'ciao non sono json affatto' } : { ok: false }; });
  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('sezioni');
  await page.locator('#mgSearchInput').press('Enter');
  await expect(page.locator('#mgSearchMsg')).toContainText('per testo');
  await expect(page.locator('.mg-item')).toHaveCount(2); // entrambi contengono "sezioni"
});

test('race: due ricerche rapide, vince solo la più recente', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => {
    let call = 0;
    window.filo.message = async (m) => {
      if (m && m.type === 'ai_request') {
        call++;
        const first = call === 1;
        await new Promise((r) => setTimeout(r, first ? 400 : 40));
        return { ok: true, text: JSON.stringify(first ? [{ id: 'fb-plain' }] : [{ id: 'fb-xss' }]) };
      }
      return { ok: false };
    };
  });
  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('prima');
  await page.locator('#mgSearchInput').press('Enter');
  await page.locator('#mgSearchInput').fill('seconda');
  await page.locator('#mgSearchInput').press('Enter');
  await page.waitForTimeout(700);
  // La seconda ricerca (fb-xss) deve prevalere, non la prima in ritardo.
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item').first()).toHaveAttribute('data-id', 'fb-xss');
});
