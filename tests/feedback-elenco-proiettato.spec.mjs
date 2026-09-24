// L'elenco scarica una PROIEZIONE, il dettaglio il documento intero — #677.
//
// IL CASO. Aprire Gestione o la pagina dei feedback scaricava cinquecento
// documenti INTERI: report della lavorazione, livelli, allegati. Sono i campi
// che pesano, e nessuno di loro sta in una riga d'elenco. Ora la lista chiede
// i soli campi che mostra, ordina e filtra; il resto arriva quando quel
// feedback si apre davvero.
//
// COSA ASSERISCE, dal punto di vista dell'owner: la lista mostra gli STESSI
// feedback di prima — titolo, numero, stato, conteggi — e aprendone uno la
// conversazione e gli allegati CI SONO. E la lettura in più è una sola, per il
// feedback aperto, non per tutti.
//
// Senza il fix è rosso dall'altro verso: il dettaglio non verrebbe mai chiesto
// (`chiesti` resterebbe vuoto) perché la lista porterebbe già tutto.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';
const PAGINA_GESTIONE = 'filo://manage/manage.html';

const ALLEGATO = 'https://firebasestorage.googleapis.com/v0/b/x/o/feedback%2Fprova.png?alt=media';

// La riga come arriva dall'elenco: niente note, niente livelli, niente
// allegati, e il marchio che dice «questo non è tutto il documento».
const RIGA = {
  _id: 'fb677',
  _proiezione: true,
  seq: 677,
  subSeq: 0,
  name: 'Aprire senza scaricare tutto due volte',
  text: 'Gestione ci mette una vita ad aprirsi.',
  status: 'unlabeled',
  statusPublic: 'open',
  priority: 2,
  clientId: 'tester-1',
  createdAt: '2026-09-20T16:47:40.658Z',
};

// Lo stesso feedback, intero, come torna quando si apre il dettaglio.
const INTERO = {
  ...RIGA,
  _proiezione: undefined,
  notes: 'Guardato: il caricamento chiede i documenti interi.',
  images: [ALLEGATO],
  // Gli allegati sono due campi, e tutti e due stanno fuori dalla proiezione:
  // un log allegato dal tester deve ricomparire come l'immagine.
  files: [{ name: 'console.log.txt', url: `${ALLEGATO}&f=1`, type: 'text/plain' }],
};

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

// Sostituisce le due letture della collezione e tiene il registro di quali id
// il dettaglio è andato a chiedere.
async function collezioneFinta(page, riga, intero) {
  await page.evaluate(({ r, i }) => {
    window.__chiesti = [];
    window.__dettaglio = (ids) => {
      window.__chiesti.push(...ids);
      const pieno = JSON.parse(JSON.stringify(i));
      delete pieno._proiezione;
      return ids.includes(pieno._id) ? [pieno] : [];
    };
    window.SN_FEEDBACK.list = async () => [JSON.parse(JSON.stringify(r))];
    window.SN_FEEDBACK.getMany = async (ids) => window.__dettaglio(ids);
    // In Gestione le letture passano dalle sorgenti sostituibili (la pagina
    // tiene un riferimento suo al modulo dei feedback).
    if (window.__mgTest) {
      window.__mgTest.setLiveSources({
        getDettagli: async (ids) => window.__dettaglio(ids),
        getMany: async (ids) => window.__dettaglio(ids),
        listVersions: async () => [],
      });
    }
  }, { r: riga, i: intero });
}

