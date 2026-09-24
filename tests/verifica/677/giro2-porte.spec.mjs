// Verifica #677, giro 2 — le porte che il giro 1 aveva nominato e quelle
// gemelle: la casella «Solo automatici» durante l'attesa, la riapertura (che
// come la risposta a un chiarimento APPENDE alla conversazione) e l'allegato
// non-immagine nel dettaglio di Gestione.

import { test, expect } from './../../fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';
const PAGINA_GESTIONE = 'filo://manage/manage.html';

async function admin(page) {
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.__inviati = [];
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.invalid' } };
      }
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      if (msg && msg.type === 'feedback_update') { window.__inviati.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
}

// ── 1. «Solo automatici» premuto durante l'attesa ───────────────────────────
// La terza porta nominata nel giro scorso. Le altre due (la ricerca e il
// cambio di sezione) hanno una prova durevole; questa no.
test('premere «Solo automatici» mentre la sezione arriva non la ricompra', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  await page.evaluate(() => {
    window.__chiesti = [];
    const righe = Array.from({ length: 6 }, (_, i) => ({
      _id: `a${i}`,
      _proiezione: true,
      seq: 900 + i,
      subSeq: 0,
      name: `Segnalazione ${i}`,
      // Metà automatiche, metà no: la casella cambia davvero l'insieme.
      clientId: i % 2 === 0 ? 'filo-agent' : 'tester-1',
      text: `testo ${i}`,
      status: 'unlabeled',
      statusPublic: 'open',
      createdAt: `2026-09-2${i}T10:00:00.000Z`,
    }));
    window.SN_FEEDBACK.getMany = async (ids) => {
      window.__chiesti.push(...ids);
      await new Promise((r) => setTimeout(r, 1500));
      return ids.map((id) => {
        const r = righe.find((x) => x._id === id);
        if (!r) return null;
        const pieno = JSON.parse(JSON.stringify(r));
        delete pieno._proiezione;
        pieno.notes = `report di ${id}`;
        return pieno;
      }).filter(Boolean);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setData(righe.map((r) => JSON.parse(JSON.stringify(r))));
  });

  await expect(page.locator('#list')).toContainText('Caricamento', { timeout: 5000 });
  // Durante l'attesa: accendi e spegni la casella.
  await page.locator('#agentOnly').click();
  await page.locator('#agentOnly').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);

  const chiesti = await page.evaluate(() => window.__chiesti);
  const conteggi = {};
  for (const id of chiesti) conteggi[id] = (conteggi[id] || 0) + 1;
  const doppi = Object.entries(conteggi).filter(([, n]) => n > 1);
  expect(doppi, `documenti chiesti più di una volta: ${JSON.stringify(conteggi)}`).toEqual([]);
});

// ── 2. La riapertura è l'altra porta che APPENDE ────────────────────────────
// Stessa forma della risposta a un chiarimento: la riga d'elenco non ha le
// note, e scriverci sopra il motivo cancellerebbe il report.
const USCITO = {
  _id: 'fb677r',
  _proiezione: true,
  seq: 6771,
  subSeq: 0,
  name: 'Fix uscito da riaprire',
  text: 'Manca ancora un pezzo.',
  status: 'done',
  statusPublic: 'closed',
  resolvedInVersion: '0.0.1',
  resolvedAt: '2026-09-21T09:00:00.000Z',
  clientId: 'tester-1',
  createdAt: '2026-09-20T09:00:00.000Z',
};
const REPORT = 'Report della lavorazione che non si deve perdere.';

test('riaprire un fix uscito non cancella il report della lavorazione', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  await page.evaluate(({ riga, report }) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [],
      getMany: async () => [],
      getDettagli: async (ids) => {
        await new Promise((r) => setTimeout(r, 1200));
        const pieno = JSON.parse(JSON.stringify(riga));
        delete pieno._proiezione;
        pieno.notes = report;
        return ids.includes(pieno._id) ? [pieno] : [];
      },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setReleasedVersion('9.9.9');
    window.__mgTest.setData([JSON.parse(JSON.stringify(riga))]);
    window.__mgTest.setTab('resolved');
  }, { riga: USCITO, report: REPORT });

  await page.locator('.mg-item[data-id="fb677r"]').click();
  // Subito, senza aspettare che il documento intero arrivi.
  await page.locator('#mgActions button', { hasText: 'Riapri' }).click();
  await page.locator('#mgReopenText').fill('Manca il caso con lo schermo piccolo.');
  await page.locator('#mgReopenConfirmBtn').click();

  // La riapertura scrive lo stato: è quella la scrittura che porta il motivo
  // in coda alla conversazione (prima parte, da sola, la frase per chi ha
  // segnalato).
  await expect.poll(
    async () => (await page.evaluate(() => window.__inviati)).filter((m) => m.status).length,
    { timeout: 15_000 },
  ).toBeGreaterThan(0);
  const inviati = await page.evaluate(() => window.__inviati);
  const riapertura = inviati.find((m) => m.status === 'todo');
  expect(riapertura, `scritture: ${JSON.stringify(inviati)}`).toBeTruthy();
  expect(riapertura.notes, 'il report della lavorazione deve restare in coda alla conversazione').toContain(REPORT);
  expect(riapertura.notes).toContain('Manca il caso con lo schermo piccolo.');
});

