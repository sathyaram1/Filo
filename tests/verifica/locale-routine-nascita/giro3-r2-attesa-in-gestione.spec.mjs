// Verifica giro 3 (#914): in Gestione un derivato che aspetta la fusione della sua origine non è un «non
// filtrato» da rimandare ai giudici: il server non lo ri-giudica, quindi il tasto non deve offrirlo.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const OUT = process.env.FILO_G2_SHOTS || '';

function fb(over = {}) {
  return Object.assign({
    name: 'Una pratica', text: 'Testo.', subSeq: 0, statusPublic: 'open',
    createdAt: '2026-10-03T07:00:00Z', images: [],
  }, over);
}

async function apri(page, lista, tab) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

const lista = [
  fb({ _id: 'o-ute', seq: 9100, name: 'Origine utente', status: 'working', clientId: 'utente-x' }),
  fb({
    _id: 'w', seq: 9100, subSeq: 1, parentId: 'o-ute', name: 'Derivato in attesa', status: 'unlabeled',
    statusReason: 'attesa_origine', clientId: 'routine:residuo', senderProof: 'server', origineId: 'o-ute',
    pipeline: { skipped: 'routine_proven', reasons: ['routine_proven', 'attesa_origine'], origine: { id: 'o-ute', num: '#9100', stato: 'aperta' } },
  }),
];

test('r2: un derivato in attesa dell’origine non accende «Ri-valuta i non filtrati» e non si presenta come non filtrato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, lista, 'inbox');
  await expect(page.locator('.mg-item', { hasText: '#9100.1' })).toBeVisible();
  await page.locator('.mg-item', { hasText: '#9100.1' }).click();
  await page.getByRole('button', { name: 'Filtro d’ingresso' }).click();
  await expect(page.locator('body')).toContainText('Aspetta la fusione di #9100, poi entra in coda da solo.');
  if (OUT) await page.screenshot({ path: `${OUT}/g3-attesa.png` });
  await expect(page.getByRole('button', { name: /Ri-valuta i non filtrati/ })).toBeHidden();
  await expect(page.locator('body')).not.toContainText('Non filtrato');
});
