// Un percorso fatto su un sito che non è di nessuno non si condivide (#584,
// sesto giro).
//
// Il nome del sito è la quarta cosa che un percorso pubblica, e l'unica che non
// si possa ripulire: è anche l'indirizzo Firestore del documento, quindi
// cambiarlo vorrebbe dire scriverlo dove nessuno lo cercherà. Per i siti
// pubblici esce com'è e lo guarda il modello che giudica. Ma c'è una famiglia
// per cui non serve nemmeno chiederglielo: gli indirizzi che non portano da
// nessuna parte fuori da casa di chi naviga.
//
//   - il router (192.168.1.1) e il server di prova sulla propria macchina
//     (localhost): la stessa cartella pubblica per tutti, e l'unico nome che
//     nessuno deve indovinare;
//   - il disco di rete (nas-rossi.local) e l'intranet dell'ufficio: il nome
//     dice come si chiama la tua macchina, o per chi lavori;
//   - le pagine interne di Filo, dove l'Aiuto si apre con lo stesso tasto: da
//     lì un percorso rientrerebbe nelle istruzioni dell'assistente di chi apre
//     le Opzioni, cioè dentro Filo;
//   - i nomi riservati, che per convenzione non sono e non saranno mai su
//     Internet (`.localhost`, `.test`, `.invalid`, `.example`) e le reti
//     anonime (`.onion`, `.alt`, `.i2p`): stessa cartella pubblica per tutti,
//     stesso nome della macchina o del cliente dentro (#584, settimo giro).
//
// E il PUNTO FINALE: `localhost.` è lo stesso computer di `localhost`, scritto
// nella forma assoluta, e con quel punto in fondo passava la porta che senza
// non passa.
//
// La stessa domanda — «se l'utente rispondesse, partirebbe qualcosa?» — se la
// fa il riquadrino «Ha funzionato?» prima di comparire: dove non si raccoglie
// non si chiede, o la riga sotto la domanda promette una condivisione che non
// avviene e Filo ringrazia per niente.
//
// Perché è una spec e non solo un unit test: la pipeline gira nel processo
// principale, e il pezzo che conta è che si fermi PRIMA dei due modelli, che si
// pagano. Un controllo messo dopo sarebbe verde lo stesso e costerebbe due
// chiamate a ogni sessione di aiuto su una pagina locale.
//
// Senza il fix questa spec è rossa: il percorso entra in coda e il nome della
// macchina finisce in una raccolta che legge chiunque.

import { test, expect } from './fixtures/electron.mjs';

const NON_SONO_SITI = [
  'http://localhost:3000/admin/utenti',
  'http://192.168.1.1/setup/wan',
  'https://nas-rossi.local/files/foto',
  'https://portale.intranet/hr/ferie',
  'filo://options/options.html',
  // I nomi riservati, che per convenzione non sono e non saranno mai su
  // Internet: la lista li lasciava fuori proprio mentre sono quelli che si
  // incontrano (#584, settimo giro). `app.localhost` è il nome che i
  // contenitori danno da soli al servizio di prova; `progetto-rossi.test` è il
  // progetto in lavorazione, col nome del cliente dentro.
  'http://app.localhost:3000/admin/utenti',
  'http://progetto-rossi.test/clienti/fatture',
  'http://qualcosa.invalid/pannello',
  'https://negozio.example/account/ordini',
  // le reti anonime, dove il nome del sito È il segreto
  'http://expyuzz4wqqyqhjn.onion/impostazioni',
  'http://qualcosa.alt/impostazioni',
  'http://qualcosa.i2p/impostazioni',
  // il punto finale: `localhost.` è lo stesso computer di `localhost`, scritto
  // nella forma assoluta, e passava dove `localhost` non passa
  'http://localhost.:3000/admin/utenti',
  'https://nas-rossi.local./files/foto',
];

async function provaRaccolta(app, rawUrl) {
  return app.evaluate(async ({ app: _a }, { rawUrl }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset();
    C._setAuto(false);
    C._setSorteggio(() => 0.5);
    const submitVero = P.submit;
    let spedizioni = 0;
    P.submit = async () => { spedizioni += 1; return { id: 'mai' }; };
    const chiamate = [];
    const r = await C.collectAndSave({
      session: {
        rawUrl,
        rawSteps: [{ selector: '[aria-label="Avanzate"]', action: 'click' }],
        rawUserMessages: ['dove sono le impostazioni avanzate?'],
        success: true,
      },
      invokeAI: async ({ action }) => {
        chiamate.push(action);
        return action === 'help_intent_guess'
          ? { text: 'aprire le impostazioni avanzate' }
          : { text: '{"ok": true}' };
      },
    });
    const coda = C._peek();
    P.submit = submitVero;
    C._reset();
    return { r, inCoda: coda.length, chiamate, spedizioni };
  }, { rawUrl });
}

