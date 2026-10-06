// Verifica locale di «aspetta #N» in Gestione: si mette, la pratica esce dalla coda, si toglie.
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

async function stubMain(page) {
  await page.evaluate(() => {
    window.__updates = [];
    const NUMERI = { 951: 'b-1', 952: 'c-1', 953: 'd-1' };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg); await new Promise((r) => setTimeout(r, 1500));
        if (msg.waitsFor !== undefined) {
          const lette = window.SN_FB_ATTESE.leggiNumeri(msg.waitsFor || '');
          if (!lette.ok) return { ok: false, error: lette.motivo, rifiutato: true };
          const attese = [];
          for (const n of lette.numeri) {
            if (!NUMERI[n]) return { ok: false, error: `#${n} non esiste`, rifiutato: true };
            attese.push({ id: NUMERI[n], num: n });
          }
          return { ok: true, waitsFor: attese };
        }
        return { ok: true };
      }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
}

async function apri(page, lista, tab = 'queue') {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);

test('due numeri di fila, il secondo prima che torni il primo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb();
  await apri(page, [a, fb({ _id: 'b-1', seq: 951 }), fb({ _id: 'c-1', seq: 952 })]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await page.locator('#mgAtteseToggle').click();
  const input = page.locator('#mgAtteseInput');
  await input.fill('951');
  await input.press('Enter');
  await page.waitForTimeout(200);
  await input.fill('952');
  await input.press('Enter');
  await page.waitForTimeout(4000);
  console.log('UPDATES', JSON.stringify(await page.evaluate(() => window.__updates.map((u) => u.waitsFor))));
  console.log('LISTA', await page.locator('#mgAtteseLista').innerText());
});
