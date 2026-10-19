// Verifica locale di «aspetta #N», giro 6: la porta del giro 5 in Gestione (un aspettato cancellato non blocca le altre attese).
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'a-1', name: 'Pratica che aspetta', text: 'Testo.',
    seq: 950, subSeq: 0, status: 'design', statusPublic: 'open',
    clientId: 'owner:me', senderProof: 'admin',
    createdAt: '2026-10-01T07:00:00Z', images: [],
  }, over);
}

// Il main finto valida come il main vero: le regole condivise, le attese già scritte, quelle da tenere; #951 è cancellato.
async function stubMain(page, iniziali) {
  await page.evaluate((ini) => {
    window.__updates = [];
    const ESISTONO = { 952: 'c-1', 953: 'd-1' };
    const stato = new Map(Object.entries(ini));
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
  }, iniziali);
}

async function apri(page, lista, iniziali, tab) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, iniziali);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const W = [{ id: 'gone-951', num: '951' }, { id: 'c-1', num: '952' }];
const altri = () => [
  fb({ _id: 'c-1', seq: 952, name: 'Due', status: 'todo', createdAt: '2026-10-02T08:00:00Z' }),
  fb({ _id: 'd-1', seq: 953, name: 'Tre', status: 'todo', createdAt: '2026-10-02T09:00:00Z' }),
];

test('nei Ricevuti, con #951 cancellato, la crocetta di #952 e un\'attesa nuova funzionano e #951 resta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb({ waitsFor: W });
  await apri(page, [a, ...altri()], { 'a-1': W }, 'inbox');
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await page.locator('#mgAtteseToggle').click();
  const lista = page.locator('#mgAtteseLista .mg-attesa');
  await expect(lista).toHaveCount(2);

  await lista.filter({ hasText: '#952' }).locator('.mg-attesa-togli').click();
  await expect(lista).toHaveCount(1);
  await expect(page.locator('#mgAtteseLista')).toContainText('#951');
  await expect(page.locator('#mgManageMsg')).not.toContainText('non esiste');

  const input = page.locator('#mgAtteseInput');
  await input.fill('953');
  await input.press('Enter');
  await expect(lista).toHaveCount(2);
  await expect(page.locator('#mgAtteseLista')).toContainText('#951');
  await expect(page.locator('#mgAtteseLista')).toContainText('#953');

  await lista.filter({ hasText: '#951' }).locator('.mg-attesa-togli').click();
  await expect(lista).toHaveCount(1);
  await expect(page.locator('#mgAtteseLista')).toContainText('#953');
  await expect(page.locator('#mgAtteseLista')).not.toContainText('#951');
});

test('un aspettato non letto dalla pagina resta anche quando se ne aggiunge un altro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const W2 = [{ id: 'fuori-vista', num: '940' }];
  const a = fb({ waitsFor: W2 });
  await apri(page, [a, ...altri()], { 'a-1': W2 }, 'inbox');
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await page.locator('#mgAtteseToggle').click();
  const input = page.locator('#mgAtteseInput');
  await input.fill('952');
  await input.press('Enter');
  const lista = page.locator('#mgAtteseLista .mg-attesa');
  await expect(lista).toHaveCount(2);
  await expect(page.locator('#mgAtteseLista')).toContainText('#940');
  await expect(page.locator('#mgAtteseLista')).toContainText('#952');
});