test('la pagina dei feedback mostra la riga, e la conversazione arriva quando serve', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 15_000 });
  await admin(page);
  await collezioneFinta(page, RIGA, INTERO);
  await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' }));
  // Il cammino vero: la lista proiettata entra da SN_FEEDBACK.list, e il
  // completamento della sezione parte da solo al primo disegno.
  await page.evaluate(async () => {
    const righe = await window.SN_FEEDBACK.list({ pageSize: 500, fields: window.SN_FEEDBACK.CAMPI_LISTA });
    window.__fbTest.setData(righe);
  });

  const card = page.locator('.fb-card[data-id="fb677"]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  // La riga dice quello che diceva prima: numero e titolo.
  await expect(card.locator('.fb-title')).toContainText('#677');
  await expect(card.locator('.fb-title')).toContainText('Aprire senza scaricare tutto due volte');
  // La segnalazione originale c'è, e con lei la conversazione e l'allegato:
  // sono arrivati col completamento, non col caricamento della lista.
  await expect(card.locator('.fb-bubble-body').first()).toContainText('Gestione ci mette una vita');
  await expect(card.locator('.fb-notes')).toHaveValue(/caricamento chiede i documenti interi/);
  // L'allegato della segnalazione c'è: che poi l'immagine si decifri o no è
  // un'altra storia, e non è quella che questa prova racconta.
  await expect(card.locator('.fb-imgs')).toHaveCount(1);

  const chiesti = await page.evaluate(() => window.__chiesti);
  expect(chiesti).toEqual(['fb677']);
});

test('in Gestione la lista è la stessa, e il dettaglio si completa aprendolo', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await collezioneFinta(page, RIGA, INTERO);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((r) => window.__mgTest.setData([JSON.parse(JSON.stringify(r))]), RIGA);

  const riga = page.locator('.mg-item[data-id="fb677"]');
  await expect(riga).toBeVisible({ timeout: 10_000 });
  await expect(riga.locator('.mg-item-num')).toHaveText('#677');
  await expect(riga.locator('.mg-item-title')).toHaveText('Aprire senza scaricare tutto due volte');
  // Disegnare la lista non costa nessuna lettura in più.
  expect(await page.evaluate(() => window.__chiesti)).toEqual([]);

  await riga.click();
  // Il pannello si completa da sé: la conversazione e l'allegato compaiono.
  await expect(page.locator('#mgThread')).toContainText('caricamento chiede i documenti interi', { timeout: 10_000 });
  await expect(page.locator('#mgThread .mg-bubble-body').first()).toContainText('Gestione ci mette una vita');
  await expect(page.locator('#mgThread img[data-url]')).toHaveCount(1);
  await expect(page.locator('#mgThread')).toContainText('console.log.txt');

  // Una lettura sola, per il feedback aperto.
  expect(await page.evaluate(() => window.__chiesti)).toEqual(['fb677']);

  // E riaprirlo non ne costa un'altra: il documento è già lì.
  await page.evaluate(() => window.__mgTest && null);
  await riga.click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__chiesti)).toEqual(['fb677']);
});

// La riga d'elenco non ha le note. Rispondere a un chiarimento le APPENDE: se
// si scrive sulla riga invece che sul documento, al posto di tutto il report
// resta la sola risposta. Qui la lettura del dettaglio è lenta apposta e si
// risponde subito: la risposta deve comunque finire in coda al report.
const IN_CHIARIMENTO = {
  _id: 'fb678',
  _proiezione: true,
  seq: 678,
  subSeq: 0,
  name: 'Domanda aperta',
  text: 'Non so quale delle due strade vuoi.',
  status: 'design',
  statusReason: 'clarify',
  statusPublic: 'open',
  clientId: 'tester-1',
  createdAt: '2026-09-21T09:00:00.000Z',
};

const REPORT = 'Report della lavorazione, con dentro la domanda per te.';

test('rispondere a un chiarimento non cancella il report della lavorazione', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);

  await page.evaluate(({ riga, report }) => {
    window.__inviati = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__inviati.push(msg); return { ok: true }; }
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'owner@example.invalid' } };
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.__mgTest.setLiveSources({
      listVersions: async () => [],
      getMany: async () => [],
      // Lenta apposta: è la finestra in cui prima si perdeva il report.
      getDettagli: async (ids) => {
        await new Promise((r) => setTimeout(r, 1200));
        const pieno = JSON.parse(JSON.stringify(riga));
        delete pieno._proiezione;
        pieno.notes = report;
        return ids.includes(pieno._id) ? [pieno] : [];
      },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([JSON.parse(JSON.stringify(riga))]);
  }, { riga: IN_CHIARIMENTO, report: REPORT });

  await page.locator('.mg-item[data-id="fb678"]').click();
  // Subito, senza aspettare che il dettaglio arrivi.
  await page.locator('#mgClarifyText').fill('Prendi la seconda.');
  await page.locator('#mgClarifyBtn').click();

  await expect.poll(async () => (await page.evaluate(() => window.__inviati)).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  const [inviato] = await page.evaluate(() => window.__inviati);
  expect(inviato.notes).toContain(REPORT);
  expect(inviato.notes).toContain('Prendi la seconda.');
});

