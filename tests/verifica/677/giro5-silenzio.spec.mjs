// Verifica #677, quinto giro: quando il resto di una segnalazione non arriva,
// lo schermo non deve dire il falso.
//
// In Gestione la cura del terzo giro lo dice e offre «Riprova». Nella gemella
// — la pagina dei feedback — la scheda si disegna come se la conversazione
// fosse vuota; e in Gestione la fila delle forme dichiara lo stesso l'audit
// «non fatto», che è una risposta inventata su un dato mai letto.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';
const PAGINA_GESTIONE = 'filo://manage/manage.html';

const RIGA = {
  _id: 'fbA', _proiezione: true, seq: 900, subSeq: 0,
  name: 'Segnalazione in lavorazione', text: 'Il testo di chi ha segnalato.',
  status: 'unlabeled', statusPublic: 'open', priority: 2,
  clientId: 'tester-1', createdAt: '2026-09-21T10:00:00.000Z',
};

async function admin(page) {
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => {
      if (m && m.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@e.invalid' } };
      if (m && m.type === 'feedback_decrypt_fields') return { ok: true, list: m.list };
      if (m && m.type === 'feedback_update') return { ok: true };
      return orig(m);
    };
  });
}

test('pagina feedback: una conversazione non arrivata si dice, non si disegna vuota', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await page.evaluate((riga) => {
    window.SN_FEEDBACK.list = async () => [JSON.parse(JSON.stringify(riga))];
    // Il documento non torna (sul server non c'è più, o la risposta lo salta).
    window.SN_FEEDBACK.getMany = async () => [];
    window.__fbTest.setAdmin(true, { email: 'o@e.invalid' });
    window.__fbTest.setData([JSON.parse(JSON.stringify(riga))]);
  }, RIGA);

  const card = page.locator('.fb-card[data-id="fbA"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/677-giro5-silenzio.png', fullPage: true });
  // La gemella dice la stessa cosa con le stesse parole e offre di riprovare.
  await expect(card).toContainText(/non è arrivat/);
});

test('Gestione: col resto non arrivato l_audit non si dichiara «non fatto»', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
  await admin(page);
  await page.evaluate((riga) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [],
      getMany: async () => [],
      getDettagli: async () => { throw new Error('Failed to fetch'); },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([{ ...JSON.parse(JSON.stringify(riga)), status: 'working' }]);
  }, RIGA);

  await page.locator('[data-tab="queue"]').click();
  await page.locator('.mg-item[data-id="fbA"]').click();
  await expect(page.locator('#mgRiprovaDettaglio')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/677-giro5-forme.png' });

  // `livelli` sta fuori dalla proiezione: la fila non lo ha mai letto, quindi
  // non può dire che l'audit non è stato fatto.
  const esiti = await page.evaluate(() => Array.from(document.querySelectorAll('#mgForme .mg-forma'))
    .map((b) => `${b.dataset.livello}:${b.dataset.esito}`));
  expect(esiti).not.toContain('l4:nonfatto');
});
