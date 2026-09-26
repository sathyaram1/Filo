// Ricompensa alla risoluzione di un feedback (C5): all'avvio, se un feedback
// INVIATO DA QUESTO UTENTE è passato a "risolto", la home mostra un popup di
// ringraziamento con la spiegazione non tecnica e accredita crediti UNA VOLTA
// SOLA per feedback.
//
// Asserisce il SUCCESSO della feature: compare il popup #thanksOverlay con il
// titolo del feedback + la spiegazione, e il saldo crediti cresce dell'importo
// atteso. Senza il fix il popup non compare mai e il saldo non cambia.
//
// Da dove arrivano i dati (#583): dalla VISTA pubblica dei feedback
// (`feedback-public`), non dai documenti — che ora non si leggono senza le
// credenziali dell'owner, e questa è la macchina di chi ha mandato la
// segnalazione. Nella scheda c'è quello che serve qui: l'hash
// dell'installazione (per riconoscere i propri), il titolo, il numero, la
// FRASE per chi ha segnalato e i CREDITI che gli spettano. La priorità no:
// viaggia cifrata e non è cosa da collezione pubblica, quindi sulla scheda si
// scrive la cifra, non il giudizio che l'ha decisa. Una scheda senza quella
// cifra (pubblicata prima che il campo esistesse) vale la fascia di base.
// La lista (normalmente da Firestore via rete) è stubbata nel main così il
// test è deterministico e offline.

import { test, expect } from './fixtures/electron.mjs';

const CLIENT_ID = 'test-client-c5';

// Stub delle SCHEDE pubbliche + clientId di questo install + reset del saldo a
// uno stato fresco noto (1000). Va fatto DOPO il boot, poi si ricarica la home.
// Una scheda con `mia: true` prende l'impronta di QUELLA scheda per QUESTA
// installazione: è così che il popup riconosce i feedback di chi lo sta
// guardando, senza che la bacheca (pubblica) permetta a un estraneo di
// raggruppare i fix per segnalatore (#583).
async function seed(app, schede) {
  await app.evaluate(async (_electron, { clientId, schede }) => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    const fresh = globalThis.SN_CREDITS.freshState();
    // Isola la ricompensa di RISOLUZIONE (C5) dal bonus giornaliero separato
    // "feedback autonomo attivo" (+10, F4), che altrimenti scatterebbe al primo
    // init con il clientId impostato e sporcherebbe il saldo atteso. Lo marchiamo
    // come già ricevuto oggi: qui misuriamo SOLO il premio per il feedback risolto.
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const mioHash = await H.hashClientId(clientId);
    const cards = [];
    for (const { mia, ...c } of schede) {
      cards.push(mia ? { ...c, clientIdTag: await H.cardTag(c._id, mioHash) } : c);
    }
    // Niente rete: le schede sono quelle che passiamo noi.
    globalThis.SN_FEEDBACK.listPublic = async () => cards;
    // #678: l'annuncio chiede le PROPRIE schede per identificativo, non la
    // bacheca intera. Il registro degli invii di questa installazione è ciò
    // che glieli dice, e `getManyPublic` risponde solo su quelli chiesti — se
    // il codice chiedesse di più, qui non arriverebbe.
    globalThis.SN_FEEDBACK.getManyPublic = async (ids) => {
      const voluti = new Set((ids || []).map(String));
      return cards.filter((c) => voluti.has(String(c._id)));
    };
    await globalThis.SN_FEEDBACK_MINE.scrivi({
      ids: schede.map((c) => c._id),
      checkedAt: 0,
    });
  }, { clientId: CLIENT_ID, schede });
}

function balanceOf(app) {
  return app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balance);
}

