// Verifica locale di «aspetta #N», giro 3: le schede della sezione Aspettano.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'a-1', name: 'Pratica che aspetta', text: 'Testo.',
    seq: 950, subSeq: 0, status: 'todo', statusPublic: 'open',
    clientId: 'owner:me', senderProof: 'admin',
    createdAt: '2026-10-01T07:00:00Z', images: [],
  }, over);
}

async function apri(page, lista, tab) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const aperti = Array.from({ length: 8 }, (_, i) => fb({ _id: `w-${i}`, seq: 960 + i, name: `Aspettato ${i}` }));

test('r1 una pratica in revisione che aspetta non promette un verificatore che non arriverà', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const rev = fb({ _id: 'r-1', seq: 940, status: 'revision_capability', name: 'In revisione che aspetta', waitsFor: [{ id: 'w-0', num: '960' }] });
  await apri(page, [rev, ...aperti], 'waiting');
  const scheda = page.locator('.mg-item', { hasText: '#940' });
  await expect(scheda).toContainText('#960');
  await page.screenshot({ path: 'tests/.shots/aspetta-g3-r1.png' });
  await expect(scheda).not.toContainText('in attesa di un verificatore');
});

test('r2 una pratica che aspetta otto feedback sta dentro la sua scheda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const otto = fb({ _id: 'o-1', seq: 934, name: 'Aspetta otto', waitsFor: aperti.map((a) => ({ id: a._id, num: String(a.seq) })) });
  await apri(page, [otto, ...aperti], 'waiting');
  const scheda = page.locator('.mg-item', { hasText: '#934' });
  await expect(scheda).toContainText('#960');
  await page.screenshot({ path: 'tests/.shots/aspetta-g3-r2.png' });
  const m = await scheda.evaluate((it) => ({ scheda: it.scrollWidth - it.clientWidth, colonna: it.parentElement.scrollWidth - it.parentElement.clientWidth }));
  expect(m.scheda, 'le attese escono dalla scheda').toBeLessThanOrEqual(0);
  expect(m.colonna, 'la colonna della lista scorre di lato').toBeLessThanOrEqual(0);
});
