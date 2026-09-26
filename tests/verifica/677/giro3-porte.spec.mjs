// Verifica #677, terzo giro: quando il resto della segnalazione NON arriva.
//
// L'elenco è una proiezione: la conversazione, i livelli e gli allegati si
// leggono aprendo la segnalazione. Qui quella lettura non riesce (rete che
// cade, sessione scaduta, documento cancellato da un'altra macchina). La
// pagina dei feedback lo dice e offre «Riprova»; queste prove chiedono la
// stessa cosa a Gestione.
import { test, expect } from './../../fixtures/electron.mjs';

const PAGINA_GESTIONE = 'filo://manage/manage.html';
const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';

const APERTA = {
  _id: 'g3c',
  _proiezione: true,
  seq: 6778,
  subSeq: 0,
  name: 'Domanda aperta',
  text: 'Quale delle due strade?',
  status: 'design',
  statusReason: 'clarify',
  statusPublic: 'open',
  clientId: 'tester-1',
  createdAt: '2026-09-23T09:00:00.000Z',
};

const NUOVA = {
  _id: 'g3n',
  _proiezione: true,
  seq: 6780,
  subSeq: 0,
  name: 'Segnalazione appena arrivata',
  text: 'Il pulsante non risponde.',
  status: 'unlabeled',
  statusPublic: 'open',
  clientId: 'tester-1',
  createdAt: '2026-09-24T09:00:00.000Z',
};