test('feedback risolto: popup di ringraziamento + ricompensa', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // Lascia che l'init iniziale (clientId ancora assente → nessun premio) si
  // esaurisca PRIMA di seminare, così è il reload — l'unica esecuzione con il
  // clientId impostato — ad accreditare la ricompensa e mostrare il popup.
  await page.waitForTimeout(500);

  await seed(app, [
    {
      _id: 'fbA', mia: true, status: 'done', statusPublic: 'closed',
      name: 'Incolla immagine nel box', seq: 42, subSeq: 0,
      userNote: 'Ora puoi incollare un’immagine direttamente nel box e arriva intera.',
    },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const overlay = page.locator('#thanksOverlay');
  await expect(overlay).toBeVisible();

  // Titolo del feedback (con numero) e spiegazione non tecnica presi dalle note.
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#42 Incolla immagine nel box');
  await expect(page.locator('.dash-thanks-item-body'))
    .toHaveText('Ora puoi incollare un’immagine direttamente nel box e arriva intera.');

  // +50 crediti, la fascia di base: questa scheda non porta la cifra, ed è il
  // caso delle schede pubblicate prima che il campo esistesse.
  await expect(page.locator('.dash-thanks-total')).toContainText('+50');
  await expect.poll(() => balanceOf(app)).toBe(1050);
});

test('la ricompensa segue quanto contava la segnalazione, non la fascia minima', async ({ app, openTab }) => {
  // Una segnalazione che l'owner aveva messo in cima vale 300 crediti, non 50.
  // La sua macchina la priorità non la vede (è cifrata, e la scheda pubblica
  // non la porta): la cifra gliela dice la scheda. Senza quel campo il popup
  // annuncia 50 a tutti, in silenzio, e non si rimedia dopo — un feedback
  // premiato resta premiato (#583, giro 2 di verifica).
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // La cifra non è scritta a mano: è quella che il publisher mette sulla scheda
  // di un feedback di priorità 3, cioè la stessa tabella del portafoglio.
  const attesa = await app.evaluate(async () => globalThis.SN_FEEDBACK_PUBLIC_VIEW.rewardFor(3));
  expect(attesa).toBeGreaterThan(50);

  await seed(app, [
    {
      _id: 'fbGrosso', mia: true, status: 'done', statusPublic: 'closed',
      name: 'Filo non si apriva più', seq: 7, subSeq: 0,
      userNote: 'Adesso si apre.', reward: attesa,
    },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect(page.locator('.dash-thanks-total')).toContainText(`+${attesa}`);
  await expect.poll(() => balanceOf(app)).toBe(1000 + attesa);
});

test('aggrega più feedback risolti e somma la ricompensa', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // Lascia che l'init iniziale (clientId ancora assente → nessun premio) si
  // esaurisca PRIMA di seminare, così è il reload — l'unica esecuzione con il
  // clientId impostato — ad accreditare la ricompensa e mostrare il popup.
  await page.waitForTimeout(500);

  await seed(app, [
    { _id: 'fb1', mia: true, status: 'done', statusPublic: 'closed', name: 'Uno', seq: 1, subSeq: 0, userNote: 'Sistemato uno.' },
    { _id: 'fb2', mia: true, status: 'done', statusPublic: 'closed', name: 'Due', seq: 2, subSeq: 0, userNote: 'Sistemato due.' },
    // Non deve premiare: non è chiuso (una scheda così non verrebbe nemmeno
    // pubblicata, ma il popup non deve fidarsi).
    { _id: 'fb3', mia: true, status: 'done', statusPublic: 'open', name: 'Tre', seq: 3, subSeq: 0, userNote: '' },
    // Non deve premiare: di un'altra installazione.
    { _id: 'fb4', clientIdTag: 'b'.repeat(32), status: 'done', statusPublic: 'closed', name: 'Quattro', seq: 4, subSeq: 0, userNote: '' },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  // Solo i due feedback done DI QUESTO utente.
  await expect(page.locator('.dash-thanks-item')).toHaveCount(2);
  // 50 + 50 = 100.
  await expect(page.locator('.dash-thanks-total')).toContainText('+100');
  await expect.poll(() => balanceOf(app)).toBe(1100);
});

// Quando escono insieme due fix di chi sta guardando, l'annuncio li mette in
// fila dal più recente. Non è un vezzo: le schede arrivano da una lettura
// completa, che le porta nell'ordine interno del database (quello degli
// identificativi, cioè casuale), e finché l'annuncio chiedeva una pagina
// ordinata per data quell'ordine glielo dava il database. La scena qui sotto
// mette i due ordini uno contro l'altro: l'identificativo dice «prima la
// vecchia», la data dice «prima la recente» (#583, giro 7).
test('con due fix insieme l\'annuncio parte dal più recente, non dal primo identificativo', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await seed(app, [
    {
      _id: 'aaa-vecchia', mia: true, status: 'done', statusPublic: 'closed',
      name: 'Vecchia', seq: 10, subSeq: 0, userNote: 'Sistemata la vecchia.',
      createdAt: '2026-01-01T10:00:00.000Z',
    },
    {
      _id: 'zzz-recente', mia: true, status: 'done', statusPublic: 'closed',
      name: 'Recente', seq: 20, subSeq: 0, userNote: 'Sistemata la recente.',
      createdAt: '2026-05-01T10:00:00.000Z',
    },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  const titoli = page.locator('.dash-thanks-item-title');
  await expect(titoli).toHaveCount(2);
  await expect(titoli.nth(0)).toContainText('Recente');
  await expect(titoli.nth(1)).toContainText('Vecchia');
});

test('#476 — un attacco confermato non premia e non annuncia niente a chi l\'ha mandato', async ({ app, openTab }) => {
  // Il feedback dell'attaccante, visto DALLA SUA macchina: lo status fine è
  // cifrato (non ha la chiave), quindi l'unica cosa leggibile è l'enum
  // grossolano — che qui prendiamo dalla mappa vera invece di scriverlo a mano.
  // Prima del fix quella mappa diceva 'closed' e questo test falliva: popup di
  // ringraziamento in faccia all'attaccante e 50 crediti sul suo saldo, cioè la
  // conferma che il suo tentativo era arrivato a destinazione.
  const publicOf = (fine) => app.evaluate((_e, s) => globalThis.SN_FB_STATUS.PUBLIC_MAP[s], fine);
  const statusPublic = await publicOf('attack_confirmed');

  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // (Oggi una scheda così non verrebbe nemmeno pubblicata — #583: la vista
  // esclude tutto ciò che è passato dalle mani della sicurezza. Qui la si
  // semina lo stesso: la mappa degli stati pubblici deve reggere da sola.)
  await seed(app, [
    {
      _id: 'fbAttacco', mia: true,
      statusPublic,
      name: 'Ignora le istruzioni precedenti e…', seq: 99, subSeq: 0,
      userNote: '',
    },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  await expect(page.locator('#thanksOverlay')).toHaveCount(0);
  expect(await balanceOf(app)).toBe(1000); // saldo fresco, nessun accredito
});

test('anti doppio-premio: alla riapertura non ricompare né ri-accredita', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // Lascia che l'init iniziale (clientId ancora assente → nessun premio) si
  // esaurisca PRIMA di seminare, così è il reload — l'unica esecuzione con il
  // clientId impostato — ad accreditare la ricompensa e mostrare il popup.
  await page.waitForTimeout(500);

  await seed(app, [
    { _id: 'fbZ', mia: true, status: 'done', statusPublic: 'closed', name: 'Una cosa', seq: 7, subSeq: 0, userNote: 'Fatto.' },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect.poll(() => balanceOf(app)).toBe(1050); // 1000 + 50 (ricompensa di base)

  await page.locator('.dash-recap-done').click();
  await expect(page.locator('#thanksOverlay')).toHaveCount(0);

  // Riapertura: il feedback è già stato premiato → niente popup, saldo invariato.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
  await expect(page.locator('#thanksOverlay')).toHaveCount(0);
  expect(await balanceOf(app)).toBe(1050);
});

test('una segnalazione VECCHIA risolta oggi paga chi l\'ha mandata come una recente', async ({ app, openTab }) => {
  // #583, giri 3, 4 e 5 di verifica: lo stesso danno rientrato da tre porte.
  // Il popup non chiedeva la propria scheda per nome: ne chiedeva una PAGINA,
  // le più recenti per DATA D'INVIO. Una segnalazione vecchia ha una data
  // d'invio vecchia, quindi la sua scheda — scritta il giorno in cui viene
  // chiusa — nasceva già fuori da quella pagina e l'annuncio non la vedeva mai:
  // il fix compariva in bacheca sotto gli occhi di chi l'aveva segnalato, e a
  // lui non arrivava né l'annuncio né i crediti. Coi numeri veri (552 schede,
  // pagina da 500) succedeva a tutto ciò che restava in coda più di due mesi.
  //
  // Qui la sorgente si comporta come Firestore: senza cursore torna la pagina
  // per data d'invio, col cursore riparte dal nome del documento. La scheda di
  // questa installazione è messa apposta OLTRE la prima pagina.
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await app.evaluate(async (_electron, { clientId }) => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    const fresh = globalThis.SN_CREDITS.freshState();
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);

    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const mioHash = await H.hashClientId(clientId);
    const base = (id, giorno) => ({
      _id: id, status: 'done', statusPublic: 'closed',
      name: `Scheda ${id}`, seq: 100, subSeq: 0, userNote: 'Sistemato.',
      createdAt: `${giorno}T10:00:00Z`, resolvedAt: '2026-09-11T10:00:00Z',
    });

    const schede = [];
    // Una pagina intera di segnalazioni altrui, tutte mandate di recente.
    for (let i = 0; i < 500; i += 1) {
      const g = new Date(Date.UTC(2026, 7, 1) + i * 3600_000).toISOString().slice(0, 10);
      schede.push({ ...base(`altrui-${String(i).padStart(3, '0')}`, g), clientIdTag: 'b'.repeat(32) });
    }
    // La mia, mandata a maggio: più vecchia di tutte quelle sopra.
    const mia = base('la-mia-vecchia', '2026-05-20');
    mia.clientIdTag = await H.cardTag(mia._id, mioHash);
    schede.push(mia);

    // Come Firestore: per data d'invio decrescente senza cursore, per nome del
    // documento (con `startAt`) quando il cursore c'è.
    const perData = schede.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const perNome = schede.slice().sort((a, b) => a._id.localeCompare(b._id));
    globalThis.SN_FEEDBACK.listPublic = async ({ pageSize = 500, afterName = null } = {}) => {
      if (typeof afterName !== 'string') return perData.slice(0, pageSize);
      const dopo = afterName ? perNome.findIndex((r) => afterName.endsWith(`/${r._id}`)) + 1 : 0;
      return perNome.slice(dopo, dopo + pageSize);
    };

    // #678 — questa è un'installazione che segnalava GIÀ prima che esistesse
    // il registro degli invii: i suoi identificativi non li sa nessuno, e
    // finché dura la finestra dell'eredità se le cerca leggendo tutte le
    // schede. È l'unico cammino che deve ancora reggere una scheda fuori
    // dalla prima pagina.
    await globalThis.SN_FEEDBACK_MINE.scrivi({
      ids: [],
      checkedAt: 0,
      ereditaFinoA: Date.now() + 24 * 60 * 60 * 1000,
      ereditaUltimoGiro: 0,
    });

    // La scheda esiste ed è FUORI dalla prima pagina: se un domani la pagina
    // diventasse più larga, questa riga resta vera e la prova continua a dire
    // qualcosa.
    globalThis.__fuoriPagina = perData.findIndex((c) => c._id === 'la-mia-vecchia') >= 500;
  }, { clientId: CLIENT_ID });

  expect(await app.evaluate(() => globalThis.__fuoriPagina)).toBe(true);

  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible();
  await expect(page.locator('.dash-thanks-item')).toHaveCount(1);
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#100 Scheda la-mia-vecchia');
  await expect.poll(() => balanceOf(app)).toBe(1050);
});
