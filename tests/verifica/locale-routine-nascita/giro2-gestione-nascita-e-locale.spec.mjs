// Verifica giro 2 (#914): in Gestione la frase sul ritorno «richiede lavoro locale» segue il mittente, e i
// feedback nati senza giudici dicono perché. Porte del giro 1 ri-provate: nessun numero di rilievo.
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

const ritorni = [
  fb({ _id: 'r-own', seq: 9001, name: 'Owner rimandato', status: 'design', statusReason: 'locale', clientId: 'owner:abc', senderProof: 'admin' }),
  fb({ _id: 'r-rou', seq: 9002, name: 'Routine rimandato', status: 'design', statusReason: 'locale', clientId: 'routine:verifier', senderProof: 'server' }),
  fb({ _id: 'r-ute', seq: 9003, name: 'Utente rimandato', status: 'design', statusReason: 'locale', clientId: 'utente-x' }),
  fb({ _id: 'n-rou', seq: 9004, name: 'Derivato di una routine', status: 'aligned', clientId: 'routine:verifier', senderProof: 'server', pipeline: { skipped: 'routine_proven' } }),
];

test('il ritorno «richiede lavoro locale» dice la cosa giusta per ogni mittente', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, ritorni, 'inbox');
  const item = (n) => page.locator('.mg-item', { hasText: `#${n}` });
  await expect(page.locator('.mg-item')).toHaveCount(4);

  await item(9001).click();
  await expect(page.locator('body')).toContainText('con «Solo lavoro locale» la prende una sessione sulla tua macchina');
  await expect(page.locator('body')).not.toContainText('in locale i feedback degli utenti non si lavorano');
  if (OUT) await page.screenshot({ path: `${OUT}/g2-owner-locale.png` });

  await item(9002).click();
  await expect(page.locator('body')).toContainText('l’ha aperto una routine e non si segna solo in locale');
  if (OUT) await page.screenshot({ path: `${OUT}/g2-routine-locale.png` });

  await item(9003).click();
  await expect(page.locator('body')).toContainText('in locale i feedback degli utenti non si lavorano');

  await item(9004).click();
  await expect(page.locator('body')).toContainText('Aperto da una routine, con la prova del server. I giudici non servono.');
  if (OUT) await page.screenshot({ path: `${OUT}/g2-derivato.png` });
});
