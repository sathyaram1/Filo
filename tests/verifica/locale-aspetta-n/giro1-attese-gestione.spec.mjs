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

test('dal dettaglio si mette «aspetta #951», la pratica va fra quelle che aspettano, torna in coda a #951 fuso, e si toglie', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb();
  const b = fb({ _id: 'b-1', seq: 951, name: 'Quella da fondere prima', createdAt: '2026-10-02T07:00:00Z' });
  await apri(page, [a, b]);
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (2)');
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);

  const toggle = page.locator('#mgAtteseToggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  const input = page.locator('#mgAtteseInput');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill('aspetta #951');
  await input.press('Enter');

  await expect(page.locator('#mgManageMsg')).toContainText('#951');
  const updates = await page.evaluate(() => window.__updates);
  expect(updates[0]).toMatchObject({ type: 'feedback_update', id: 'a-1', waitsFor: '951' });
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (1)');
  await expect(toggle).toContainText('#951');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(1);
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toContainText('#951');

  for (const tema of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } });
    }, tema);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/aspetta-dettaglio-${tema}.png` });
  }

  // Nella sezione «Aspettano» la scheda dice cosa aspetta.
  await tabBtn(page, 'waiting').click();
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item')).toContainText('#950');
  await page.screenshot({ path: 'tests/.shots/aspetta-sezione.png' });

  // #951 fuso: la pratica torna in coda da sola.
  await page.evaluate((lista) => window.__mgTest.setData(lista), [
    Object.assign({}, a, { waitsFor: [{ id: 'b-1', num: '951' }] }),
    Object.assign({}, b, { status: 'done', resolvedInVersion: '' }),
  ]);
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (0)');

  // Si toglie dalla ×.
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toContainText('fuso');
  await page.locator('#mgAtteseLista .mg-attesa-togli').click();
  await expect(page.locator('#mgManageMsg')).toContainText('non aspetta più');
  const dopo = await page.evaluate(() => window.__updates);
  expect(dopo[dopo.length - 1]).toMatchObject({ id: 'a-1', waitsFor: '' });
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(0);
});

test('tasto destro: aspetta e non aspettare più; e i rifiuti si leggono', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb();
  const b = fb({ _id: 'b-1', seq: 951 });
  const c = fb({ _id: 'c-1', seq: 952 });
  await apri(page, [a, b, c]);
  await page.locator('.mg-item', { hasText: '#950' }).click({ button: 'right' });
  const menu = page.locator('.mg-ctxmenu');
  await menu.locator('.sn-select-option', { hasText: 'Aspetta un altro feedback' }).click();
  const input = page.locator('#mgAtteseInput');
  await expect(input).toBeFocused();

  await input.fill('abc');
  await input.press('Enter');
  await expect(page.locator('#mgManageMsg')).toContainText('non è un numero');
  await input.fill(Array.from({ length: 21 }, (_, i) => 900 + i).join(','));
  await input.press('Enter');
  await expect(page.locator('#mgManageMsg')).toContainText('al più 20');
  await input.fill('99999');
  await input.press('Enter');
  await expect(page.locator('#mgManageMsg')).toContainText('non esiste');
  await input.fill('<img src=x onerror=alert(1)>');
  await input.press('Enter');
  await expect(page.locator('#mgManageMsg')).toContainText('non è un numero');
  await expect(page.locator('#mgManageMsg img')).toHaveCount(0);

  await input.fill('951, 952');
  await input.press('Enter');
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (1)');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(2);
  // Aggiungere un terzo tiene i primi due.
  await input.fill('953');
  await input.press('Enter');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(3);
  const ult = (await page.evaluate(() => window.__updates)).pop();
  expect(ult.waitsFor).toBe('951, 952, 953');

  await tabBtn(page, 'waiting').click();
  await page.locator('.mg-item', { hasText: '#950' }).click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Non aspettare più' }).click();
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (0)');
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (3)');
});
