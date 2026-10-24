// Riallineamento di #1575 su main con #1414: il filtro della fiducia e le nuove sezioni Utenti e Impostazioni
// predefinite convivono (il filtro non compare nelle pagine dell'owner, resta acceso tornando ai feedback,
// e un vecchio indirizzo della scheda «Lavori server» non apre niente).
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
const fb = (over) => Object.assign({
  _id: `fb-${over.seq}`, name: `Pratica ${over.seq}`, text: 'Testo.', subSeq: 0,
  status: 'todo', statusPublic: 'open', clientId: 'utente-x', createdAt: '2026-10-10T08:00:00Z', images: [],
}, over);
const FIDATO = { clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' };
const SI = fb({ seq: 911, ...FIDATO });
const NO = fb({ seq: 912, fiducia: 'non_fidato' });
const SERVER = fb({ seq: 913, ...FIDATO, localOnly: { by: 'routine', at: Date.parse('2026-10-17T08:00:00Z') } });

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setReleasedVersion('2.0.0'); }, [SI, NO, SERVER]);
}

test('il filtro della fiducia non entra nelle pagine dell’owner e resta acceso tornando ai feedback', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await apriScheda(page, 'queue');
  await expect(page.locator(`#mgList .mg-item[data-id="${SERVER._id}"] .mg-local-badge`)).toHaveText('server');
  await page.locator('#mgFiduciaFiltro').click();
  await expect(page.locator('#mgList .mg-item')).toHaveCount(1);

  for (const tab of ['utenti', 'predefiniti']) {
    await apriScheda(page, tab);
    await expect(page.locator(`#panel-${tab}`), tab).toHaveClass(/mg-panel--active/);
    await expect(page.locator('#mgFiduciaFiltro'), tab).toBeHidden();
    await expect(page.locator('#mgDomandeFiduciaFiltro'), tab).toBeHidden();
  }
  await apriScheda(page, 'queue');
  await expect(page.locator('#mgFiduciaFiltro')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(1);
  await expect(page.locator(`.mg-tab[data-tab="queue"]`)).toHaveText('In coda (1)');
});

test('un vecchio indirizzo «#local» non apre una scheda che non c’è; «#utenti» sì', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await apriScheda(page, 'queue');
  await page.evaluate(() => { location.hash = '#local'; });
  await page.waitForTimeout(300);
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('.mg-tab[data-tab="local"]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#utenti'; });
  await expect(page.locator('#panel-utenti')).toHaveClass(/mg-panel--active/);
});
