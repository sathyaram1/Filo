// Verifica #677, quarto giro: le porte della stessa causa dei giri passati.
//
// Quello che resta qui è il caso chiuso: un ridisegno che l'owner non ha
// chiesto non porta via quello che sta scrivendo. Il ridisegno arriva dal
// completamento di una sezione che nel frattempo non è più quella aperta.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';

async function admin(page) {
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.invalid' } };
      }
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      if (msg && msg.type === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
}

test('la sezione che finisce di arrivare non cancella quello che scrivo nell_altra', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  await page.evaluate(() => {
    const righe = [
      { _id: 'lento1', _proiezione: true, seq: 801, subSeq: 0, name: 'Lenta', text: 'Testo lento',
        status: 'unlabeled', statusPublic: 'open', clientId: 't', createdAt: '2026-09-21T10:00:00.000Z' },
      { _id: 'coda1', _proiezione: true, seq: 802, subSeq: 0, name: 'In coda', text: 'Testo in coda',
        status: 'todo', statusPublic: 'open', clientId: 't', createdAt: '2026-09-22T10:00:00.000Z' },
    ];
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(righe));
    window.SN_FEEDBACK.getMany = async (ids) => {
      // I Ricevuti arrivano con molto comodo: è la finestra in cui l'owner
      // passa a un'altra sezione e si mette a scrivere.
      if (ids.includes('lento1')) await new Promise((r) => setTimeout(r, 4000));
      return ids.map((id) => {
        const base = righe.find((x) => x._id === id);
        const { _proiezione, ...resto } = base;
        return { ...resto, notes: `NOTA DI ${id}` };
      });
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setData(JSON.parse(JSON.stringify(righe)));
  });

  // Mentre i Ricevuti arrivano, passo a «In coda»: quella sezione c'è subito.
  await page.locator('[data-tab="queue"]').click();
  const nota = page.locator('.fb-card[data-id="coda1"] .fb-notes');
  await expect(nota).toBeVisible({ timeout: 15_000 });
  await nota.fill('Sto scrivendo la mia nota di lavorazione.');

  // Arriva la sezione di prima, che nessuno sta guardando.
  await page.waitForTimeout(5000);
  await expect(nota).toHaveValue('Sto scrivendo la mia nota di lavorazione.');
  // E la sezione di prima è arrivata davvero: senza questo la prova sarebbe
  // verde perché non è successo niente.
  await page.locator('[data-tab="inbox"]').click();
  await expect(page.locator('.fb-card[data-id="lento1"] .fb-notes')).toHaveValue('NOTA DI lento1', { timeout: 10_000 });
});
