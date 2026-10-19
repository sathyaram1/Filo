// Verifica locale di «aspetta #N», giro 3: la porta del giro 2 sulla fila dei tasti del dettaglio, ri-provata.
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

// La fila che contiene il tasto delle attese: sfora se il contenuto è più largo del box, e l'ultimo tasto visibile deve stare dentro.
async function misura(page) {
  return page.evaluate(() => {
    const t = document.getElementById('mgAtteseToggle');
    let row = t.parentElement;
    const r = row.getBoundingClientRect();
    const vis = [...row.querySelectorAll('button')].filter((b) => !b.hidden && b.offsetParent);
    const last = vis[vis.length - 1];
    const lr = last.getBoundingClientRect();
    return { sfora: row.scrollWidth - row.clientWidth, ultimo: last.textContent.trim(), fuori: Math.round(lr.right - r.right), tops: [...new Set(vis.map((b) => Math.round(b.getBoundingClientRect().top)))].length };
  });
}

const altri = (stato = {}) => [
  fb({ _id: 'b-1', seq: 951, name: 'Uno', ...stato }),
  fb({ _id: 'c-1', seq: 952, name: 'Due', ...stato }),
  fb({ _id: 'd-1', seq: 953, name: 'Tre', ...stato }),
];
const tre = [{ id: 'b-1', num: '951' }, { id: 'c-1', num: '952' }, { id: 'd-1', num: '953' }];

test('con tre attese la fila dei tasti del dettaglio sta intera come senza attese', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const senza = fb({ _id: 'z-1', seq: 949, name: 'Senza attese' });
  const con = fb({ waitsFor: tre });
  await apri(page, [senza, con, ...altri()], 'queue');
  await page.evaluate(() => window.__mgTest.openDetail('z-1'));
  const m0 = await misura(page);
  await page.evaluate(() => window.__mgTest.setTab('waiting'));
  await page.evaluate(() => window.__mgTest.openDetail('a-1'));
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(3);
  const m3 = await misura(page);
  await page.screenshot({ path: 'tests/.shots/aspetta-g3-fila.png' });
  expect(m0.sfora).toBeLessThanOrEqual(0);
  expect(m3.sfora, 'la fila con tre attese sfora').toBeLessThanOrEqual(0);
  expect(m3.fuori, `«${m3.ultimo}» tagliato`).toBeLessThanOrEqual(0);
  expect(m3.tops).toBe(1);
});
