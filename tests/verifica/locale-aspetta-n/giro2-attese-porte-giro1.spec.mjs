// Verifica locale di «aspetta #N», giro 2: le porte del giro 1 ri-provate (tasto per tutte, scritture in volo) e i casi di stress.
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

test('«Non aspettare più» compare solo da due attese in su', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb();
  await apri(page, [a, ...altri()]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await page.locator('#mgAtteseToggle').click();
  const input = page.locator('#mgAtteseInput');
  const tutte = page.locator('#mgAtteseTogliTutte');
  await expect(input).toBeVisible();
  await expect(tutte).toBeHidden();
  await input.fill('951');
  await input.press('Enter');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(1);
  await expect(tutte).toBeHidden();
  await input.fill('952');
  await input.press('Enter');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(2);
  await expect(tutte).toBeVisible();
  await tutte.click();
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(0);
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (0)');
});

test('due attese scritte in fretta, e una crocetta durante un\'aggiunta in volo, restano tutte', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb();
  await apri(page, [a, ...altri()], { ritardo: 900 });
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await page.locator('#mgAtteseToggle').click();
  const input = page.locator('#mgAtteseInput');
  await input.fill('951');
  await input.press('Enter');
  await input.fill('952');
  await input.press('Enter');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(2, { timeout: 8000 });
  await expect(page.locator('#mgAtteseLista')).toContainText('#951');
  await expect(page.locator('#mgAtteseLista')).toContainText('#952');

  // Aggiunta di #953 in volo, e intanto si toglie #951: alla fine aspetta #952 e #953.
  await input.fill('953');
  await input.press('Enter');
  await page.locator('#mgAtteseLista .mg-attesa', { hasText: '#951' }).locator('.mg-attesa-togli').click();
  await page.waitForFunction(() => window.__updates.length >= 4, null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  const ult = (await page.evaluate(() => window.__updates)).pop();
  expect(ult.waitsFor).toBe('952, 953');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(2);
  await expect(page.locator('#mgAtteseLista')).not.toContainText('#951');
});

test('scritture insolite: parole fra i numeri, un figlio, emoji, spazi, doppioni', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb();
  await apri(page, [a, ...altri(), fb({ _id: 'e-1', seq: 951, subSeq: 1, name: 'Figlio' })]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await page.locator('#mgAtteseToggle').click();
  const input = page.locator('#mgAtteseInput');

  await input.fill('     ');
  await input.press('Enter');
  expect(await page.evaluate(() => window.__updates.length)).toBe(0);

  await input.fill('🙂');
  await input.press('Enter');
  await expect(page.locator('#mgManageMsg')).toContainText('non è un numero');
  await expect(input).toHaveValue('🙂');

  await input.fill('aspetta #951.1 e #952, 952 ;  #951.1');
  await input.press('Enter');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(2);
  await expect(page.locator('#mgAtteseLista')).toContainText('#951.1');
  await expect(page.locator('#mgAtteseLista')).toContainText('#952');
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (1)');
});

test('lo stato di ciascun aspettato si legge: in coda, chiuso senza fusione, fuso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb({ waitsFor: [{ id: 'b-1', num: '951' }, { id: 'c-1', num: '952' }, { id: 'd-1', num: '953' }] });
  await apri(page, [
    a,
    fb({ _id: 'b-1', seq: 951 }),
    fb({ _id: 'c-1', seq: 952, status: 'archived', statusPublic: 'closed' }),
    fb({ _id: 'd-1', seq: 953, status: 'archived', statusPublic: 'closed', resolvedInVersion: '0.2.230' }),
  ]);
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (1)');
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  const righe = page.locator('#mgAtteseLista .mg-attesa');
  await expect(righe).toHaveCount(3);
  await expect(righe.nth(1)).toContainText('chiuso senza fusione');
  await expect(righe.nth(2)).toContainText('fuso');
  await expect(righe.nth(0)).not.toContainText('fuso');
  await page.screenshot({ path: 'tests/.shots/aspetta-stati.png' });
});
