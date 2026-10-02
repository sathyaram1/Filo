// Esplorazione giro 9: il clic sul mittente nel dettaglio di Gestione.
import { test, expect } from './../../fixtures/electron.mjs';

const base = { status: 'todo', statusPublic: 'open', createdAt: '2026-10-01T09:00:00Z', images: [], text: 'Testo.', notes: '' };
const FBS = [
  { ...base, _id: 'own', seq: 9901, name: 'Dell’owner', clientId: 'owner:me', senderProof: 'admin', localOnly: { by: 'owner', at: 1 } },
  { ...base, _id: 'ses', seq: 9902, name: 'Di una sessione', clientId: 'local:claude', senderProof: 'admin', localOnly: { by: 'local:claude', at: 1 } },
  { ...base, _id: 'ute', seq: 9906, name: 'Di un utente', clientId: 'tester@example.com' },
];

for (const id of ['ute', 'ses', 'own']) {
  test(`clic sul mittente: ${id}`, async ({ openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    const eventi = [];
    page.on('console', (m) => eventi.push(`console.${m.type()}: ${m.text().slice(0, 200)}`));
    page.on('pageerror', (e) => eventi.push(`pageerror: ${String(e).slice(0, 300)}`));
    page.on('crash', () => eventi.push('crash'));
    page.on('close', () => eventi.push('close'));
    page.on('framenavigated', (f) => eventi.push(`nav: ${f.url()}`));
    await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);
    await page.evaluate((x) => window.__mgTest.openDetail(x), id);
    await page.locator('#senderLink').click();
    await page.waitForTimeout(800);
    const vivo = !page.isClosed();
    console.log(id, 'viva:', vivo, JSON.stringify(eventi));
    if (vivo) console.log((await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(-400));
  });
}
