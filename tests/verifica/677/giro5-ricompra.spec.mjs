// Verifica #677, quinto giro: quello che è già stato scaricato non si butta.
//
// Una causa sola: la riga riletta dal giro al minuto (una proiezione: niente
// conversazione, niente allegati) prendeva il posto del documento intero già
// in mano, e con lui se ne andava anche la nota «questa lettura non è
// tornata». Da lì il pannello si svuotava e la pagina ricomprava.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA_GESTIONE = 'filo://manage/manage.html';
const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';

const RIGA = {
  _id: 'fbA', _proiezione: true, _updateTime: 'v1', seq: 900, subSeq: 0,
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

test('Gestione: il giro al minuto non svuota il pannello che si sta leggendo', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
  await admin(page);
  await page.evaluate((r) => {
    window.__ver = 'v1';
    window.__report = 'PRIMO GIRO DELLA LAVORAZIONE';
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: r._id, _updateTime: window.__ver }],
      getMany: async (ids) => ids.map(() => ({
        ...JSON.parse(JSON.stringify(r)), _updateTime: window.__ver, _proiezione: true,
      })),
      getDettagli: async (ids) => {
        // La rete ci mette il suo: è la finestra in cui il pannello si
        // svuotava e l'owner perdeva di vista il report.
        await new Promise((ok) => setTimeout(ok, 1500));
        const pieno = JSON.parse(JSON.stringify(r));
        delete pieno._proiezione;
        pieno.notes = window.__report;
        pieno._updateTime = window.__ver;
        return ids.map(() => pieno);
      },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([JSON.parse(JSON.stringify(r))]);
  }, RIGA);

  await page.locator('.mg-item[data-id="fbA"]').click();
  await expect(page.locator('#mgThread')).toContainText('PRIMO GIRO DELLA LAVORAZIONE', { timeout: 20_000 });

  // La routine scrive un altro turno: il giro al minuto trova la segnalazione
  // cambiata, come succede a ogni passaggio finché ci sta lavorando.
  await page.evaluate(async () => {
    window.__ver = 'v2';
    window.__report = 'PRIMO GIRO DELLA LAVORAZIONE\n--- Filo ---\nSECONDO GIRO';
    window.__mgTest.pollNow();
  });

  // Mentre il nuovo documento viaggia, il report resta sotto gli occhi.
  for (let i = 0; i < 6; i += 1) {
    const testo = await page.locator('#mgThread').textContent();
    expect(testo, 'il report non deve sparire durante l_aggiornamento').toContain('PRIMO GIRO');
    expect(testo).not.toContain('Caricamento della conversazione');
    await page.waitForTimeout(250);
  }
  // E il turno nuovo arriva.
  await expect(page.locator('#mgThread')).toContainText('SECONDO GIRO', { timeout: 20_000 });
});

test('Gestione: dopo un giro al minuto una lettura già fallita resta tale', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
  await admin(page);
  await page.evaluate((r) => {
    window.__dettagli = 0;
    window.__ver = 'v1';
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: r._id, _updateTime: window.__ver }],
      getMany: async (ids) => ids.map(() => ({
        ...JSON.parse(JSON.stringify(r)), _updateTime: window.__ver, _proiezione: true,
      })),
      getDettagli: async () => { window.__dettagli += 1; throw new Error('Failed to fetch'); },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([JSON.parse(JSON.stringify(r))]);
  }, RIGA);

  await page.locator('.mg-item[data-id="fbA"]').click();
  await expect(page.locator('#mgRiprovaDettaglio')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);

  // Andata e ritorno: la lettura non riparte. È la cura del terzo giro.
  await page.evaluate(() => window.__mgTest.openDetail('fbA'));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);

  // Un giro al minuto in mezzo non la deve rimettere in circolo: il tasto
  // «Riprova» è l'unica strada, ed è di chi guarda.
  await page.evaluate(async () => { window.__ver = 'v2'; await window.__mgTest.pollNow(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__mgTest.openDetail('fbA'));
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);

  // E il «Riprova» funziona ancora.
  await page.locator('#mgRiprovaDettaglio').click();
  await expect.poll(() => page.evaluate(() => window.__dettagli), { timeout: 10_000 }).toBe(2);
});

test('pagina feedback: con la rete giù i gesti non ricomprano la lettura fallita', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await page.evaluate((riga) => {
    window.__n = 0;
    window.SN_FEEDBACK.list = async () => [JSON.parse(JSON.stringify(riga))];
    window.SN_FEEDBACK.getMany = async () => { window.__n += 1; throw new Error('Failed to fetch'); };
    window.__fbTest.setAdmin(true, { email: 'o@e.invalid' });
    window.__fbTest.setData([JSON.parse(JSON.stringify(riga))]);
  }, RIGA);

  await expect(page.locator('.fb-load-retry')).toBeVisible({ timeout: 15_000 });
  const primo = await page.evaluate(() => window.__n);

  // Senza premere «Riprova»: si scrive nella ricerca e si cambia sezione.
  await page.locator('#search').fill('abc');
  await page.waitForTimeout(1000);
  await page.locator('[data-tab="queue"]').click();
  await page.locator('[data-tab="inbox"]').click();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__n)).toBe(primo);

  // Il «Riprova» della scheda, invece, ci riprova davvero.
  await page.locator('#search').fill('');
  await page.locator('.fb-card[data-id="fbA"] .fb-riprova-dettaglio').click();
  await expect.poll(() => page.evaluate(() => window.__n), { timeout: 10_000 }).toBe(primo + 1);
});
