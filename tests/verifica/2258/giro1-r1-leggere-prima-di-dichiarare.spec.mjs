// #2258 giro 1, rilievo 1: «Li ho letti: dichiara fidati» deve lasciar leggere quello che si dichiara: dal riquadro
// della conferma si aprono le modifiche del ramo dell'app e di quello del server rispetto a main.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const RAMO = 'worker/srv-8-20261029T090000Z';
const PUNTA_APP = 'a'.repeat(40);
const PUNTA_SRV = 'b'.repeat(40);

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (!msg || msg.type !== 'fiducia_dichiara') return orig(msg);
      return { ok: true, prova: true, stato: 1, visto: { stato: 1, app: cfg.app, server: cfg.srv }, rami: [
        { repo: 'app', punta: cfg.app, motivo: 'una voce di biglietti non fidati' },
        { repo: 'server', punta: cfg.srv, motivo: 'un buco nel registro' },
      ] };
    };
  }, { app: PUNTA_APP, srv: PUNTA_SRV });
  const fermo = {
    _id: 'srv-8', name: 'Il token del server si rinnova', text: 'Lavoro sul server.', seq: 1160, subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato',
    localOnly: { by: 'owner', at: Date.parse('2026-10-10T08:00:00Z') }, createdAt: '2026-10-10T07:00:00Z', images: [],
    branch: RAMO,
    restaLocale: { motivi: ['ramo non pulito', 'ramo del server non pulito'], ruolo: 'new-work', atMs: Date.parse('2026-11-07T10:00:00Z') },
  };
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [fermo]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.evaluate(() => window.__mgTest.openDetail('srv-8'));
}

test('r1 la conferma di «Dichiara fidato com’è» apre le modifiche dei due rami da leggere', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.locator('#mgDichiaraBtn').click();
  await expect(page.locator('#mgDichiaraSi')).toBeVisible();
  const box = page.locator('#mgWorkState .mg-dichiara');
  await expect(box.locator(`a[href*="github.com/sathyaram1/Filo/"][href*="${RAMO}"]`)).toHaveCount(1);
  await expect(box.locator(`a[href*="github.com/sathyaram1/filo-security/"][href*="${RAMO}"]`)).toHaveCount(1);
});
