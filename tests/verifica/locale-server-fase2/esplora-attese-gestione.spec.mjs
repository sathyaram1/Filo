// Esplorazione della verifica #1222 (si cancella a fine giro): le tre attese di un lavoro server in Gestione, chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const MANAGE = 'filo://manage/manage.html';
const SHOTS = 'tests/.shots/verifica-1222';

function fb(over = {}) {
  return Object.assign({
    _id: 'srv-1', name: 'Il cancello fonde il server', text: 'Lavoro server.', seq: 1300, subSeq: 0,
    status: 'revision_security', statusPublic: 'open', clientId: 'local:claude', senderProof: 'admin', fiducia: 'fidato',
    localOnly: { by: 'owner@esempio', at: Date.parse('2026-10-13T08:00:00Z') }, createdAt: '2026-10-13T07:00:00Z', images: [],
  }, over);
}

test('esplora: le attese del server in Gestione', async ({ openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      return orig(msg);
    };
  });
  const lista = [
    fb({ _id: 's1', seq: 1301, name: 'Aspetta la suite del server', attesa: 'suite_server', branch: 'worker/s1' }),
    fb({ _id: 's2', seq: 1302, name: 'Server fuso, aspetta la pubblicazione', attesa: 'deploy_server', branch: 'worker/s2' }),
    fb({ _id: 's3', seq: 1303, name: 'Pronto per il PC', attesa: 'fusione_server', branch: 'worker/s3' }),
    fb({ _id: 's4', seq: 1304, name: 'Attesa rimasta fuori revisione', status: 'design', attesa: 'suite_server', branch: 'worker/s4' }),
  ];
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate(() => window.__mgTest.setTab('local'));
  await page.waitForTimeout(500);
  const testi = await page.locator('.mg-item').allInnerTexts();
  console.log('SCHEDE', JSON.stringify(testi));
  await page.screenshot({ path: `${SHOTS}/attese-chiaro.png` });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/attese-scuro.png` });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('.mg-item', { hasText: '#1302' }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/attese-dettaglio.png` });
  const titoli = await page.locator('.mg-attesa-server').evaluateAll((els) => els.map((e) => [e.textContent, e.title]));
  console.log('ATTESE', JSON.stringify(titoli));
  expect(titoli.length).toBeGreaterThan(0);
});
