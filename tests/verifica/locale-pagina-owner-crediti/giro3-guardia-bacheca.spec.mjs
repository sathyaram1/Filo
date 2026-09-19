// Terzo giro — la GUARDIA della bacheca.
//
// La bacheca è la vetrina dei miglioramenti: deve leggere la VISTA pubblica
// delle segnalazioni (titolo, numero, stato) e mai la raccolta vera, dove c'è
// il testo scritto dalle persone e l'indirizzo della pagina da cui hanno
// scritto. C'è una prova che tiene chiusa quella porta, ma era diventata muta:
// la lettura della vista ha una memoria di mezzo minuto, e la prova si ritrovava
// davanti le schede del caricamento precedente senza che alla rete venisse
// chiesto niente. Una guardia che non guarda nessuna richiesta lascia passare
// qualunque cosa.
//
// Qui si verifica il COMPORTAMENTO che rende quella guardia di nuovo vera, e si
// controlla che chiuderla non abbia tolto niente all'utente:
//   1. una ricarica chiede DAVVERO al server, anche a memoria appena riempita,
//      e quello che chiede è solo la vista pubblica;
//   2. il tasto «Riprova» della bacheca si comporta come prima: caricamento
//      fallito, frase in italiano, e al clic la bacheca torna in piedi con i
//      miglioramenti, riletti dal server e non dalla memoria;
//   3. da una pagina web non si raggiunge niente di tutto questo: né la leva
//      che ricarica la bacheca, né la memoria delle segnalazioni.
//
// Le prove non dipendono dalla rete della macchina: la sorgente vera viene
// sostituita a livello di richieste, e la prima lettura della pagina — riuscita
// o fallita che sia — viene buttata via prima di cominciare.
import { test, expect } from '../../fixtures/electron.mjs';

const BACHECA = 'filo://board/board.html';

// Una scheda pubblica nella forma in cui la manda il registro: solo campi da
// vetrina, nessun testo di nessuno.
function scheda(nome, id = 'fb-1') {
  return {
    document: {
      name: `projects/p/databases/(default)/documents/feedback-public/${id}`,
      createTime: '2026-06-20T10:00:00Z',
      updateTime: '2026-06-22T10:00:00Z',
      fields: {
        name: { stringValue: nome },
        seq: { integerValue: '42' },
        subSeq: { integerValue: '0' },
        status: { stringValue: 'done' },
        statusPublic: { stringValue: 'closed' },
        resolvedInVersion: { stringValue: '0.2.70' },
        createdAt: { stringValue: '2026-06-20T10:00:00Z' },
        resolvedAt: { stringValue: '2026-06-22T10:00:00Z' },
        clientIdHash: { stringValue: 'a'.repeat(32) },
        userNote: { stringValue: 'Ora prende anche la barra.' },
      },
    },
  };
}

// Prende il posto della rete e SEGNA ogni richiesta: quello che conta non è
// solo cosa si vede, ma cosa si è chiesto. Con `guasto` la rete non risponde,
// come succede senza connessione.
async function fintaRete(page, { righe = [], guasto = false } = {}) {
  await page.evaluate(({ r, g }) => {
    window.__chieste = [];
    window.__righe = r;
    window.__guasto = g;
    if (!window.__reteInstallata) {
      window.__reteInstallata = true;
      window.fetch = async (url, opts) => {
        const body = (opts && opts.body) ? String(opts.body) : '';
        window.__chieste.push({ url: String(url), body });
        if (window.__guasto) throw new TypeError('Failed to fetch');
        // Chi torna col cursore trova la raccolta finita: una pagina senza
        // documenti, come risponde il registro vero.
        const pagina = body.includes('"startAt"')
          ? [{ readTime: '2026-06-22T10:00:00Z' }]
          : window.__righe;
        return {
          ok: true,
          status: 200,
          json: async () => pagina,
          text: async () => JSON.stringify(pagina),
        };
      };
    }
  }, { r: righe, g: guasto });
}

async function cambiaRete(page, { righe, guasto }) {
  await page.evaluate(({ r, g }) => {
    if (Array.isArray(r)) window.__righe = r;
    if (typeof g === 'boolean') window.__guasto = g;
    window.__chieste = [];
  }, { r: righe, g: guasto });
}

const chieste = (page) => page.evaluate(() => window.__chieste || []);

// Nessuna richiesta deve nominare la raccolta vera delle segnalazioni, né per
// indirizzo né nel corpo.
function soloVetrina(lista) {
  for (const c of lista) {
    expect(c.body).not.toMatch(/"collectionId"\s*:\s*"feedback"/);
    expect(c.url).not.toMatch(/documents\/feedback(\?|\/|$)/);
    expect(c.url).not.toMatch(/documents:batchGet/);
  }
}

async function bachecaPronta(openTab) {
  const page = await openTab(BACHECA);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => window.__boardTest && window.SN_FEEDBACK && window.SN_CHAT_ERRORS,
    null,
    { timeout: 20_000 },
  );
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 25_000 });
  return page;
}

