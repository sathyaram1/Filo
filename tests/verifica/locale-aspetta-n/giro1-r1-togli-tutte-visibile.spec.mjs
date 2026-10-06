// Rilievo 1 del giro 1: il tasto che toglie tutte le attese compare anche senza attese.
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
        window.__updates.push(msg);
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

test('r1 «Non aspettare più» non si vede quando il feedback non aspetta niente, né con una sola attesa', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb();
  const b = fb({ _id: 'b-1', seq: 951 });
  await apri(page, [a, b]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await page.locator('#mgAtteseToggle').click();
  await expect(page.locator('#mgAtteseInput')).toBeVisible();
  await expect(page.locator('#mgAtteseTogliTutte')).toBeHidden();

  await page.locator('#mgAtteseInput').fill('951');
  await page.locator('#mgAtteseInput').press('Enter');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(1);
  // Con una sola attesa c'è già la × sulla sua etichetta.
  await expect(page.locator('#mgAtteseTogliTutte')).toBeHidden();
});
