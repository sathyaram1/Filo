// Verifica #677, quarto giro: le porte rimaste della stessa causa.
//
// La causa che torna da tre giri: una lettura del resto della segnalazione che
// NON è tornata non viene segnata come tale, e la pagina la ricompra a ogni
// ridisegno. In Gestione è stata chiusa al giro scorso; qui si guarda la
// gemella, la pagina dei feedback, sul ramo del guasto (la lettura SOLLEVA,
// non torna vuota).
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';

const RIGHE = [0, 1, 2].map((i) => ({
  _id: `fbG${i}`,
  _proiezione: true,
  seq: 700 + i,
  subSeq: 0,
  name: `Segnalazione ${i}`,
  text: `Testo della segnalazione ${i}`,
  status: 'unlabeled',
  statusPublic: 'open',
  clientId: 'tester-1',
  createdAt: `2026-09-2${i}T10:00:00.000Z`,
}));

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

test('una lettura andata a vuoto non si ricompra a ogni gesto', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  await page.evaluate((righe) => {
    window.__giri = 0;
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(righe));
    // La rete è caduta: la lettura del resto SOLLEVA, come fa getMany quando
    // non arriva risposta.
    window.SN_FEEDBACK.getMany = async () => {
      window.__giri += 1;
      await new Promise((r) => setTimeout(r, 120));
      throw new Error('Failed to fetch');
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setData(JSON.parse(JSON.stringify(righe)));
  }, RIGHE);

  // Il primo giro parte e fallisce: la pagina lo dice e offre «Riprova».
  await expect.poll(async () => page.evaluate(() => window.__giri), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.locator('.fb-load-retry')).toBeVisible({ timeout: 15_000 });
  const dopoPrimo = await page.evaluate(() => window.__giri);

  // Ora l'owner tocca la pagina senza premere «Riprova»: scrive nella ricerca.
  // Ogni lettera ridisegna. Nessuna di queste è una richiesta di rileggere.
  for (const q of ['a', 'ab', 'abc']) {
    await page.locator('#search').fill(q);
    await page.waitForTimeout(500);
  }

  expect(await page.evaluate(() => window.__giri)).toBe(dopoPrimo);
});

// Stessa causa, seconda porta: la casella «Solo automatici» e il ritorno sulla
// stessa sezione. Nessuno dei due è una richiesta di rileggere, e tutti e due
// ricomprano la lettura appena fallita.
test('dopo una lettura andata a vuoto, la sezione non si ricompra tornandoci', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  await page.evaluate((righe) => {
    window.__giri = 0;
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(righe));
    window.SN_FEEDBACK.getMany = async () => {
      window.__giri += 1;
      await new Promise((r) => setTimeout(r, 120));
      throw new Error('Failed to fetch');
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setData(JSON.parse(JSON.stringify(righe)));
  }, RIGHE);

  await expect(page.locator('.fb-load-retry')).toBeVisible({ timeout: 15_000 });
  const dopoPrimo = await page.evaluate(() => window.__giri);

  // Vado su un'altra sezione e torno: la prima lettura era già fallita.
  await page.locator('[data-tab="resolved"]').click();
  await page.waitForTimeout(500);
  const dopoAltraSezione = await page.evaluate(() => window.__giri);
  await page.locator('[data-tab="inbox"]').click();
  await page.waitForTimeout(500);

  expect(await page.evaluate(() => window.__giri)).toBe(dopoAltraSezione);
  expect(dopoPrimo).toBeGreaterThan(0);
});

// Terza porta, stessa famiglia del secondo giro: un ridisegno che l'owner non
// ha chiesto porta via quello che sta scrivendo. Qui il ridisegno arriva dal
// completamento di una sezione che NON è più quella aperta.
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

// Quarta porta: in Gestione il giro al minuto riporta la segnalazione APERTA
// alla sua riga d'elenco. La conversazione che era già sullo schermo sparisce
// e il pannello la ricompra: su una segnalazione in lavorazione, dove il
// documento cambia a ogni battito, succede ogni minuto finché resta aperta.
const PAGINA_GESTIONE = 'filo://manage/manage.html';

test('il giro al minuto non riporta indietro la segnalazione aperta', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
  await admin(page);

  await page.evaluate(() => {
    const riga = {
      _id: 'fbLive', _proiezione: true, _updateTime: 'v1', seq: 900, subSeq: 0,
      name: 'Segnalazione in lavorazione', text: 'Testo della segnalazione',
      status: 'working', statusPublic: 'open', clientId: 't',
      createdAt: '2026-09-21T10:00:00.000Z',
    };
    window.__dettagli = 0;
    window.__versione = 'v1';
    window.__mgTest.setLiveSources({
      // Il battito della routine riscrive il documento: la versione cambia.
      listVersions: async () => [{ _id: 'fbLive', _updateTime: window.__versione }],
      // Il giro rilegge la RIGA: la stessa proiezione del caricamento.
      getMany: async () => [{ ...JSON.parse(JSON.stringify(riga)), _updateTime: window.__versione }],
      getDettagli: async (ids) => {
        window.__dettagli += 1;
        const { _proiezione, ...pieno } = JSON.parse(JSON.stringify(riga));
        pieno.notes = 'IL REPORT DELLA LAVORAZIONE';
        pieno._updateTime = window.__versione;
        return ids.includes('fbLive') ? [pieno] : [];
      },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([JSON.parse(JSON.stringify(riga))]);
  });

  // In lavorazione = sezione «In coda».
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.locator('.mg-item[data-id="fbLive"]').click();
  await expect(page.locator('#mgThread')).toContainText('IL REPORT DELLA LAVORAZIONE', { timeout: 15_000 });
  const primaDelGiro = await page.evaluate(() => window.__dettagli);

  // Un battito della routine, e il giro al minuto.
  await page.evaluate(async () => { window.__versione = 'v2'; await window.__mgTest.pollNow(); });
  await page.waitForTimeout(1200);

  // La conversazione è ancora sullo schermo, e non è stata ricomprata.
  await expect(page.locator('#mgThread')).toContainText('IL REPORT DELLA LAVORAZIONE');
  expect(await page.evaluate(() => window.__dettagli)).toBe(primaDelGiro);
});
