// Spec Playwright: quanto costa tenere aperta la dashboard di gestione (#676).
//
// Prima, ogni pagina di Gestione chiedeva a Firestore i nomi di TUTTA la
// collezione ogni sessanta secondi: centinaia di letture al minuto a database
// fermo. Adesso il giro è uno solo (nel main) e chiede i soli feedback scritti
// dall'ultimo giro: a vuoto è una richiesta che non torna nessun documento.
//
// Lo spec CONTA — richieste e documenti restituiti — su tre giri senza
// cambiamenti e su un giro con un feedback cambiato, e poi asserisce la cosa
// che conta davvero: il feedback cambiato COMPARE aggiornato nella lista
// entro il giro. Firestore è sostituito nel main (le due letture del giro),
// così il conteggio è quello vero del cammino di produzione.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const RITMO = 200; // il giro, accorciato per lo spec

function fakeFb(id, name, extra = {}) {
  return {
    _id: id,
    _updateTime: 't1',
    updatedAt: '2026-09-01T10:00:00.000Z',
    text: `Testo di ${name}.`,
    name,
    seq: extra.seq || 1,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: extra.createdAt || '2026-09-01T10:00:00Z',
    images: [],
    ...extra,
  };
}

// Firestore finto NEL MAIN: conta le richieste e i documenti che tornano.
async function fingiFirestore(app, docs) {
  await app.evaluate(async (_electron, { docs, ritmo }) => {
    // Dentro `evaluate` il `require` del modulo non c'è: il main espone i suoi
    // moduli su globalThis quando gira sotto test (src/main/main.js).
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';

    globalThis.__docs = docs;
    globalThis.__invii = 2;
    globalThis.__conta = { richieste: 0, documenti: 0, versioni: 0, schede: 0, seguiti: 0, contatori: 0 };
    const FB = globalThis.SN_FEEDBACK;
    FB.listVersions = async () => {
      globalThis.__conta.richieste += 1;
      globalThis.__conta.versioni += 1;
      globalThis.__conta.documenti += globalThis.__docs.length;
      return globalThis.__docs.map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    };
    FB.listChangedSince = async ({ since }) => {
      globalThis.__conta.richieste += 1;
      const rows = globalThis.__docs.filter((d) => d.updatedAt > since);
      globalThis.__conta.documenti += rows.length;
      return { rows, complete: true };
    };
    // Le schede pubbliche: il giro non deve toccarle quando non cambia niente.
    FB.getManyPublic = async (ids) => { globalThis.__conta.schede += ids.length; return []; };
    // I due segni senza orologio (#676, giro 1): l'ora che tiene Firestore per
    // i feedback seguiti, e il contatore degli invii.
    FB.versionsOf = async (ids) => {
      globalThis.__conta.richieste += 1;
      globalThis.__conta.seguiti += 1;
      const trovati = globalThis.__docs.filter((d) => ids.includes(d._id));
      globalThis.__conta.documenti += trovati.length;
      return trovati.map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
    };
    FB.getMany = async (ids) => {
      globalThis.__conta.richieste += 1;
      const trovati = globalThis.__docs.filter((d) => ids.includes(d._id));
      globalThis.__conta.documenti += trovati.length;
      return trovati;
    };
    // Una lettura per giro, contata a parte: è un documento solo e non è un
    // feedback, e i conti sotto parlano di feedback.
    FB.submissionCount = async () => {
      globalThis.__conta.richieste += 1;
      globalThis.__conta.contatori += 1;
      return globalThis.__invii;
    };
    // Il ritmo del giro lo legge chi accende il timer: accorciarlo qui basta.
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, ritmo: RITMO });
}

const conta = (app) => app.evaluate(() => globalThis.__conta);

