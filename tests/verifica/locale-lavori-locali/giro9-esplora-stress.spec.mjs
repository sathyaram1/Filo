// Esplorazione giro 9: tanti lavori locali, titoli lunghi, markup nel titolo e nel testo, emoji.
import { test, expect } from './../../fixtures/electron.mjs';

const base = { statusPublic: 'open', createdAt: '2026-10-01T09:00:00Z', images: [], notes: '', clientId: 'local:claude', senderProof: 'admin' };
function lista() {
  const out = [];
  for (let i = 0; i < 240; i++) {
    out.push({ ...base, _id: `l${i}`, seq: 5000 + i, status: i % 3 ? 'todo' : 'working', localOnly: { by: 'local:claude', at: 1 },
      name: i === 7 ? '<img src=x onerror="window.__xss=1">Titolo <b>grassetto</b>' : `Lavoro ${i} ` + 'parola '.repeat(i % 5 ? 3 : 40) + '🧵',
      text: i === 7 ? '<script>window.__xss=2</script><img src=x onerror="window.__xss=3">' : `Testo ${i}` });
  }
  out.push({ ...base, _id: 'chiuso', seq: 4999, status: 'done', statusPublic: 'closed', localOnly: { by: 'local:claude', at: 1 }, name: 'Lavoro locale chiuso', text: 'x' });
  return out;
}

test('Lavori locali: 240 voci, markup e titoli lunghi', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); window.__mgTest.setTab('local'); }, lista());
  await expect(page.locator('.mg-tab[data-tab="local"]')).toHaveText('Lavori locali (240)');
  const n = await page.locator('.mg-item').count();
  console.log('voci nella lista', n);
  await page.evaluate(() => window.__mgTest.openDetail('l7'));
  await page.waitForTimeout(300);
  console.log('xss', await page.evaluate(() => window.__xss || 0));
  console.log('titolo', await page.locator('.mg-item').filter({ hasText: 'grassetto' }).first().innerText().catch(() => 'non trovato'));
  await page.screenshot({ path: 'tests/.shots/giro9-stress-local.png' });
  await page.evaluate(() => window.__mgTest.setTab('resolved'));
  console.log('risolti', await page.locator('.mg-tab[data-tab="resolved"]').innerText(), await page.locator('.mg-item').count());
});