// Una sezione più grande di un blocco di lettura: i dettagli arrivano a
// gruppi, e alla fine OGNI scheda ha la sua conversazione — anche l'ultima.
// Una scheda rimasta senza mostrerebbe una conversazione vuota, che si legge
// come «non c'è niente da leggere».
test('una sezione lunga si completa tutta, non solo il primo blocco', async ({ openTab }) => {
  const QUANTI = 260;
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 15_000 });
  await admin(page);

  await page.evaluate((quanti) => {
    const righe = Array.from({ length: quanti }, (_, i) => ({
      _id: `m${i}`,
      _proiezione: true,
      seq: 1000 + i,
      subSeq: 0,
      name: `Segnalazione ${i}`,
      text: `Testo ${i}`,
      status: 'unlabeled',
      statusPublic: 'open',
      clientId: 'tester',
      createdAt: new Date(Date.UTC(2026, 8, 20) - i * 3600_000).toISOString(),
    }));
    window.__blocchi = 0;
    window.SN_FEEDBACK.getMany = async (ids) => {
      window.__blocchi += 1;
      return ids.map((id) => {
        const r = righe.find((x) => x._id === id);
        const { _proiezione, ...resto } = r;
        return { ...resto, notes: `NOTA DI ${id}` };
      });
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setData(righe.map((r) => ({ ...r })));
  }, QUANTI);

  await expect(page.locator('.fb-card')).toHaveCount(QUANTI, { timeout: 30_000 });
  // Più di un blocco di lettura, e l'ULTIMA scheda ha la sua conversazione.
  expect(await page.evaluate(() => window.__blocchi)).toBeGreaterThan(1);
  await expect(page.locator('.fb-card[data-id="m259"] .fb-notes')).toHaveValue('NOTA DI m259');
  await expect(page.locator('.fb-card[data-id="m0"] .fb-notes')).toHaveValue('NOTA DI m0');
});

// La sezione si chiede UNA volta, anche se l'owner tocca la pagina mentre
// arriva. Ogni gesto durante l'attesa (una lettera nella ricerca, un cambio di
// sezione, la casella «Solo automatici») ridisegna la lista, e senza il
// registro delle richieste già partite ogni ridisegno ricomprava la sezione
// intera: dodici lettere, tredici volte gli stessi documenti con dentro gli
// allegati. Senza il fix queste due sono rosse sul conteggio.

const LENTE = [0, 1, 2, 3, 4, 5].map((i) => ({
  _id: `fbL${i}`,
  _proiezione: true,
  seq: 900 + i,
  subSeq: 0,
  name: `Segnalazione lenta ${i}`,
  text: `Testo della segnalazione lenta ${i}`,
  status: 'unlabeled',
  statusPublic: 'open',
  clientId: 'tester-1',
  createdAt: `2026-09-2${i % 10}T10:00:00.000Z`,
}));

async function sezioneLenta(page, rows) {
  await page.evaluate((r) => {
    window.__chiesti = [];
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(r));
    window.SN_FEEDBACK.getMany = async (ids) => {
      window.__chiesti.push(...ids);
      // Lenta apposta: è la finestra in cui l'owner tocca la pagina.
      await new Promise((res) => setTimeout(res, 1500));
      return ids.map((id) => {
        const base = r.find((x) => x._id === id);
        if (!base) return null;
        const { _proiezione, ...resto } = JSON.parse(JSON.stringify(base));
        return { ...resto, notes: `Report della lavorazione di ${id}`, images: [], files: [] };
      }).filter(Boolean);
    };
  }, rows);
}

