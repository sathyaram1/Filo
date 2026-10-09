// Verifica locale di «aspetta #N», giro 5: con un aspettato cancellato le altre attese non si toccano più.
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

// Il main vero risolve ogni numero dell'elenco riscritto: #951, cancellato, non esiste più.
async function apri(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const NUMERI = { 952: 'c-1', 953: 'd-1' };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update' && msg.waitsFor !== undefined) {
        window.__updates.push(msg);
        const lette = window.SN_FB_ATTESE.leggiNumeri(msg.waitsFor || '');
        if (!lette.ok) return { ok: false, error: lette.motivo, rifiutato: true };
        const attese = [];
        for (const n of lette.numeri) {
          if (!NUMERI[n]) return { ok: false, error: `#${n} non esiste`, rifiutato: true };
          attese.push({ id: NUMERI[n], num: n });
        }
        return { ok: true, waitsFor: attese };
      }
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
}

test('r2 con un aspettato cancellato si toglie un\'altra attesa e se ne aggiunge una nuova', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = fb({ waitsFor: [{ id: 'cancellato-1', num: '951' }, { id: 'c-1', num: '952' }] });
  await apri(page, [a, fb({ _id: 'c-1', seq: 952, name: 'Ancora aperto', status: 'todo' }), fb({ _id: 'd-1', seq: 953, name: 'Altro', status: 'todo' })]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), a._id);
  const righe = page.locator('#mgAtteseLista .mg-attesa');
  await expect(righe).toHaveCount(2);

  // La crocetta di #952: l'owner vuole togliere solo quella.
  await righe.filter({ hasText: '#952' }).locator('.mg-attesa-togli').click();
  await expect(page.locator('#mgManageMsg')).not.toContainText('Tolgo', { timeout: 10000 });
  await expect(page.locator('#mgManageMsg')).not.toContainText('non esiste');
  await expect(righe.filter({ hasText: '#952' })).toHaveCount(0);

  // Un'attesa nuova accanto a quella sul cancellato.
  await page.locator('#mgAtteseInput').fill('953');
  await page.locator('#mgAtteseInput').press('Enter');
  await expect(page.locator('#mgManageMsg')).not.toContainText('non esiste');
  await expect(righe.filter({ hasText: '#953' })).toHaveCount(1);
});
