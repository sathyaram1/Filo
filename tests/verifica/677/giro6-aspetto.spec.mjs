// Esplorazione visiva del giro 6: la scheda che dice «il resto non è
// arrivato» nella pagina dei feedback, nei due temi.
import { test, expect } from './../../fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';

test('scatto: la scheda che non è tornata, tema chiaro e scuro', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@e.invalid' } };
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
  });
  await page.evaluate(() => {
    const righe = [
      { _id: 'ok1', _proiezione: true, seq: 831, subSeq: 0, name: 'Una che è arrivata',
        text: 'Testo arrivato', status: 'unlabeled', statusPublic: 'open', clientId: 't',
        createdAt: '2026-09-21T10:00:00.000Z' },
      { _id: 'ko1', _proiezione: true, seq: 832, subSeq: 0, name: 'Una che non è arrivata',
        text: 'Testo non arrivato', status: 'unlabeled', statusPublic: 'open', clientId: 't',
        createdAt: '2026-09-22T10:00:00.000Z' },
    ];
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(righe));
    window.SN_FEEDBACK.getMany = async (ids) => ids.filter((id) => id !== 'ko1').map((id) => {
      const base = righe.find((x) => x._id === id);
      const { _proiezione, ...resto } = JSON.parse(JSON.stringify(base));
      return { ...resto, notes: `NOTA DI ${id}` };
    });
    window.__fbTest.setAdmin(true, { email: 'o@e.invalid' });
    window.__fbTest.setData(JSON.parse(JSON.stringify(righe)));
  });
  await expect(page.locator('.fb-card[data-id="ko1"] .fb-riprova-dettaglio')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/677-giro6-scheda-mancata-chiaro.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/677-giro6-scheda-mancata-scuro.png' });

  // Il tasto sta dentro la scheda, non sborda.
  const btn = await page.locator('.fb-card[data-id="ko1"] .fb-riprova-dettaglio').boundingBox();
  const card = await page.locator('.fb-card[data-id="ko1"]').boundingBox();
  expect(btn.x).toBeGreaterThanOrEqual(card.x - 1);
  expect(btn.x + btn.width).toBeLessThanOrEqual(card.x + card.width + 1);
});