const USCITO = {
  _id: 'g3a',
  _proiezione: true,
  seq: 6779,
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

async function admin(page) {
  await page.evaluate(() => {
    window.__inviati = [];
    const orig = window.filo.message.bind(window.filo);
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

// `modo`: 'guasto' = la lettura del dettaglio fallisce; 'vuoto' = torna niente.
async function gestioneConDettaglioRotto(openTab, riga, modo, extra) {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await page.evaluate(({ r, m, ex }) => {
    window.__chiesti = [];
    window.__mgTest.setLiveSources({
      listVersions: async () => [],
      getMany: async () => [],
      getDettagli: async (ids) => {
        window.__chiesti.push(...ids);
        await new Promise((res) => setTimeout(res, 200));
        if (m === 'guasto') throw new Error('Failed to fetch');
        return [];
      },
    });
    window.__mgTest.setAdmin(true);
    if (ex && ex.releasedVersion) window.__mgTest.setReleasedVersion(ex.releasedVersion);
    window.__mgTest.setData([JSON.parse(JSON.stringify(r))]);
    if (ex && ex.tab) window.__mgTest.setTab(ex.tab);
  }, { r: riga, m: modo, ex: extra || null });
  await page.locator(`.mg-item[data-id="${riga._id}"]`).click();
  return page;
}

// Quello che l'owner deve poter fare: capire che la conversazione non è
// arrivata, e riprovare. Una riga che dice «Caricamento…» per sempre è la
// stessa cosa di una conversazione vuota, con l'aggravante che sembra viva.
test('in Gestione, se il resto della segnalazione non arriva, il pannello lo dice', async ({ openTab }) => {
  const page = await gestioneConDettaglioRotto(openTab, APERTA, 'guasto');
  await expect(page.locator('#mgThread')).toContainText('Caricamento della conversazione', { timeout: 10_000 });
  await page.waitForTimeout(4000);
  const testo = await page.locator('#mgDetail').innerText();
  await page.screenshot({ path: 'tests/.shots/677-giro3-dettaglio-guasto.png', fullPage: false });
  expect(testo, `il pannello dopo il guasto:\n${testo}`).not.toContain('Caricamento della conversazione');
});

test('in Gestione, una segnalazione che non c e piu non resta in caricamento', async ({ openTab }) => {
  const page = await gestioneConDettaglioRotto(openTab, APERTA, 'vuoto');
  await page.waitForTimeout(4000);
  const testo = await page.locator('#mgDetail').innerText();
  expect(testo, `il pannello dopo la lettura vuota:\n${testo}`).not.toContain('Caricamento della conversazione');
});

// E la lettura mancata non si ricompra a ogni clic: senza il marchio togliuto
// ogni riapertura della stessa riga è un'altra lettura, per sempre.
test('in Gestione, riaprire la stessa riga non ricompra la lettura mancata', async ({ openTab }) => {
  const page = await gestioneConDettaglioRotto(openTab, APERTA, 'vuoto');
  await page.waitForTimeout(1000);
  for (let i = 0; i < 4; i += 1) {
    await page.locator('#mgThread').click().catch(() => {});
    await page.locator(`.mg-item[data-id="${APERTA._id}"]`).click();
    await page.waitForTimeout(300);
  }
  const chiesti = await page.evaluate(() => window.__chiesti);
  expect(chiesti.length, `letture chieste: ${JSON.stringify(chiesti)}`).toBeLessThanOrEqual(2);
});

// Il cammino che il secondo giro aveva già visto da un'altra porta: il motivo
// della riapertura. Qui la lettura fallisce, e premere «Conferma riapertura»
// non deve restare muto — o l'owner crede di aver riaperto e non l'ha fatto.
test('in Gestione, Conferma riapertura con la lettura rotta non resta muto', async ({ openTab }) => {
  const page = await gestioneConDettaglioRotto(openTab, USCITO, 'guasto', { releasedVersion: '9.9.9', tab: 'resolved' });
  await page.locator('#mgActions button', { hasText: 'Riapri' }).click();
  await page.locator('#mgReopenText').fill('Manca il caso con lo schermo piccolo.');
  await page.locator('#mgReopenConfirmBtn').click();
  await page.waitForTimeout(3000);
  const inviati = await page.evaluate(() => window.__inviati);
  const msg = await page.locator('#mgDetail').innerText();
  await page.screenshot({ path: 'tests/.shots/677-giro3-riapri-guasto.png' });
  expect(
    inviati.length > 0 || /non .* riuscit|riprova|connessione|errore|non .* letta/i.test(msg),
    `nessuna scrittura e nessun avviso. Pannello:\n${msg}`,
  ).toBeTruthy();
});

// La gemella, nella stessa condizione: lì l'errore c'è. Serve a dire che la
// cura esiste già in una pagina e manca nell'altra.
test('nella pagina dei feedback lo stesso guasto si legge, con Riprova', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await page.evaluate((r) => {
    window.SN_FEEDBACK.list = async () => [JSON.parse(JSON.stringify(r))];
    window.SN_FEEDBACK.getMany = async () => { throw new Error('Failed to fetch'); };
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setData([JSON.parse(JSON.stringify(r))]);
  }, NUOVA);
  await expect(page.locator('#empty')).toContainText(/Non .* possibile caricare|connessione/i, { timeout: 15_000 });
  await expect(page.locator('.fb-load-retry')).toBeVisible();
});

// L'altra porta della stessa causa: rispondere a una domanda di Filo. La
// risposta si appende alla conversazione, che qui non è arrivata — e premere
// «Invia risposta» non deve restare muto.
test('in Gestione, Invia risposta con la lettura rotta non resta muto', async ({ openTab }) => {
  const page = await gestioneConDettaglioRotto(openTab, APERTA, 'guasto');
  await page.locator('#mgClarifyText').fill('Prendi la seconda strada.');
  await page.locator('#mgClarifyBtn').click();
  await page.waitForTimeout(3000);
  const inviati = await page.evaluate(() => window.__inviati);
  const msg = await page.locator('#mgDetail').innerText();
  expect(
    inviati.length > 0 || /non .* riuscit|riprova|connessione|errore|non .* letta/i.test(msg),
    `nessuna scrittura e nessun avviso. Pannello:\n${msg}`,
  ).toBeTruthy();
});
