// Verifica #677, quinto giro: su una macchina che non legge gli stati, la
// pagina dei feedback torna a scaricare tutto insieme.
//
// Senza la chiave privata la barra delle sezioni sparisce e le segnalazioni
// finiscono in un elenco solo. Ma il completamento chiede il documento intero
// di TUTTO l'elenco: con cinquecento segnalazioni sono cinquecento documenti
// interi, allegati compresi, a ogni apertura — esattamente il conto che questo
// lavoro doveva togliere.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';

async function admin(page) {
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => {
      if (m && m.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@e.invalid' } };
      // Nessuna chiave: i campi cifrati tornano come sono arrivati.
      if (m && m.type === 'feedback_decrypt_fields') return { ok: true, list: m.list };
      return orig(m);
    };
  });
}

test('senza la chiave la pagina non chiede il documento intero di tutte le segnalazioni', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  const esito = await page.evaluate(async () => {
    const righe = [];
    for (let i = 0; i < 40; i += 1) {
      righe.push({
        _id: `x${i}`, _proiezione: true, seq: 1000 + i, subSeq: 0,
        name: `Segnalazione ${i}`, text: `testo ${i}`,
        status: 'FENC1:abcdef', statusPublic: 'open',
        clientId: 't', createdAt: `2026-09-${(i % 28) + 1}T10:00:00.000Z`,
      });
    }
    window.__chiesti = [];
    window.__campi = null;
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(righe));
    window.SN_FEEDBACK.getMany = async (ids, opts) => {
      window.__chiesti.push(...ids);
      window.__campi = (opts && opts.fields) || null;
      return ids.map((id) => {
        const { _proiezione, ...resto } = righe.find((x) => x._id === id);
        // Il server torna solo i campi chiesti.
        return { ...resto, images: [], files: [] };
      });
    };
    window.__fbTest.setAdmin(true, { email: 'o@e.invalid' });
    window.__fbTest.setData(JSON.parse(JSON.stringify(righe)));
    await new Promise((r) => setTimeout(r, 1500));
    return {
      chiesti: window.__chiesti.length,
      campi: window.__campi,
      sezioni: !document.getElementById('tabs').hidden,
      schede: document.querySelectorAll('.fb-card').length,
    };
  });

  // L'elenco unico è voluto: gli stati non si leggono. A non esserlo era il
  // conto che ci veniva dietro.
  expect(esito.sezioni).toBe(false);
  expect(esito.schede).toBe(40);
  // La parte che pesa (report, livelli, commento di revisione) non si chiede:
  // senza la chiave la conversazione non comparirebbe comunque.
  expect(Array.isArray(esito.campi), 'il documento intero non va chiesto').toBe(true);
  expect(esito.campi).not.toContain('notes');
  expect(esito.campi).not.toContain('livelli');
  // Gli allegati sì: quelli si vedono anche senza chiave.
  expect(esito.campi).toContain('images');
  expect(esito.campi).toContain('files');
});