async function ripetuti(page) {
  const chiesti = await page.evaluate(() => window.__chiesti);
  const conteggi = {};
  for (const id of chiesti) conteggi[id] = (conteggi[id] || 0) + 1;
  return { conteggi, ripetuti: Object.entries(conteggi).filter(([, n]) => n > 1) };
}

async function pronta(openTab) {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await sezioneLenta(page, LENTE);
  await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' }));
  await page.evaluate(async () => {
    const lista = await window.SN_FEEDBACK.list({ pageSize: 500, fields: window.SN_FEEDBACK.CAMPI_LISTA });
    window.__fbTest.setData(lista);
  });
  await expect(page.locator('#list')).toContainText('Caricamento', { timeout: 5000 });
  return page;
}

test('scrivere nella ricerca mentre la sezione arriva non la ricompra', async ({ openTab }) => {
  const page = await pronta(openTab);
  await page.locator('#search').type('segnalazione', { delay: 40 });
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const { conteggi, ripetuti: doppi } = await ripetuti(page);
  expect(doppi, `documenti chiesti più di una volta: ${JSON.stringify(conteggi)}`).toEqual([]);
});

test('cambiare sezione mentre arriva non ricompra la sezione di prima', async ({ openTab }) => {
  const page = await pronta(openTab);
  await page.evaluate(() => window.__fbTest.setTab('resolved'));
  await page.evaluate(() => window.__fbTest.setTab('inbox'));
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const { conteggi, ripetuti: doppi } = await ripetuti(page);
  expect(doppi, `documenti chiesti più di una volta: ${JSON.stringify(conteggi)}`).toEqual([]);
});

test('premere «Solo automatici» mentre la sezione arriva non la ricompra', async ({ openTab }) => {
  const page = await pronta(openTab);
  await page.locator('#agentOnly').click();
  await page.locator('#agentOnly').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const { conteggi, ripetuti: doppi } = await ripetuti(page);
  expect(doppi, `documenti chiesti più di una volta: ${JSON.stringify(conteggi)}`).toEqual([]);
});

// ── Un ridisegno non porta via quello che l'owner sta scrivendo ─────────────
//
// Il pannello si ridisegna da solo quando il resto del documento arriva, e
// ridisegnare RIEMPIE le sue caselle col feedback: su una bozza in corso vuol
// dire cancellarla. La scrittura che parte dopo legge la casella ormai vuota,
// e la segnalazione si riapre senza il motivo senza che niente lo dica.
// Senza il fix tutte e quattro sono rosse: la casella torna vuota.
const LENTO_MS = 1500;

async function gestionePronta(openTab, riga, extra) {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await page.evaluate(({ r, ex, lento }) => {
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
    window.__mgTest.setLiveSources({
      listVersions: async () => [],
      getMany: async () => [],
      // Lenta apposta: è la finestra in cui l'owner scrive e il ridisegno
      // arriva addosso. Sul vero è la latenza di una lettura.
      getDettagli: async (ids) => {
        await new Promise((x) => setTimeout(x, lento));
        const pieno = JSON.parse(JSON.stringify(r));
        delete pieno._proiezione;
        pieno.notes = 'Report della lavorazione.';
        return ids.includes(pieno._id) ? [pieno] : [];
      },
    });
    window.__mgTest.setAdmin(true);
    if (ex && ex.releasedVersion) window.__mgTest.setReleasedVersion(ex.releasedVersion);
    window.__mgTest.setData([JSON.parse(JSON.stringify(r))]);
    if (ex && ex.tab) window.__mgTest.setTab(ex.tab);
  }, { r: riga, ex: extra || null, lento: LENTO_MS });
  await page.locator(`.mg-item[data-id="${riga._id}"]`).click();
  return page;
}

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

