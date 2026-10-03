// Verifica locale «mittenti provati», giro 2, rilievo 3: nella pagina dei feedback la riga «client:» di chi si era
// dato un nome riservato senza prova non mostra quel nome, e non è uguale per tutti («non-provato:»).
import { test, expect } from '../../fixtures/electron.mjs';

const base = { status: 'unlabeled', priority: 0, text: 'testo', createdAt: '2026-10-01T10:00:00Z' };
const FBS = [
  { _id: 'riscritto-1', seq: 1, name: 'riscritto 1', clientId: 'non-provato:owner:abc-111' },
  { _id: 'riscritto-2', seq: 2, name: 'riscritto 2', clientId: 'non-provato:local:claude' },
  { _id: 'vecchio', seq: 3, name: 'vecchio senza prova', clientId: 'owner:abc-222' },
].map((f) => ({ ...base, ...f }));

test('pagina dei feedback: la riga del mittente senza prova non porta la firma riservata', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK_THREAD);
  await page.evaluate((fbs) => { window.__fbTest.setAdmin(true); window.__fbTest.setData(fbs); }, FBS);
  await expect(page.locator('.fb-card')).toHaveCount(FBS.length);
  for (const f of FBS) {
    const righe = (await page.locator(`.fb-card[data-id="${f._id}"]`).innerText()).split('\n').filter((l) => /^client:/.test(l.trim()));
    for (const r of righe) {
      expect(r.trim(), f.clientId).not.toMatch(/^client:\s*non-provato:?\s*$/);
      expect(r, f.clientId).not.toMatch(/(owner|local|routine|agent):/i);
    }
  }
});