for (const rawUrl of NON_SONO_SITI) {
  test(`da ${rawUrl} non esce nessun percorso condiviso`, async ({ app }) => {
    const { r, inCoda, chiamate, spedizioni } = await provaRaccolta(app, rawUrl);
    expect(r.saved).toBe(false);
    expect(r.reason).toMatch(/privato o locale/);
    expect(inCoda).toBe(0);
    expect(spedizioni).toBe(0);
    // e ci si ferma prima dei due modelli, che si pagano a ogni chiamata
    expect(chiamate).toEqual([]);
  });
}

test('un sito vero continua a essere raccolto', async ({ app }) => {
  const { r, inCoda, chiamate } = await provaRaccolta(app, 'https://negoziofelice.it/account/ordini');
  expect(r.saved).toBe(true);
  expect(r.queued).toBe(true);
  expect(inCoda).toBe(1);
  expect(chiamate).toEqual(['help_intent_guess', 'help_intent_judge']);
});

// «Se rispondessi, partirebbe qualcosa?» è UNA porta sola: la fa la raccolta
// prima di spendere i due modelli e la fa il riquadrino «Ha funzionato?» prima
// di comparire. Se fossero due, il riquadro tornerebbe a promettere una
// condivisione che non avviene (#584, settimo giro).
test('la stessa porta risponde «no» per tutti quei siti, e «sì» per un sito vero', async ({ app }) => {
  const esito = await app.evaluate(async ({ app: _a }, { chiusi }) => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    C._reset(); C._setAuto(false);
    const out = { chiusi: [], aperto: await C.raccoglibile('https://negoziofelice.it/account/ordini') };
    for (const u of chiusi) out.chiusi.push({ u, r: await C.raccoglibile(u) });
    C._reset();
    return out;
  }, { chiusi: NON_SONO_SITI });

  expect(esito.aperto.ok, 'da un sito vero si raccoglie').toBe(true);
  for (const { u, r } of esito.chiusi) {
    expect(r.ok, `${u}: la porta dice no`).toBe(false);
  }
});

test('e dice «no» anche quando la coda è piena: una risposta in più non entrerebbe da nessuna parte', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    C._reset(); C._setAuto(false);
    const max = C._internal.MAX_IN_CODA;
    for (let i = 0; i < max; i += 1) {
      await C._internal.accoda({ domain: 'negoziofelice.it', initialUrl: '/x', intent: 'fare una cosa', steps: [{ selector: 'a', action: 'click' }], success: true });
    }
    const r = await C.raccoglibile('https://negoziofelice.it/account/ordini');
    const quanti = C._peek().length;
    C._reset();
    return { r, quanti, max };
  });
  expect(esito.quanti).toBe(esito.max);
  expect(esito.r.ok).toBe(false);
  expect(esito.r.reason).toMatch(/coda/);
});

test('e il riquadrino «Ha funzionato?» si fa la stessa domanda, dalla pagina: su una pagina di Filo la risposta è no', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => typeof window.__filoSidebarTest?.percorsoRaccoglibile === 'function',
    null, { timeout: 8000 },
  );
  expect(await page.evaluate(() => window.__filoSidebarTest.percorsoRaccoglibile())).toBe(false);
});

test('e quelle cartelle non si leggono nemmeno: un percorso messo lì apposta non arriva a nessuno', async ({ app }) => {
  const letti = await app.evaluate(async () => {
    const P = globalThis.SN_PATHS;
    const chiamate = [];
    const fetchVero = globalThis.fetch;
    // Solo le richieste ai percorsi: in sottofondo Filo ne fa altre sue.
    globalThis.fetch = async (...a) => {
      const u = String(a[0]);
      if (u.includes('/documents/paths')) chiamate.push(u);
      return fetchVero(...a);
    };
    const out = {};
    for (const d of ['localhost', 'options', '192.168.1.1', 'nas-rossi.local',
      'app.localhost', 'progetto-rossi.test', 'qualcosa.invalid', 'negozio.example',
      'expyuzz4wqqyqhjn.onion', 'qualcosa.alt', 'qualcosa.i2p', 'localhost.']) {
      out[d] = (await P.listByDomain(d, { pageSize: 50, onlySuccess: true })).length;
    }
    globalThis.fetch = fetchVero;
    return { out, chiamate };
  });
  for (const [dominio, quanti] of Object.entries(letti.out)) {
    expect(quanti, `${dominio} non deve rendere percorsi`).toBe(0);
  }
  // e non si tocca nemmeno la rete per chiederlo
  expect(letti.chiamate).toEqual([]);
});
