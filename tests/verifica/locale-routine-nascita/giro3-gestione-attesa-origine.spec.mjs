// Verifica giro 3 (#914): in Gestione i derivati che seguono l'origine (in attesa, fermi con lei, origine chiusa).
// Porte del giro 2 ri-provate: nessun numero di rilievo.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const OUT = process.env.FILO_G3_SHOTS || '';

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

const pip = (over) => Object.assign({
  l1Category: null, l1Reasons: [], l2Class: null, l2Degraded: false, l2Unfiltered: false,
  expectedJudges: [], missingJudges: [], verdicts: [], action: 'human_review', stage: 'nascita',
  reasons: ['routine_proven'], skipped: 'routine_proven',
}, over);

const derivati = [
  fb({ _id: 'd-att', seq: 9101, subSeq: 1, name: 'Derivato in attesa', status: 'unlabeled', statusReason: 'attesa_origine', clientId: 'routine:residuo', senderProof: 'server',
    pipeline: pip({ reasons: ['routine_proven', 'attesa_origine'], origine: { id: 'o1', num: '#9100', stato: 'aperta' } }) }),
  fb({ _id: 'd-blo', seq: 9102, subSeq: 1, name: 'Derivato bloccato', status: 'design', statusReason: 'origine_bloccata', clientId: 'routine:residuo', senderProof: 'server',
    pipeline: pip({ l1Category: 'dangerous', l1Reasons: ['origine_bloccata'], reasons: ['routine_proven', 'origine_bloccata'], origine: { id: 'o2', num: '#9099', stato: 'bloccata' } }) }),
  fb({ _id: 'd-chi', seq: 9103, subSeq: 1, name: 'Derivato origine chiusa', status: 'aligned', statusReason: 'origine_chiusa', clientId: 'routine:residuo', senderProof: 'server',
    pipeline: pip({ reasons: ['routine_proven', 'origine_chiusa'], origine: { id: 'o3', num: '#9098', stato: 'chiusa' } }) }),
];

test('i derivati che seguono l’origine si presentano per quello che sono', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, derivati, 'inbox');
  const item = (n) => page.locator('.mg-item', { hasText: `#${n}` });
  await expect(page.locator('.mg-item')).toHaveCount(3);
  // Il tasto per ri-giudicare i non filtrati non conta chi aspetta l'origine.
  await expect(page.getByRole('button', { name: /Ri-valuta/ })).toHaveCount(0);
  if (OUT) await page.screenshot({ path: `${OUT}/g3-ricevuti.png` });

  await item(9101).click();
  await page.getByRole('button', { name: 'Filtro d’ingresso' }).click();
  await expect(page.locator('body')).toContainText('Aspetta la fusione di #9100, poi entra in coda da solo.');
  await expect(page.locator('body')).not.toContainText('Non filtrato');
  if (OUT) await page.screenshot({ path: `${OUT}/g3-attesa.png` });

  await item(9102).click();
  await page.getByRole('button', { name: 'Filtro d’ingresso' }).click();
  await expect(page.locator('body')).toContainText('Fermo perché il feedback da cui nasce (#9099) è stato bloccato: decidi tu.');
  if (OUT) await page.screenshot({ path: `${OUT}/g3-bloccato.png` });

  await item(9103).click();
  await page.getByRole('button', { name: 'Filtro d’ingresso' }).click();
  await expect(page.locator('body')).toContainText('Il feedback da cui nasce (#9098) si è chiuso senza fusione: decidi tu.');
  if (OUT) await page.screenshot({ path: `${OUT}/g3-chiuso.png` });
});
