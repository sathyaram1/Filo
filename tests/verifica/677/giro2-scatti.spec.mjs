// Esplorazione: cattura lo stato «Caricamento…» delle due pagine, tema chiaro
// e tema scuro. Non asserisce: si guarda.
import { test } from './../../fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';
const PAGINA_GESTIONE = 'filo://manage/manage.html';

for (const tema of ['light', 'dark']) {
  test(`attesa sulla pagina dei feedback — ${tema}`, async ({ openTab }) => {
    const page = await openTab(PAGINA_FEEDBACK);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
    await page.emulateMedia({ colorScheme: tema });
    await page.evaluate(() => {
      const orig = window.filo.message.bind(window.filo);
      window.filo.message = async (msg) => {
        if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@x.invalid' } };
        if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
        return orig(msg);
      };
      const righe = Array.from({ length: 4 }, (_, i) => ({
        _id: `s${i}`, _proiezione: true, seq: 800 + i, subSeq: 0,
        name: `Segnalazione ${i}`, text: `testo ${i}`, status: 'unlabeled',
        statusPublic: 'open', clientId: 'tester-1', createdAt: `2026-09-2${i}T10:00:00.000Z`,
      }));
      window.SN_FEEDBACK.getMany = async () => { await new Promise((r) => setTimeout(r, 30_000)); return []; };
      window.__fbTest.setAdmin(true, { email: 'o@x.invalid' });
      window.__fbTest.setData(righe);
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `tests/.shots/677-feedback-attesa-${tema}.png`, fullPage: false });
  });

  test(`dettaglio in arrivo in Gestione — ${tema}`, async ({ openTab }) => {
    const page = await openTab(PAGINA_GESTIONE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
    await page.emulateMedia({ colorScheme: tema });
    await page.evaluate(() => {
      const orig = window.filo.message.bind(window.filo);
      window.filo.message = async (msg) => {
        if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@x.invalid' } };
        if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
        return orig(msg);
      };
      const riga = {
        _id: 'sg0', _proiezione: true, seq: 810, subSeq: 0,
        name: 'Segnalazione con conversazione lunga', text: 'Il pannello ci mette un attimo.',
        status: 'unlabeled', statusPublic: 'open', clientId: 'tester-1',
        createdAt: '2026-09-22T10:00:00.000Z',
      };
      window.__mgTest.setLiveSources({
        listVersions: async () => [],
        getMany: async () => [],
        getDettagli: async () => { await new Promise((r) => setTimeout(r, 30_000)); return []; },
      });
      window.__mgTest.setAdmin(true);
      window.__mgTest.setData([riga]);
    });
    await page.locator('.mg-item[data-id="sg0"]').click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `tests/.shots/677-gestione-attesa-${tema}.png`, fullPage: false });
  });
}
