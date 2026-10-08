// Esplorazione del giro 3 (si cancella): revisione che aspetta, venti attese, numeri lunghi, Ricevuti.
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
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') { window.__updates.push(msg); return { ok: true, waitsFor: [] }; }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

async function misura(page) {
  return page.evaluate(() => {
    const t = document.getElementById('mgAtteseToggle');
    const row = t.parentElement;
    const r = row.getBoundingClientRect();
    const vis = [...row.querySelectorAll('button')].filter((b) => !b.hidden && b.offsetParent);
    const last = vis[vis.length - 1];
    const lr = last.getBoundingClientRect();
    return { toggle: t.textContent.trim(), sfora: row.scrollWidth - row.clientWidth, ultimo: last.textContent.trim(), fuori: Math.round(lr.right - r.right), n: vis.length, w: Math.round(r.width) };
  });
}

test('esplora', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const aperti = Array.from({ length: 20 }, (_, i) => fb({ _id: `w-${i}`, seq: 960 + i, subSeq: i % 3 ? 12 : 0, name: `Aspettato ${i}` }));
  const rev = fb({ _id: 'r-1', seq: 940, status: 'revision_capability', name: 'In revisione che aspetta', waitsFor: [{ id: 'w-0', num: '960' }] });
  const venti = fb({ _id: 'v-1', seq: 941, name: 'Venti attese', waitsFor: aperti.map((a) => ({ id: a._id, num: a.subSeq ? `${a.seq}.${a.subSeq}` : String(a.seq) })) });
  const lunghi = fb({ _id: 'l-1', seq: 942, name: 'Tre figli', waitsFor: [{ id: 'w-1', num: '961.12' }, { id: 'w-2', num: '962.12' }, { id: 'w-4', num: '964.12' }] });
  const ric = fb({ _id: 'i-1', seq: 943, status: 'design', statusPublic: 'open', name: 'Nei ricevuti' });
  await apri(page, [rev, venti, lunghi, ric, ...aperti], 'waiting');
  const out = {};
  out.tabs = await page.locator('.mg-tab').allTextContents();
  out.waitingItems = (await page.locator('.mg-item').allTextContents()).map((s) => s.slice(0, 80));
  await page.evaluate(() => window.__mgTest.openDetail('r-1'));
  out.rev = await misura(page);
  out.revLista = await page.locator('#mgAtteseLista .mg-attesa').allTextContents();
  await page.evaluate(() => window.__mgTest.openDetail('v-1'));
  out.venti = await misura(page);
  out.ventiN = await page.locator('#mgAtteseLista .mg-attesa').count();
  await page.screenshot({ path: 'tests/.shots/g3-venti.png' });
  await page.evaluate(() => window.__mgTest.openDetail('l-1'));
  out.lunghi = await misura(page);
  await page.screenshot({ path: 'tests/.shots/g3-lunghi.png' });
  out.etichHtml = await page.locator('#mgAtteseLista .mg-attesa').first().innerHTML();
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate(() => window.__mgTest.openDetail('i-1'));
  out.ric = await misura(page);
  await page.locator('#mgAtteseToggle').click();
  out.ricInputVisibile = await page.locator('#mgAtteseInput').isVisible();
  await page.screenshot({ path: 'tests/.shots/g3-ricevuti.png' });
  console.log('ESPLORA ' + JSON.stringify(out, null, 1));
});
