// Verifica locale di «aspetta #N», giro 2, rilievo 2: il tasto delle attese cresce coi numeri e spinge fuori vista gli ultimi tasti della fila.
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

// Il main finto risponde dopo `ritardo` ms: le scritture restano in volo quanto serve per sovrapporle.
async function stubMain(page, ritardo = 0) {
  await page.evaluate((ms) => {
    window.__updates = [];
    const NUMERI = { 951: 'b-1', 952: 'c-1', 953: 'd-1', '951.1': 'e-1' };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        if (ms) await new Promise((r) => setTimeout(r, ms));
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
  }, ritardo);
}

async function apri(page, lista, { tab = 'queue', ritardo = 0 } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, ritardo);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);
const altri = () => [
  fb({ _id: 'b-1', seq: 951, name: 'Uno', createdAt: '2026-10-02T07:00:00Z' }),
  fb({ _id: 'c-1', seq: 952, name: 'Due', createdAt: '2026-10-02T08:00:00Z' }),
  fb({ _id: 'd-1', seq: 953, name: 'Tre', createdAt: '2026-10-02T09:00:00Z' }),
];
const sfora = (page) => page.evaluate(() => {
  const el = document.querySelector('#mgOwnerBar .mg-owner-tasti');
  return el ? el.scrollWidth - el.clientWidth : -1;
});

test("dbg", async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const vuota = fb({ _id: 'z-1', seq: 949 });
  const a = fb({ waitsFor: [{ id: 'b-1', num: '951' }, { id: 'c-1', num: '952' }, { id: 'd-1', num: '953' }] });
  await apri(page, [vuota, a, ...altri()]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), vuota._id);
  await expect(page.locator('#mgAtteseToggle')).toBeVisible();
  console.log("DBG", JSON.stringify(await page.evaluate(() => { const b = document.getElementById("mgAtteseToggle"); const cs = getComputedStyle(b); const r = document.querySelector("#mgOwnerBar .mg-owner-tasti"); return { w: b.getBoundingClientRect().width, mw: cs.maxWidth, fs: cs.fontSize, ov: cs.overflow, bs: cs.boxSizing, sw: r.scrollWidth, cw: r.clientWidth, kids: [...r.children].map((c) => c.className + ":" + Math.round(c.getBoundingClientRect().width)) }; })));
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await expect(page.locator('#mgAtteseToggle')).toContainText('#953');
  console.log("DBG", JSON.stringify(await page.evaluate(() => { const b = document.getElementById("mgAtteseToggle"); const cs = getComputedStyle(b); const r = document.querySelector("#mgOwnerBar .mg-owner-tasti"); return { w: b.getBoundingClientRect().width, mw: cs.maxWidth, fs: cs.fontSize, ov: cs.overflow, bs: cs.boxSizing, sw: r.scrollWidth, cw: r.clientWidth, kids: [...r.children].map((c) => c.className + ":" + Math.round(c.getBoundingClientRect().width)) }; })));
});
