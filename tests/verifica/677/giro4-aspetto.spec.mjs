// Verifica #677, quarto giro: l'aspetto di quello che il lavoro ha aggiunto al
// pannello di Gestione — la frase «il resto non è arrivato» e il suo «Riprova».
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA_GESTIONE = 'filo://manage/manage.html';

const RIGA = {
  _id: 'fbAsp', _proiezione: true, seq: 910, subSeq: 0,
  name: 'Segnalazione con la conversazione non arrivata',
  text: 'Il testo della segnalazione, come lo ha scritto chi l_ha mandata.',
  status: 'unlabeled', statusPublic: 'open', priority: 2,
  clientId: 'tester-1', createdAt: '2026-09-21T10:00:00.000Z',
};

test('il pannello dice che il resto non è arrivato, e il «Riprova» sta al suo posto', async ({ openTab }) => {
    const page = await openTab(PAGINA_GESTIONE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
    await page.evaluate(() => {
      const orig = window.filo.message.bind(window.filo);
      window.filo.message = async (m) => {
        if (m && m.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@e.invalid' } };
        if (m && m.type === 'feedback_decrypt_fields') return { ok: true, list: m.list };
        return orig(m);
      };
    });
    await page.evaluate((riga) => {
      window.__mgTest.setLiveSources({
        listVersions: async () => [],
        getMany: async () => [],
        getDettagli: async () => { throw new Error('Failed to fetch'); },
      });
      window.__mgTest.setAdmin(true);
      window.__mgTest.setData([JSON.parse(JSON.stringify(riga))]);
    }, RIGA);

    await page.locator('.mg-item[data-id="fbAsp"]').click();
    const riprova = page.locator('#mgRiprovaDettaglio');
    await expect(riprova).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#mgThread')).toContainText('controlla la connessione');
    // Il tasto sta dentro il pannello, non ne esce.
    const box = await riprova.boundingBox();
    const panel = await page.locator('#mgDetail').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(panel.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
    await page.screenshot({ path: 'tests/.shots/677-giro4-riprova.png' });
});