const DA_DECIDERE = {
  _id: 'fb677d',
  _proiezione: true,
  seq: 6774,
  subSeq: 0,
  name: 'Segnalazione bloccata da decidere',
  text: 'Filo l_ha fermata.',
  status: 'design',
  statusReason: 'l2',
  statusPublic: 'open',
  clientId: 'tester-1',
  createdAt: '2026-09-23T10:00:00.000Z',
};

const IN_CHIARIMENTO_2 = {
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

test('riaprire un fix uscito porta con sé il motivo, anche scritto durante l_attesa', async ({ openTab }) => {
  const page = await gestionePronta(openTab, USCITO, { releasedVersion: '9.9.9', tab: 'resolved' });
  await page.locator('#mgActions button', { hasText: 'Riapri' }).click();
  await page.locator('#mgReopenText').fill('Manca il caso con lo schermo piccolo.');
  await page.locator('#mgReopenConfirmBtn').click();

  await expect.poll(
    async () => (await page.evaluate(() => window.__inviati)).filter((m) => m.status === 'todo').length,
    { timeout: 20_000 },
  ).toBeGreaterThan(0);
  const inviati = await page.evaluate(() => window.__inviati);
  const riapertura = inviati.find((m) => m.status === 'todo');
  expect(riapertura.notes, 'il motivo della riapertura deve arrivare al server').toContain('Manca il caso con lo schermo piccolo.');
  expect(riapertura.notes, 'e il report della lavorazione deve restare').toContain('Report della lavorazione.');
});

test('la risposta a un chiarimento scritta durante l_attesa resta nella casella', async ({ openTab }) => {
  const page = await gestionePronta(openTab, IN_CHIARIMENTO_2);
  await page.locator('#mgClarifyText').fill('Prendi la seconda strada.');
  await page.waitForTimeout(LENTO_MS + 1000);
  await expect(page.locator('#mgClarifyText')).toHaveValue('Prendi la seconda strada.');
});

test('la frase per chi ha segnalato scritta durante l_attesa resta nella riga', async ({ openTab }) => {
  const page = await gestionePronta(openTab, IN_CHIARIMENTO_2);
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Adesso funziona, riprova.');
  await page.waitForTimeout(LENTO_MS + 1000);
  await expect(page.locator('#mgUserNoteText')).toHaveValue('Adesso funziona, riprova.');
});

test('il commento della revisione scritto durante l_attesa arriva al server', async ({ openTab }) => {
  const page = await gestionePronta(openTab, DA_DECIDERE);
  await expect(page.locator('#mgAcceptComment')).toBeVisible({ timeout: 10_000 });
  await page.locator('#mgAcceptComment').fill('Sbloccata: è una richiesta legittima.');
  await page.locator('#mgActions button').first().click();

  await expect.poll(
    async () => (await page.evaluate(() => window.__inviati)).filter((m) => m.reviewDecision).length,
    { timeout: 20_000 },
  ).toBeGreaterThan(0);
  const inviati = await page.evaluate(() => window.__inviati);
  const revisione = inviati.find((m) => m.reviewDecision);
  expect(revisione.reviewComment, 'il perché della decisione deve arrivare al server')
    .toBe('Sbloccata: è una richiesta legittima.');
});

// La bozza rimanda il ridisegno, non lo annulla: appena la casella si svuota
// la conversazione arriva, invece di restare per sempre su «Caricamento…».
test('finita la bozza, la conversazione arriva lo stesso', async ({ openTab }) => {
  const page = await gestionePronta(openTab, IN_CHIARIMENTO_2);
  await page.locator('#mgClarifyText').fill('bozza');
  await page.waitForTimeout(LENTO_MS + 800);
  await expect(page.locator('#mgThread')).toContainText('Caricamento della conversazione');
  // Bozza cancellata e cursore altrove: non c'è più niente da perdere.
  await page.locator('#mgClarifyText').fill('');
  await page.locator('#mgThread').click();
  await expect(page.locator('#mgThread')).toContainText('Report della lavorazione.', { timeout: 10_000 });
});
