// Verifica #2036 giro 2, rilievo 1: il «Fermo: resta locale» non promette una ripartenza da sola che non arriva.
// Un registro bucato si sana solo a mano e un contenuto sporco non torna pulito: il passaggio deve dire cosa sblocca.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SEGNO = { by: 'owner@esempio', at: Date.parse('2026-10-10T08:00:00Z') };

function fb(over = {}) {
  return Object.assign({
    _id: 'srv-1', name: 'Il token del server si rinnova', text: 'Lavoro sul server.',
    seq: 1200, subSeq: 0, status: 'revision_security', statusPublic: 'open',
    clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato', localOnly: SEGNO,
    createdAt: '2026-10-10T07:00:00Z', images: [],
  }, over);
}

async function stubAutomazioni(page) {
  await page.evaluate(() => {
    window.__auto = { enabled: false, autoApprove: {}, routinesEnabled: true, lavoriServer: true };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (msg && msg.type === 'automation_get') return Object.assign({ ok: true }, window.__auto);
      return orig(msg);
    };
  });
}

for (const [caso, motivi] of [
  ['registro del ramo bucato', ['ramo non pulito']],
  ['contenuto scritto da un biglietto sporco', ['contenuto scritto da un biglietto sporco']],
]) {
  test(`r1 ${caso}: il fermo non dice che riparte da solo e dice cosa lo sblocca`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await stubAutomazioni(page);
    const fermo = fb({ _id: 'srv-6', seq: 1903, branch: 'worker/srv-6-20261101T090000Z',
      restaLocale: { motivi, ruolo: 'secaudit', atMs: Date.parse('2026-11-01T12:00:00Z') } });
    await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [fermo]);
    await page.evaluate(() => window.__mgTest.setTab('queue'));
    const riga = page.locator('.mg-item[data-id="srv-6"] .mg-attesa-server');
    await expect(riga).toHaveText(/Fermo/);
    const spiega = (await riga.getAttribute('title')) || '';
    expect(spiega).toContain(motivi[0]);
    // Nessuno dei due motivi passa senza un gesto: la promessa lascerebbe il lavoro fermo per sempre.
    expect(spiega).not.toMatch(/riparte da solo/i);
    expect(spiega).toMatch(/sanator|sessione locale|sul tuo PC|in locale/i);
  });
}
