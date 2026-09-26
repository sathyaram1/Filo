// Verifica #677, giro 6 — la pagina dei feedback e i ridisegni non chiesti.
//
// Due sonde, stessa causa: la pagina dei feedback ridisegna TUTTO l'elenco
// ogni volta che una parte del contenuto arriva (o riparte), senza guardare
// che cosa l'owner sta facendo in quel momento. La gemella in Gestione quella
// domanda se la fa (ridisegnaRispettandoLaBozza); qui no.

import { test, expect } from './../../fixtures/electron.mjs';

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

const LENTO = {
  _id: 'lento1', _proiezione: true, seq: 801, subSeq: 0, name: 'Lenta',
  text: 'Testo lento', status: 'unlabeled', statusPublic: 'open',
  clientId: 't', createdAt: '2026-09-21T10:00:00.000Z',
};
const CODA = {
  _id: 'coda1', _proiezione: true, seq: 802, subSeq: 0, name: 'In coda',
  text: 'Testo in coda', status: 'todo', statusPublic: 'open',
  clientId: 't', createdAt: '2026-09-22T10:00:00.000Z',
};

// ── Sonda 1 ──────────────────────────────────────────────────────────────
// La sezione che nessuno sta guardando finisce di arrivare MENTRE l'owner
// scrive nella sezione che ha davanti: il ridisegno gli porta via la riga.
test('la sezione che arriva non deve portar via quello che sto scrivendo ADESSO', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  await page.evaluate(({ lento, coda }) => {
    const righe = [lento, coda];
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(righe));
    window.SN_FEEDBACK.getMany = async (ids) => {
      // La sezione dei Ricevuti resta appesa finché non la sblocca la prova:
      // è la finestra in cui l'owner scrive altrove.
      if (ids.includes('lento1')) await new Promise((r) => { window.__sblocca = r; });
      return ids.map((id) => {
        const base = righe.find((x) => x._id === id);
        const { _proiezione, ...resto } = JSON.parse(JSON.stringify(base));
        return { ...resto, notes: `NOTA DI ${id}` };
      });
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setData(JSON.parse(JSON.stringify(righe)));
  }, { lento: LENTO, coda: CODA });

  await page.locator('[data-tab="queue"]').click();
  const nota = page.locator('.fb-card[data-id="coda1"] .fb-notes');
  await expect(nota).toBeVisible({ timeout: 15_000 });

  // L'owner scrive. Non ha ancora finito: la casella si salva da sola dopo
  // una pausa, e la pausa non è passata.
  await nota.click();
  await page.keyboard.type('Questa riga la sto scrivendo adesso');
  const scritto = await nota.inputValue();
  expect(scritto).toContain('Questa riga la sto scrivendo adesso');

  // Arriva la sezione di prima, che nessuno sta guardando.
  await page.evaluate(() => window.__sblocca && window.__sblocca());
  await page.waitForFunction(() => {
    const c = document.querySelector('.fb-card[data-id="lento1"]');
    return true;
  });
  await page.waitForTimeout(700);

  // Quello che l'owner stava scrivendo deve essere ancora lì.
  await expect(nota).toHaveValue(scritto);
});

// ── Sonda 2 ──────────────────────────────────────────────────────────────
// Una scheda sola non è tornata. Il suo «Riprova» non deve portarsi via
// l'intero elenco (né quello che si sta scrivendo in un'altra scheda).
test('il «Riprova» di una scheda non deve svuotare tutto l_elenco', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  await page.evaluate(() => {
    const righe = [
      { _id: 'buono1', _proiezione: true, seq: 811, subSeq: 0, name: 'Questa c_è',
        text: 'Testo buono', status: 'unlabeled', statusPublic: 'open', clientId: 't',
        createdAt: '2026-09-21T10:00:00.000Z' },
      { _id: 'rotto1', _proiezione: true, seq: 812, subSeq: 0, name: 'Questa no',
        text: 'Testo rotto', status: 'unlabeled', statusPublic: 'open', clientId: 't',
        createdAt: '2026-09-22T10:00:00.000Z' },
    ];
    window.__giri = 0;
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(righe));
    window.SN_FEEDBACK.getMany = async (ids) => {
      window.__giri += 1;
      // Al primo giro «rotto1» non torna (sul server non c'è più).
      // Al secondo — quello del «Riprova» — resta appeso.
      if (window.__giri > 1) await new Promise((r) => { window.__sblocca2 = r; });
      return ids.filter((id) => id !== 'rotto1').map((id) => {
        const base = righe.find((x) => x._id === id);
        const { _proiezione, ...resto } = JSON.parse(JSON.stringify(base));
        return { ...resto, notes: `NOTA DI ${id}` };
      });
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setData(JSON.parse(JSON.stringify(righe)));
  });

  const buona = page.locator('.fb-card[data-id="buono1"]');
  await expect(buona).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.fb-card[data-id="rotto1"] .fb-riprova-dettaglio')).toBeVisible();

  // Il «Riprova» della scheda che non è tornata.
  await page.locator('.fb-card[data-id="rotto1"] .fb-riprova-dettaglio').click();
  await page.waitForTimeout(600);

  // L'altra scheda, che era già arrivata per intero, deve restare a schermo.
  await expect(buona).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/677-giro6-riprova-una-scheda.png' });

  await page.evaluate(() => window.__sblocca2 && window.__sblocca2());
});
