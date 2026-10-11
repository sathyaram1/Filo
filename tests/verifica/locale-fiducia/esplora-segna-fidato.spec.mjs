// Esplorazione del verificatore #1148: «Segna fidato» in Gestione, dal dettaglio e dal tasto destro.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'u-1', name: 'La ricerca non trova le schede vecchie', text: 'Testo di un utente.',
    seq: 4101, subSeq: 0, status: 'todo', statusPublic: 'open',
    clientId: 'utente-abc', createdAt: '2026-10-02T07:00:00Z', images: [], fiducia: 'non_fidato',
  }, over);
}

async function apri(page, lista, tab = 'queue', errore = '', admin = true) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ errore, admin }) => {
    window.__fiducia = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: admin, profile: null };
      if (t === 'fiducia_segna') {
        window.__fiducia.push(msg);
        return errore ? { ok: false, error: errore } : { ok: true, fiducia: msg.fidato === false ? 'non_fidato' : 'fidato' };
      }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  }, { errore, admin });
  await page.evaluate(({ l, admin }) => { window.__mgTest.setAdmin(admin); window.__mgTest.setData(l); }, { l: lista, admin });
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

test('dal dettaglio: segna fidato, poi la toglie, e il tasto lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await page.locator('.mg-item').first().click();
  const btn = page.locator('#mgFiduciaBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('🤝 Segna fidato');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await btn.click();
  await expect(btn).toHaveText('🤝 Fidato');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAttribute('title', /^Fidato: l’hai segnato tu/);
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-1' }]);
  await btn.click();
  await expect(btn).toHaveText('🤝 Segna fidato');
  expect((await page.evaluate(() => window.__fiducia))[1]).toEqual({ type: 'fiducia_segna', feedbackId: 'u-1', fidato: false });
  await page.screenshot({ path: 'tests/.shots/verifica-1148-segna-fidato.png' });
});

test('dal tasto destro: stessa azione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()]);
  await page.locator('.mg-item').first().click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Segna fidato' });
  await expect(voce).toBeVisible();
  await voce.click();
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'u-1' }]);
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.mg-item').first().click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Togli fiducia' })).toBeVisible();
});

test('errore del server: il tasto resta com’era e il messaggio lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], 'queue', 'feedback inesistente');
  await page.locator('.mg-item').first().click();
  const btn = page.locator('#mgFiduciaBtn');
  await btn.click();
  await expect(page.locator('body')).toContainText('feedback inesistente');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toBeEnabled();
});

test('chiusa o non admin: il tasto non c’è; «Fondi senza chiedermelo» non c’è più da nessuna parte', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ status: 'done', statusPublic: 'closed' }), fb({ _id: 'u-2', seq: 4102 })], 'queue');
  await page.evaluate(() => window.__mgTest.openDetail('u-1'));
  await expect(page.locator('#mgFiduciaBtn')).toBeHidden();
  const html = await page.content();
  expect(html).not.toMatch(/senza chiedermelo/i);
  expect(html).not.toMatch(/mgPreapprove/);
});

test('Ricevuti: il feedback di un utente appena arrivato si può segnare fidato da lì', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb({ status: 'aligned' })], 'inbox');
  await page.locator('.mg-item').first().click();
  await expect(page.locator('#mgFiduciaBtn')).toBeVisible();
});
