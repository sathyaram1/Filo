// Verifica locale di «aspetta #N», giro 7: un'attesa messa da un'altra strada mentre Gestione è aperta non si perde al gesto dopo.
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

// Il main finto valida come il main vero: legge le attese salvate adesso (`gia`), non quelle che ha la pagina.
async function stubMain(page, salvate) {
  await page.evaluate((ini) => {
    window.__updates = [];
    const ESISTONO = { 951: 'b-1', 952: 'c-1', 953: 'd-1' };
    const stato = new Map(Object.entries(ini));
    window.__stato = stato;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        if (msg.waitsFor !== undefined) {
          const A = window.SN_FB_ATTESE;
          const lette = A.leggiNumeri(msg.waitsFor || '');
          if (!lette.ok) return { ok: false, error: lette.motivo, rifiutato: true };
          const tieni = msg.waitsTieni || [];
          if (!lette.numeri.length && !tieni.length) { stato.set(msg.id, []); return { ok: true, waitsFor: [] }; }
          const v = await A.valida({
            id: msg.id, num: '950', numeri: lette.numeri, gia: stato.get(msg.id) || [], tieni,
            risolvi: async (n) => ESISTONO[n] || null,
            leggiAttese: async (ids) => new Map(ids.map((x) => [x, stato.get(x) || []])),
          });
          if (!v.ok) return { ok: false, error: v.motivo, rifiutato: true };
          stato.set(msg.id, v.attese);
          return { ok: true, waitsFor: v.attese };
        }
        return { ok: true };
      }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  }, salvate);
}

const altri = () => [
  fb({ _id: 'b-1', seq: 951, name: 'Uno', createdAt: '2026-10-02T07:00:00Z' }),
  fb({ _id: 'c-1', seq: 952, name: 'Due', createdAt: '2026-10-02T08:00:00Z' }),
  fb({ _id: 'd-1', seq: 953, name: 'Tre', createdAt: '2026-10-02T09:00:00Z' }),
];

// La pagina ha letto «aspetta #951»; poi una sessione, da riga di comando, ha aggiunto #952 (il salvato ne ha due).
async function apriVecchia(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  const vista = [{ id: 'b-1', num: '951' }];
  const salvato = [{ id: 'b-1', num: '951' }, { id: 'c-1', num: '952' }];
  await stubMain(page, { 'a-1': salvato });
  const a = fb({ waitsFor: vista });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [a, ...altri()]);
  await page.evaluate(() => window.__mgTest.setTab('waiting'));
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await page.locator('#mgAtteseToggle').click();
}

const numeriSalvati = (page) => page.evaluate(() => (window.__stato.get('a-1') || []).map((w) => w.num).sort());

test('r1 un\'attesa nuova scritta in Gestione non toglie quella aggiunta da riga di comando mentre la pagina era aperta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriVecchia(page);
  const input = page.locator('#mgAtteseInput');
  await input.fill('953');
  await input.press('Enter');
  await expect(page.locator('#mgManageMsg')).toContainText('aspetta');
  expect(await numeriSalvati(page)).toEqual(['951', '952', '953']);
});

test('r1 la crocetta su #951 toglie solo #951, non anche #952 aggiunto da riga di comando', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriVecchia(page);
  await page.locator('#mgAtteseLista .mg-attesa').filter({ hasText: '#951' }).locator('.mg-attesa-togli').click();
  await expect(page.locator('#mgManageMsg')).toContainText(/aspetta|non aspetta più/);
  expect(await numeriSalvati(page)).toEqual(['952']);
});
