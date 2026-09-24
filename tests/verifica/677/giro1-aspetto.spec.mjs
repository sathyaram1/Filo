// Esplorazione visiva del giro 1 — si cancella dopo aver guardato.
import { test } from '../../fixtures/electron.mjs';

test('come si vede l\'attesa della sezione', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@x.invalid' } };
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.SN_FEEDBACK.getMany = async () => { await new Promise((r) => setTimeout(r, 30000)); return []; };
    window.__fbTest.setAdmin(true, { email: 'o@x.invalid' });
    window.__fbTest.setData([{
      _id: 'a', _proiezione: true, seq: 700, subSeq: 0, name: 'Una segnalazione',
      text: 'testo', status: 'unlabeled', statusPublic: 'open', clientId: 'c',
      createdAt: '2026-09-20T10:00:00.000Z',
    }]);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/677-attesa-chiaro.png', fullPage: false });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/677-attesa-scuro.png', fullPage: false });
});