test('il giro al minuto chiede solo i cambiati, e il cambiato compare in lista', async ({ app, openTab }) => {
  const A = fakeFb('giro-a', 'Primo', { seq: 21 });
  const B = fakeFb('giro-b', 'Secondo', { seq: 22, createdAt: '2026-09-02T10:00:00Z' });
  await fingiFirestore(app, [A, B]);

  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  // La lista in pagina (il caricamento vero non ha Firestore) e il canale del
  // giro riaperto sopra i dati finti.
  await page.evaluate(({ A, B }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([B, A]);
    window.__mgTest.setTab('inbox');
    window.__mgTest.resumeLive();
  }, { A, B });
  await expect(page.locator('.mg-item-title')).toHaveText(['Secondo', 'Primo']);

  // Il giro riparte col ritmo corto: spento e riacceso, così il main rifà il
  // timer leggendo il ritmo nuovo.
  await page.evaluate(async () => {
    await window.filo.message({ type: 'feedback_live_subscribe', off: true });
    await window.filo.message({ type: 'feedback_live_subscribe' });
  });

  // Primo giro: il riallineamento d'apertura — l'unico che legge tutta la
  // pagina, e per questo raro (mezz'ora).
  await expect.poll(() => conta(app).then((c) => c.versioni), { timeout: 5000 }).toBe(1);
  const dopoApertura = await conta(app);
  expect(dopoApertura.documenti).toBe(2);

  // TRE GIRI SENZA CAMBIAMENTI: tre richieste, zero documenti, zero schede.
  await expect.poll(() => conta(app).then((c) => c.richieste), { timeout: 5000 })
    .toBeGreaterThanOrEqual(dopoApertura.richieste + 3);
  const fermo = await conta(app);
  expect(fermo.versioni).toBe(1);
  expect(fermo.documenti).toBe(dopoApertura.documenti);
  expect(fermo.schede).toBe(0);
  // Il contatore degli invii: una lettura per giro, e niente di più. È quello
  // che fa vedere una segnalazione mandata da una macchina con l'ora indietro,
  // che la domanda per data non troverebbe.
  expect(fermo.contatori).toBeGreaterThanOrEqual(3);
  expect(fermo.contatori).toBeLessThanOrEqual(fermo.richieste - 3);

  // UN GIRO CON UN FEEDBACK CAMBIATO.
  await app.evaluate(() => {
    const d = globalThis.__docs.find((x) => x._id === 'giro-a');
    d.name = 'Primo, riscritto';
    d._updateTime = 't2';
    d.updatedAt = new Date().toISOString();
  });

  // Il successo è questo: l'owner VEDE il cambiamento, entro il giro.
  await expect(page.locator('.mg-item-title')).toHaveText(['Secondo', 'Primo, riscritto'], { timeout: 5000 });

  const dopo = await conta(app);
  expect(dopo.documenti - fermo.documenti).toBe(1);
  expect(dopo.versioni).toBe(1, 'un cambiamento non fa rileggere tutta la collezione');
  expect(dopo.schede).toBe(1, 'le schede si rileggono per il solo id cambiato');

  // Gestione chiusa: il giro si ferma. Nessuno che guarda, niente da pagare —
  // ed è anche la prova che una scheda andata altrove non resta iscritta.
  await page.goto('about:blank');
  await new Promise((r) => setTimeout(r, RITMO * 4));
  const chiuso = await conta(app);
  await new Promise((r) => setTimeout(r, RITMO * 4));
  expect((await conta(app)).richieste).toBe(chiuso.richieste);
});

// Il giro non si fida della data che firma chi scrive (#676, giro 1). Il server
// delle routine non la firma affatto: quello che scrive lui (presa in carico,
// stato, battiti) è proprio ciò che l'owner guarda mentre tiene aperta la
// dashboard. Per i feedback in mano alle routine il giro chiede a Firestore
// l'ora che tiene LUI, e il cambiamento arriva entro il giro come ogni altro.
test('quello che le routine scrivono senza firmare l\'ora arriva lo stesso entro il giro', async ({ app, openTab }) => {
  const A = fakeFb('coda-a', 'Presa in carico', { seq: 31, status: 'working' });
  const B = fakeFb('coda-b', 'In attesa', { seq: 32, status: 'todo', createdAt: '2026-09-02T10:00:00Z' });
  await fingiFirestore(app, [A, B]);

  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ A, B }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([B, A]);
    window.__mgTest.setTab('queue');
    window.__mgTest.resumeLive();
  }, { A, B });
  await expect(page.locator('.mg-item-title')).toHaveText(['Presa in carico', 'In attesa']);

  // La pagina dice al giro chi seguire da vicino: prima chi è in mano alle
  // routine, poi la testa della coda, da cui esce la prossima presa in carico.
  expect(await page.evaluate(() => window.__mgTest.idsDaSeguire())).toEqual(['coda-a', 'coda-b']);

  await page.evaluate(async () => {
    await window.filo.message({ type: 'feedback_live_subscribe', off: true });
    await window.filo.message({ type: 'feedback_live_subscribe', watch: window.__mgTest.idsDaSeguire() });
  });
  await expect.poll(() => conta(app).then((c) => c.seguiti), { timeout: 5000 }).toBeGreaterThanOrEqual(1);

  // Il server riscrive il feedback e NON tocca la data firmata: solo l'ora di
  // Firestore cambia. Il successo è che l'owner lo vede lo stesso.
  await app.evaluate(() => {
    const d = globalThis.__docs.find((x) => x._id === 'coda-a');
    d.name = 'Lavorazione finita';
    d._updateTime = 't2';
  });
  await expect(page.locator('.mg-item-title')).toHaveText(['Lavorazione finita', 'In attesa'], { timeout: 5000 });
});

// Il campione della coda non deve spingere fuori le segnalazioni IN MANO alle
// routine (#676): sono quelle che si muovono davvero, e una lasciata fuori
// resta ferma in dashboard fino al riallineamento, cioè mezz'ora.
test('con molti lavori aperti insieme, nessuno di quelli in mano resta fuori dal giro', async ({ app, openTab }) => {
  const quanti = 14;
  const docs = [];
  for (let i = 1; i <= quanti; i += 1) {
    docs.push(fakeFb(`mano-${String(i).padStart(2, '0')}`, `Lavoro ${i}`, {
      seq: 300 + i, status: 'working',
      createdAt: `2026-09-${String(28 - i).padStart(2, '0')}T10:00:00Z`,
    }));
  }
  // E una in coda, che il campione può anche non prendere.
  docs.push(fakeFb('mano-coda', 'In attesa', { seq: 999, status: 'todo', createdAt: '2026-08-01T10:00:00Z' }));
  await fingiFirestore(app, docs);

  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
    window.__mgTest.setTab('queue');
    window.__mgTest.resumeLive();
  }, { docs });

  const seguiti = await page.evaluate(() => window.__mgTest.idsDaSeguire());
  for (let i = 1; i <= quanti; i += 1) {
    expect(seguiti).toContain(`mano-${String(i).padStart(2, '0')}`);
  }
});
