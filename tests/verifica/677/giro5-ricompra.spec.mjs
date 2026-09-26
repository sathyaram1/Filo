// Verifica #677, quinto giro: la stessa famiglia di sempre — quello che è già
// stato scaricato viene buttato via e ricomprato.
//
// Una causa sola, in parole da owner: la pagina non tiene conto di quello che
// ha già in mano (la conversazione arrivata, la lettura che NON è tornata), e
// il primo aggiornamento che passa glielo cancella. Da lì ogni gesto ricompra.
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

// Le sorgenti di Gestione: la RIGA (quella che rilegge il giro al minuto) e il
// DOCUMENTO INTERO (quello che si paga aprendo la segnalazione).
async function sorgenti(page, riga, { dettaglioRompe = false } = {}) {
  await page.evaluate(({ r, rompe }) => {
    window.__dettagli = 0;
    window.__ver = 'v1';
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: r._id, _updateTime: window.__ver }],
      getMany: async (ids) => ids.map(() => ({
        ...JSON.parse(JSON.stringify(r)), _updateTime: window.__ver, _proiezione: true,
      })),
      getDettagli: async (ids) => {
        window.__dettagli += 1;
        if (rompe) throw new Error('Failed to fetch');
        const pieno = JSON.parse(JSON.stringify(r));
        delete pieno._proiezione;
        pieno.notes = 'REPORT DELLA LAVORAZIONE';
        return ids.map(() => pieno);
      },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([JSON.parse(JSON.stringify(r))]);
  }, { r: riga, rompe: dettaglioRompe });
}

test('Gestione: il giro al minuto non ricompra la conversazione già arrivata', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
  await admin(page);
  await sorgenti(page, RIGA);

  await page.locator('.mg-item[data-id="fbA"]').click();
  await expect(page.locator('#mgThread')).toContainText('REPORT DELLA LAVORAZIONE', { timeout: 15_000 });
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);

  // Una segnalazione in lavorazione la riscrive di continuo la routine che ci
  // lavora: il giro al minuto la trova cambiata a ogni passaggio.
  await page.evaluate(async () => { window.__ver = 'v2'; await window.__mgTest.pollNow(); });
  await page.waitForTimeout(1500);
  await expect(page.locator('#mgThread')).toContainText('REPORT DELLA LAVORAZIONE');
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);
});

test('Gestione: dopo un giro al minuto una lettura già fallita resta tale', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
  await admin(page);
  await sorgenti(page, RIGA, { dettaglioRompe: true });

  await page.locator('.mg-item[data-id="fbA"]').click();
  await expect(page.locator('#mgRiprovaDettaglio')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);

  // Prima del giro la cura regge: andare e tornare non ricompra.
  await page.evaluate(() => window.__mgTest.openDetail('fbA'));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);

  // Dopo il giro al minuto, la stessa andata e ritorno.
  await page.evaluate(async () => { window.__ver = 'v2'; await window.__mgTest.pollNow(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__mgTest.openDetail('fbA'));
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);
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
});