test('una ricarica della bacheca chiede davvero al server, e chiede solo la vetrina', async ({ openTab }) => {
  const page = await bachecaPronta(openTab);

  await fintaRete(page, { righe: [scheda('Migliorata la cattura schermo')] });
  await page.evaluate(() => {
    window.__boardTest.setReleasedVersion('0.2.71');
    return window.__boardTest.reload();
  });

  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('.bd-card-title')).toHaveText('Migliorata la cattura schermo');
  const primo = await chieste(page);
  expect(primo.length).toBeGreaterThan(0);
  expect(primo.some((c) => c.body.includes('feedback-public'))).toBe(true);
  soloVetrina(primo);

  // Subito dopo, a memoria appena riempita: la bacheca deve tornare a chiedere.
  // Se rispondesse da sé, una guardia che conta le richieste non vedrebbe più
  // niente da controllare — ed è esattamente così che era diventata muta.
  await cambiaRete(page, { righe: [scheda('Secondo giro di lettura', 'fb-2')] });
  await page.evaluate(() => window.__boardTest.reload());

  const secondo = await chieste(page);
  expect(secondo.length).toBeGreaterThan(0);
  expect(secondo.some((c) => c.body.includes('feedback-public'))).toBe(true);
  soloVetrina(secondo);
  // E quello che si vede è la risposta appena arrivata, non quella di prima.
  await expect(page.locator('.bd-card-title')).toHaveText('Secondo giro di lettura');
});

test('col server irraggiungibile la bacheca lo dice a parole, e «Riprova» la rimette in piedi rileggendo', async ({ openTab }) => {
  const page = await bachecaPronta(openTab);

  await fintaRete(page, { guasto: true });
  await page.evaluate(() => {
    window.__boardTest.setReleasedVersion('0.2.71');
    return window.__boardTest.reload();
  });

  await expect(page.locator('#bdError')).toBeVisible();
  await expect(page.locator('#bdRetry')).toBeVisible();
  const frase = (await page.locator('#bdErrorMsg').innerText()).toLowerCase();
  expect(frase).toContain('connessione');
  expect(frase).toContain('riprova');
  expect(frase).not.toContain('failed to fetch');

  // La rete torna. Il tasto è dell'utente: non passa dalla leva delle prove, e
  // deve funzionare lo stesso.
  await cambiaRete(page, { righe: [scheda('Fix tornato col Riprova', 'fb-3')], guasto: false });
  await page.locator('#bdRetry').click();

  await expect(page.locator('#bdError')).toBeHidden();
  await expect(page.locator('.bd-card-title')).toHaveText('Fix tornato col Riprova');
  await expect(page.locator('.bd-card .bd-vote-works')).toHaveCount(1);
  // Ha riletto davvero: il tasto non risponde da una memoria.
  const dopo = await chieste(page);
  expect(dopo.length).toBeGreaterThan(0);
  soloVetrina(dopo);
});

test('due clic di fila su «Riprova» non fanno partire due letture', async ({ openTab }) => {
  const page = await bachecaPronta(openTab);

  await fintaRete(page, { guasto: true });
  await page.evaluate(() => {
    window.__boardTest.setReleasedVersion('0.2.71');
    return window.__boardTest.reload();
  });
  await expect(page.locator('#bdRetry')).toBeVisible();

  // La rete torna, ma risponde con calma: è la finestra in cui un secondo clic
  // farebbe partire una seconda lettura.
  await cambiaRete(page, { righe: [scheda('Letto una volta sola', 'fb-4')], guasto: false });
  await page.evaluate(() => { window.__lenta = true; });
  await page.evaluate(() => {
    const t = document.querySelector('#bdRetry');
    t.click();
    t.click();
    t.click();
  });

  await expect(page.locator('.bd-card-title')).toHaveText('Letto una volta sola');
  const dopo = await chieste(page);
  expect(dopo.length).toBe(1);
  soloVetrina(dopo);
});

test('da una pagina web non si raggiunge la leva della bacheca né la memoria delle segnalazioni', async ({ openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Pagina qualunque</title><p>Ciao</p>');

  const esito = await web.evaluate(() => {
    const out = {
      leva: typeof window.__boardTest,
      segnalazioni: typeof window.SN_FEEDBACK,
      raggiuntaDaFuori: false,
      apertaBacheca: false,
    };
    // Una pagina ostile proverebbe anche ad aprirsi la bacheca da sé per
    // arrivare alla leva da lì.
    try {
      const w = window.open('filo://board/board.html');
      if (w) {
        out.apertaBacheca = true;
        try { out.raggiuntaDaFuori = typeof w.__boardTest !== 'undefined'; } catch (_) {}
        try { w.close(); } catch (_) {}
      }
    } catch (_) {}
    return out;
  });

  expect(esito.leva).toBe('undefined');
  expect(esito.segnalazioni).toBe('undefined');
  expect(esito.raggiuntaDaFuori).toBe(false);
});