// ── 2b. Le altre due caselle dello stesso pannello ──────────────────────────
// Stessa causa: quando il documento intero arriva, il pannello si ridisegna
// senza chiedersi se l'owner sta scrivendo. Il giro dal vivo quella domanda la
// fa (detailBeingEdited) e infatti non butta via niente.
const IN_CHIARIMENTO = {
  _id: 'fb677c',
  _proiezione: true,
  seq: 6773,
  subSeq: 0,
  name: 'Domanda aperta',
  text: 'Quale delle due strade?',
  status: 'design',
  statusReason: 'clarify',
  statusPublic: 'open',
  clientId: 'tester-1',
  createdAt: '2026-09-23T09:00:00.000Z',
};

async function gestioneLenta(openTab, riga) {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await page.evaluate((r) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [],
      getMany: async () => [],
      getDettagli: async (ids) => {
        await new Promise((x) => setTimeout(x, 1500));
        const pieno = JSON.parse(JSON.stringify(r));
        delete pieno._proiezione;
        pieno.notes = 'Report.';
        return ids.includes(pieno._id) ? [pieno] : [];
      },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([JSON.parse(JSON.stringify(r))]);
  }, riga);
  return page;
}

test('la risposta scritta mentre il dettaglio arriva non sparisce', async ({ openTab }) => {
  const page = await gestioneLenta(openTab, IN_CHIARIMENTO);
  await page.locator('.mg-item[data-id="fb677c"]').click();
  await page.locator('#mgClarifyText').fill('Prendi la seconda strada.');
  // Il documento intero arriva adesso.
  await page.waitForTimeout(2500);
  await expect(page.locator('#mgClarifyText')).toHaveValue('Prendi la seconda strada.');
});

test('la frase per chi ha segnalato scritta mentre il dettaglio arriva non sparisce', async ({ openTab }) => {
  const page = await gestioneLenta(openTab, IN_CHIARIMENTO);
  await page.locator('.mg-item[data-id="fb677c"]').click();
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Adesso funziona, riprova.');
  await page.waitForTimeout(2500);
  await expect(page.locator('#mgUserNoteText')).toHaveValue('Adesso funziona, riprova.');
});

// ── 3. Un allegato NON immagine nel dettaglio di Gestione ───────────────────
// «aprendo un dettaglio testo e allegati ci sono»: gli allegati sono due
// campi, `images` e `files`, e solo il primo ha una prova.
const CON_FILE = {
  _id: 'fb677f',
  _proiezione: true,
  seq: 6772,
  subSeq: 0,
  name: 'Segnalazione con un log allegato',
  text: 'Allego il log.',
  status: 'unlabeled',
  statusPublic: 'open',
  clientId: 'tester-1',
  createdAt: '2026-09-22T09:00:00.000Z',
};

test('il dettaglio mostra anche un allegato che non è un_immagine', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  await page.evaluate((riga) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [],
      getMany: async () => [],
      getDettagli: async (ids) => {
        const pieno = JSON.parse(JSON.stringify(riga));
        delete pieno._proiezione;
        pieno.notes = 'Guardato.';
        pieno.files = [{ name: 'console.log.txt', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/f%2Fconsole.log.txt?alt=media', type: 'text/plain' }];
        return ids.includes(pieno._id) ? [pieno] : [];
      },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([JSON.parse(JSON.stringify(riga))]);
  }, CON_FILE);

  await page.locator('.mg-item[data-id="fb677f"]').click();
  await expect(page.locator('#mgThread')).toContainText('console.log.txt', { timeout: 10_000 });
});
