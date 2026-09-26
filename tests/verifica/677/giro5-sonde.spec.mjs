// Verifica #677, quinto giro — SONDE (esplorazione, non prove definitive).
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA_GESTIONE = 'filo://manage/manage.html';
const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';

const RIGA = {
  _id: 'fbA', _proiezione: true, _updateTime: 'v1', seq: 900, subSeq: 0,
  name: 'Segnalazione in lavorazione', text: 'Il testo di chi ha segnalato.',
  status: 'working', statusPublic: 'open', priority: 2,
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

test('SONDA A — il giro al minuto riporta la segnalazione aperta a riga d_elenco', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
  await admin(page);
  await page.evaluate((riga) => {
    window.__dettagli = 0;
    window.__righe = 0;
    window.__ver = 'v1';
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: 'fbA', _updateTime: window.__ver }],
      getMany: async (ids) => {           // la RIGA: proiezione
        window.__righe += 1;
        return ids.map(() => ({ ...JSON.parse(JSON.stringify(riga)), _updateTime: window.__ver, _proiezione: true }));
      },
      getDettagli: async (ids) => {       // il documento INTERO
        window.__dettagli += 1;
        const pieno = JSON.parse(JSON.stringify(riga));
        delete pieno._proiezione;
        pieno.notes = 'REPORT DELLA LAVORAZIONE';
        return ids.map(() => pieno);
      },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([JSON.parse(JSON.stringify(riga))]);
  }, RIGA);

  await page.locator('.mg-item[data-id="fbA"]').click();
  await expect(page.locator('#mgThread')).toContainText('REPORT DELLA LAVORAZIONE', { timeout: 15_000 });
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);

  // Il giro al minuto: la segnalazione è cambiata (una routine ci lavora).
  await page.evaluate(async () => { window.__ver = 'v2'; await window.__mgTest.pollNow(); });
  await page.waitForTimeout(1500);
  const stato = await page.evaluate(() => ({
    thread: document.getElementById('mgThread').textContent,
    dettagli: window.__dettagli,
  }));
  console.log('SONDA A →', JSON.stringify(stato).slice(0, 400));
  expect(stato.thread).toContain('REPORT DELLA LAVORAZIONE');
  expect(stato.dettagli).toBe(1);
});

test('SONDA B — dopo un giro al minuto la lettura già fallita si ricompra di nuovo', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
  await admin(page);
  await page.evaluate((riga) => {
    window.__dettagli = 0;
    window.__ver = 'v1';
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: 'fbA', _updateTime: window.__ver }],
      getMany: async (ids) => ids.map(() => ({ ...JSON.parse(JSON.stringify(riga)), _updateTime: window.__ver, _proiezione: true })),
      getDettagli: async () => { window.__dettagli += 1; throw new Error('Failed to fetch'); },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([JSON.parse(JSON.stringify(riga))]);
  }, RIGA);

  await page.locator('.mg-item[data-id="fbA"]').click();
  await expect(page.locator('#mgRiprovaDettaglio')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);

  // Clic avanti e indietro: la cura del terzo giro dice «non si ricompra».
  await page.evaluate(() => window.__mgTest.openDetail('fbA'));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__dettagli)).toBe(1);

  // Un giro al minuto, e poi di nuovo avanti e indietro.
  await page.evaluate(async () => { window.__ver = 'v2'; await window.__mgTest.pollNow(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__mgTest.openDetail('fbA'));
  await page.waitForTimeout(800);
  const dopo = await page.evaluate(() => window.__dettagli);
  console.log('SONDA B → letture del dettaglio dopo il giro:', dopo);
  expect(dopo).toBe(1);
});

test('SONDA C — pagina feedback: la lettura fallita si ricompra a ogni gesto', async ({ openTab }) => {
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
  }, { ...RIGA, status: 'unlabeled' });

  await expect(page.locator('.fb-load-retry')).toBeVisible({ timeout: 15_000 });
  const primo = await page.evaluate(() => window.__n);
  await page.locator('#fbSearch').fill('abc');
  await page.waitForTimeout(1200);
  const dopo = await page.evaluate(() => window.__n);
  console.log('SONDA C → letture prima:', primo, 'dopo tre lettere:', dopo);
  expect(dopo).toBe(primo);
});

test('SONDA D — pagina feedback: un dettaglio che non torna lo dice, come la gemella', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await page.evaluate((riga) => {
    window.SN_FEEDBACK.list = async () => [JSON.parse(JSON.stringify(riga))];
    // Il documento non torna: cancellato, o la risposta lo salta.
    window.SN_FEEDBACK.getMany = async () => [];
    window.__fbTest.setAdmin(true, { email: 'o@e.invalid' });
    window.__fbTest.setData([JSON.parse(JSON.stringify(riga))]);
  }, { ...RIGA, status: 'unlabeled' });

  const card = page.locator('.fb-card[data-id="fbA"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  const testo = await card.textContent();
  console.log('SONDA D → la scheda dice:', JSON.stringify(testo).slice(0, 600));
  await page.screenshot({ path: 'tests/.shots/677-giro5-sondaD.png', fullPage: true });
  expect(testo).toMatch(/non è arrivat|Riprova/);
});
