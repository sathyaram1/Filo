// I canali dei feedback rispondono solo alle superfici di Filo (#583).
//
// Chiudere la lettura dei feedback su Firestore ha spostato il lavoro dentro
// Filo: adesso sono le pagine di Filo a chiedere al processo principale di
// leggere, cambiare e decifrare le segnalazioni, con le credenziali di chi le
// gestisce. Su una macchina dove quella sessione è aperta, quei canali valgono
// l'intera posta dei feedback e la bacheca che tutti leggono.
//
// Chiedere solo «sei l'amministratore?» non basta: sul computer di chi gestisce
// i feedback la risposta è sempre sì, ed è l'unico dove c'è qualcosa da
// prendere. Prima si guarda DA DOVE arriva la richiesta: una pagina di un sito
// visitato non ottiene niente, e da queste porte la risposta è identica che su
// quella macchina ci sia o no un amministratore. (Che ci sia si può sapere da
// un'altra porta, quella che dice lo stato dell'accesso: la griglia del tasto
// destro gira dentro le pagine dei siti e senza quel bit perderebbe l'icona
// Feedback di chi li gestisce. Quello che da lì non passa è l'identità: vedi
// l'ultimo test.)
//
// Senza il controllo di provenienza questo spec è rosso su tutte le porte
// tranne la lettura.
//
// Il secondo test guarda le ALTRE porte del proprietario che vivono nello
// stesso canale: i modelli predefiniti (che valgono per tutte le installazioni
// di Filo), l'automazione, i bilanci dei giri, i modelli dei giudici, i
// registri del lavoro e delle routine. Sono la stessa famiglia e vanno chiuse
// insieme: una difesa messa su quattro porte su nove è una porta aperta con
// accanto un cartello che dice dove.
//
// Il terzo guarda le porte VICINE, che non sono del proprietario ma di
// chiunque abbia fatto l'accesso: uscire dall'account, votare in bacheca,
// ritirare il voto, riaprire un fix a pagamento. Su una macchina con una
// sessione aperta «hai una sessione?» è sempre sì, quindi un sito visitato
// votava al posto dell'utente, gli cancellava il voto e gli spendeva i crediti
// aprendo a suo nome una segnalazione col testo che voleva.
//
// Il quarto guarda l'identità: la porta che dice chi sta usando Filo risponde
// anche a un content script (la griglia del tasto destro deve sapere se questa
// è l'installazione di chi gestisce i feedback, il pannello del red-team se
// c'è una sessione), ma di là dal confine non passano né l'indirizzo email né
// l'identificativo dell'account.
//
// Il quinto guarda la stessa porta dal verso opposto: l'avviso «l'accesso è
// cambiato» porta il profilo, quindi va alle sole superfici di Filo. Se un sito
// non lo può chiedere, non glielo si manda da soli.

import { test, expect } from './fixtures/electron.mjs';

const SITO = { url: 'https://evil.example/pagina' };
const SITO_CON_SCHEDA = { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' };
const PAGINA_DI_FILO = { url: 'filo://manage/manage.html' };

test('da un sito visitato ogni canale dei feedback rifiuta per provenienza', async ({ app, shell }) => {
  void shell; // attende il boot: il dispatcher dev'essere montato

  const out = await app.evaluate(async (_electron, mittenti) => {
    const MSG = globalThis.SN_MSG.MSG;
    const porte = (mittente) => ({
      lettura: { type: MSG.FEEDBACK_FETCH, op: 'list' },
      triage: { type: MSG.FEEDBACK_UPDATE, id: 'fb-uno', status: 'archived' },
      frasePubblica: { type: MSG.FEEDBACK_UPDATE, id: 'fb-uno', userNote: 'scritta da un sito' },
      decifraTesto: { type: MSG.FEEDBACK_DECRYPT_FIELDS, fields: { text: 'FENC1:qualcosa' } },
      decifraAllegato: { type: MSG.FEEDBACK_DECRYPT_IMAGE, url: 'https://storage.googleapis.com/altro/allegato' },
      rivaluta: { type: MSG.FEEDBACK_REEVALUATE, feedbackIds: ['fb-uno'] },
      // Iscriversi al giro è farsi mandare i feedback dell'owner a ogni
      // cambiamento: la porta più golosa di tutte per un sito visitato.
      giroIscrizione: { type: MSG.FEEDBACK_LIVE_SUBSCRIBE },
      _mittente: mittente,
    });
    const esegui = async (mittente) => {
      const { _mittente, ...msgs } = porte(mittente);
      const res = {};
      for (const [nome, msg] of Object.entries(msgs)) {
        res[nome] = await globalThis.SN_HANDLE_MESSAGE(msg, _mittente);
      }
      return res;
    };
    return {
      sito: await esegui(mittenti.sito),
      sitoConScheda: await esegui(mittenti.sitoConScheda),
      filo: await esegui(mittenti.filo),
    };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA, filo: PAGINA_DI_FILO });

  for (const provenienza of ['sito', 'sitoConScheda']) {
    for (const [porta, r] of Object.entries(out[provenienza])) {
      expect(r, `${provenienza}/${porta}: nessuna risposta`).toBeTruthy();
      expect(r.ok, `${provenienza}/${porta}: un sito visitato non deve ottenere niente`).toBe(false);
      expect(
        String(r.code || ''),
        `${provenienza}/${porta}: rifiutato per il motivo sbagliato — così su una macchina dove i feedback si gestiscono la richiesta passerebbe`,
      ).toBe('forbidden');
      expect(r.rows, `${provenienza}/${porta}: niente dati`).toBeUndefined();
      expect(r.list, `${provenienza}/${porta}: niente dati`).toBeUndefined();
      expect(r.fields, `${provenienza}/${porta}: niente dati`).toBeUndefined();
    }
  }

  // Da una pagina di Filo la porta esiste: senza una sessione di chi gestisce i
  // feedback non legge niente, ma il rifiuto è un PERMESSO che manca — ed è
  // così che la pagina sa di dover dire «serve l'amministratore» invece di
  // «controlla la connessione».
  for (const [porta, r] of Object.entries(out.filo)) {
    expect(r.ok, `filo/${porta}`).toBe(false);
    // `decifraAllegato` è l'eccezione, ed è voluta (#582). Le altre porte
    // servono solo la dashboard di chi riceve le segnalazioni, quindi «non sei
    // l'amministratore» è la risposta giusta. Quella lì la chiama ANCHE il
    // riquadro dei feedback, dove un tester qualunque riapre le proprie
    // segnalazioni: mandarlo a cercare un permesso di amministratore che non
    // avrà mai era il difetto. E prima ancora dell'identità guarda DOVE punta
    // l'indirizzo — che non lo sceglie Filo, lo scrive chi manda la
    // segnalazione — e qui l'indirizzo è di un deposito che non è il nostro.
    if (porta === 'decifraAllegato') {
      expect(String(r.code || ''), `filo/${porta}: non è una questione di permessi`).not.toBe('not_admin');
      expect(String(r.error || ''), `filo/${porta}: l'indirizzo va guardato per primo`).toContain('url allegato non valido');
      continue;
    }
    expect(String(r.code || ''), `filo/${porta}`).toBe('not_admin');
  }
});

test('anche le altre porte del proprietario rifiutano per provenienza', async ({ app, shell }) => {
  void shell;

  const out = await app.evaluate(async (_electron, mittenti) => {
    const MSG = globalThis.SN_MSG.MSG;
    const porte = () => ({
      modelliPredefinitiLettura: { type: MSG.DEFAULTS_GET },
      modelliPredefinitiScrittura: { type: MSG.DEFAULTS_UPDATE, config: { models: {} } },
      automazioneLettura: { type: MSG.AUTOMATION_GET },
      automazioneScrittura: { type: MSG.AUTOMATION_SET, enabled: true },
      bilanciLettura: { type: MSG.AUTOMATION_CAPS_GET },
      bilanciScrittura: { type: MSG.AUTOMATION_CAPS_SET, cap2: 99 },
      registroWorker: { type: MSG.WORKER_LOG_GET },
      registroRoutine: { type: MSG.ROUTINE_LOG_GET, limit: 5 },
      giudiciLettura: { type: MSG.SUPPORT_MODELS_GET },
      giudiciScrittura: { type: MSG.SUPPORT_MODELS_UPDATE, models: {} },
      fusioniElenco: { type: MSG.MERGE_APPROVALS_GET },
      fusioniApprova: { type: MSG.MERGE_APPROVAL_APPROVE, id: 'ab12cd34ef56ab12cd34ef56' },
      fusioniScarta: { type: MSG.MERGE_APPROVAL_DISCARD, id: 'ab12cd34ef56ab12cd34ef56' },
    });
    const esegui = async (mittente) => {
      const res = {};
      for (const [nome, msg] of Object.entries(porte())) {
        res[nome] = await globalThis.SN_HANDLE_MESSAGE(msg, mittente);
      }
      return res;
    };
    return {
      sito: await esegui(mittenti.sito),
      sitoConScheda: await esegui(mittenti.sitoConScheda),
      filo: await esegui(mittenti.filo),
    };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA, filo: PAGINA_DI_FILO });

  for (const provenienza of ['sito', 'sitoConScheda']) {
    for (const [porta, r] of Object.entries(out[provenienza])) {
      expect(r, `${provenienza}/${porta}: nessuna risposta`).toBeTruthy();
      expect(r.ok, `${provenienza}/${porta}: un sito visitato non deve ottenere niente`).toBe(false);
      expect(
        String(r.code || ''),
        `${provenienza}/${porta}: rifiutato per il motivo sbagliato — su una macchina dove c'è la sessione di chi gestisce Filo la richiesta passerebbe`,
      ).toBe('forbidden');
      // E il rifiuto non porta con sé niente: nemmeno un campo che sembra
      // innocuo dice a un sito cosa c'è dietro la porta.
      expect(Object.keys(r).sort(), `${provenienza}/${porta}: il rifiuto porta dati`)
        .toEqual(['code', 'error', 'ok']);
    }
  }

  // Da una pagina di Filo la porta esiste: qui non c'è nessuna sessione di chi
  // gestisce Filo, quindi il rifiuto è un PERMESSO che manca, non la
  // provenienza. È la differenza che permette alla pagina di dire la cosa
  // giusta invece di mandare a controllare la connessione.
  for (const [porta, r] of Object.entries(out.filo)) {
    expect(r.ok, `filo/${porta}`).toBe(false);
    expect(String(r.code || ''), `filo/${porta}`).toBe('not_admin');
  }
});

test('anche le porte di chi ha solo fatto l\'accesso rifiutano per provenienza', async ({ app, shell }) => {
  void shell;

  const out = await app.evaluate(async (_electron, mittenti) => {
    const MSG = globalThis.SN_MSG.MSG;
    const porte = () => ({
      esci: { type: MSG.AUTH_SIGNOUT },
      vota: { type: MSG.BOARD_CAST_VOTE, id: 'fb-uno', vote: 'works' },
      ritiraIlVoto: { type: MSG.BOARD_CLEAR_VOTE, id: 'fb-uno' },
      riapriAPagamento: { type: MSG.BOARD_REOPEN, id: 'fb-uno', text: 'scritto da un sito' },
    });
    const esegui = async (mittente) => {
      const res = {};
      for (const [nome, msg] of Object.entries(porte())) {
        res[nome] = await globalThis.SN_HANDLE_MESSAGE(msg, mittente);
      }
      return res;
    };
    return {
      sito: await esegui(mittenti.sito),
      sitoConScheda: await esegui(mittenti.sitoConScheda),
      filo: await esegui(mittenti.filo),
    };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA, filo: PAGINA_DI_FILO });

  for (const provenienza of ['sito', 'sitoConScheda']) {
    for (const [porta, r] of Object.entries(out[provenienza])) {
      expect(r, `${provenienza}/${porta}: nessuna risposta`).toBeTruthy();
      expect(r.ok, `${provenienza}/${porta}: un sito visitato non deve ottenere niente`).toBe(false);
      expect(
        String(r.code || ''),
        `${provenienza}/${porta}: rifiutato per il motivo sbagliato — su una macchina dove qualcuno è entrato la richiesta passerebbe`,
      ).toBe('forbidden');
    }
  }

  // Da una pagina di Filo le porte esistono: qui non c'è nessuna sessione,
  // quindi il rifiuto parla di quello e non della provenienza. Uscire senza
  // essere entrati non è un errore.
  expect(out.filo.esci.ok).toBe(true);
  for (const porta of ['vota', 'ritiraIlVoto', 'riapriAPagamento']) {
    expect(out.filo[porta].ok, `filo/${porta}`).toBe(false);
    expect(String(out.filo[porta].code || ''), `filo/${porta}: non è la provenienza a mancare`).not.toBe('forbidden');
  }
});

test('a un sito visitato l\'identità di chi usa Filo non arriva', async ({ app, shell }) => {
  void shell;

  const out = await app.evaluate(async (_electron, mittenti) => {
    const MSG = globalThis.SN_MSG.MSG;
    const chiSei = (m) => globalThis.SN_HANDLE_MESSAGE({ type: MSG.AUTH_STATUS }, m);
    return {
      sito: await chiSei(mittenti.sito),
      sitoConScheda: await chiSei(mittenti.sitoConScheda),
      filo: await chiSei(mittenti.filo),
    };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA, filo: PAGINA_DI_FILO });

  for (const provenienza of ['sito', 'sitoConScheda']) {
    const r = out[provenienza];
    // La porta risponde: la griglia del tasto destro gira dentro le pagine dei
    // siti e senza risposta perderebbe l'icona Feedback di chi li gestisce.
    expect(r.ok, `${provenienza}: la risposta serve ai pezzi di Filo che girano nelle pagine`).toBe(true);
    expect(typeof r.signedIn).toBe('boolean');
    expect(typeof r.isAdmin).toBe('boolean');
    // Ma l'identità no.
    expect(r.profile, `${provenienza}: il profilo di chi usa Filo è finito a un sito visitato`).toBeUndefined();
    expect(r.uid, `${provenienza}: l'identificativo dell'account è finito a un sito visitato`).toBeUndefined();
    expect(Object.keys(r).sort()).toEqual(['isAdmin', 'ok', 'signedIn']);
  }

  // Da una pagina di Filo la risposta resta intera. Elenco minimo, non esatto: il
  // confine chiuso è quello dei siti, un campo nuovo per Filo non è un rosso (#816.1).
  expect(out.filo.ok).toBe(true);
  expect(Object.keys(out.filo)).toEqual(expect.arrayContaining(['isAdmin', 'ok', 'profile', 'remembered', 'signedIn', 'uid']));
});

test('chiedere l\'accesso da un sito non consegna al sito chi è entrato (#810.9)', async ({ app, shell }) => {
  void shell;

  const out = await app.evaluate(async (_electron, mittenti) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    const profilo = { email: 'chi-usa-filo@example.com', name: 'Chi Usa Filo' };
    ga.signIn = async () => profilo;
    ga.isSignedIn = () => true;
    ga.isRemembered = () => true;
    ga.getProfile = () => profilo;
    const MSG = globalThis.SN_MSG.MSG;
    const accedi = (m) => globalThis.SN_HANDLE_MESSAGE({ type: MSG.AUTH_SIGNIN }, m);
    return {
      sito: await accedi(mittenti.sito),
      sitoConScheda: await accedi(mittenti.sitoConScheda),
      filo: await accedi(mittenti.filo),
    };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA, filo: PAGINA_DI_FILO });

  for (const provenienza of ['sito', 'sitoConScheda']) {
    const r = out[provenienza];
    expect(r.ok, `${provenienza}: l'esito dell'accesso arriva anche al sito`).toBe(true);
    expect(r.signedIn).toBe(true);
    expect(JSON.stringify(r), `${provenienza}: l'email di chi usa Filo è arrivata al sito`).not.toContain('chi-usa-filo@example.com');
    expect(Object.keys(r).sort()).toEqual(['isAdmin', 'ok', 'signedIn']);
  }
  expect(out.filo.ok).toBe(true);
  expect(out.filo.profile && out.filo.profile.email).toBe('chi-usa-filo@example.com');
});

test('l\'avviso «l\'accesso è cambiato» non arriva alle schede sui siti, e porta il profilo solo a Filo', async ({ app, openTab, testServer }) => {
  // La stessa porta vista dal verso opposto: se un sito non può CHIEDERE chi
  // sta usando Filo, non glielo si manda nemmeno da soli. L'avviso di cambio
  // accesso porta il profilo, cioè l'indirizzo email.
  await openTab('filo://board/board.html');
  await testServer.openReady(openTab, '<html><body><p>sito qualunque</p></body></html>');

  const conteggi = await app.evaluate(async ({ BrowserWindow }) => {
    const MSG = globalThis.SN_MSG.MSG;
    const spie = [];
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win._filoTabs) continue;
      for (const t of win._filoTabs.tabs) {
        const wc = t.view.webContents;
        const spia = { url: String(wc.getURL() || ''), ricevuti: [] };
        const orig = wc.send.bind(wc);
        wc.send = (canale, m) => { spia.ricevuti.push({ canale, tipo: m && m.type, haProfilo: !!(m && 'profile' in m) }); return orig(canale, m); };
        spie.push(spia);
      }
    }
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AUTH_SIGNOUT }, { url: 'filo://options/options.html' });
    return spie.map((s) => ({ url: s.url, avvisi: s.ricevuti.filter((r) => r.tipo === 'auth_changed') }));
  });

  const filo = conteggi.filter((c) => c.url.startsWith('filo://'));
  const web = conteggi.filter((c) => c.url.startsWith('http://'));
  expect(filo.length, 'serve almeno una pagina filo:// aperta').toBeGreaterThan(0);
  expect(web.length, 'serve almeno una scheda su un sito qualunque').toBeGreaterThan(0);
  for (const c of filo) expect(c.avvisi.length, `${c.url}: le pagine di Filo devono saperlo`).toBeGreaterThan(0);
  for (const c of web) {
    expect(c.avvisi.length, `${c.url}: l'avviso con dentro il profilo è arrivato a un sito visitato`).toBe(0);
  }
});

test('l\'archivio delle schede chiuse si legge, si cerca e si cancella solo dalle pagine di Filo', async ({ app, shell }) => {
  void shell;

  const out = await app.evaluate(async (_electron, mittenti) => {
    const MSG = globalThis.SN_MSG.MSG;
    const A = globalThis.SN_ARCHIVED_TABS;
    const a = await A.archive({ url: 'https://banca.example/estratto', title: 'Banca online, estratto conto' });
    const porte = () => ({
      elenco: { type: MSG.GET_ARCHIVED_TABS },
      ricerca: { type: MSG.SEARCH_ARCHIVED_TABS, query: 'banca' },
      daCancellare: { type: MSG.ARCHIVIO_DA_CANCELLARE, query: 'banca' },
      eliminaGruppo: { type: MSG.DELETE_ARCHIVED_TABS, ids: [a.id] },
      eliminaUna: { type: MSG.REMOVE_ARCHIVED_TAB, id: a.id },
      svuota: { type: MSG.CLEAR_ARCHIVED_TABS },
    });
    const res = {};
    for (const [prov, mittente] of Object.entries(mittenti)) {
      res[prov] = {};
      for (const [nome, msg] of Object.entries(porte())) res[prov][nome] = await globalThis.SN_HANDLE_MESSAGE(msg, mittente);
    }
    const rimaste = (await A.list()).map((x) => x.title);
    const daFilo = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.GET_ARCHIVED_TABS }, { url: 'filo://archive/archive.html' });
    return { res, rimaste, daFilo };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA });

  for (const [prov, porte] of Object.entries(out.res)) {
    for (const [porta, r] of Object.entries(porte)) {
      expect(r.ok, `${prov}/${porta}: un sito visitato non deve ottenere niente`).toBe(false);
      expect(String(r.code || ''), `${prov}/${porta}`).toBe('forbidden');
      expect(JSON.stringify(r), `${prov}/${porta}: il titolo è uscito verso il sito`).not.toContain('Banca online');
    }
  }
  expect(out.rimaste, 'un sito ha cancellato schede dall\'archivio').toEqual(['Banca online, estratto conto']);
  expect(out.daFilo.ok).toBe(true);
  expect(out.daFilo.tabs.map((x) => x.title)).toEqual(['Banca online, estratto conto']);
});

test('il riordino delle schede, e la chiusura di una scheda per id, li chiede solo una pagina di Filo (#589.15)', async ({ app, shell, openTab, testServer }) => {
  // Dal codice di Filo dentro un sito qualunque: senza il confine una delle due
  // schede doppie finiva nell'archivio e, con un modello, partiva una chiamata pagata.
  test.setTimeout(60_000);
  const doppia = testServer.html('<html><head><title>Doppia</title></head><body><p>doppia</p></body></html>');
  await openTab(doppia);
  await openTab(doppia);
  await testServer.openReady(openTab, '<html><head><title>Sito B</title></head><body><p>B</p></body></html>', { pubblico: true });

  const stato = () => app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const archivio = (await globalThis.SN_ARCHIVED_TABS.list()).map((x) => x.title);
    return {
      doppie: tm.tabs.filter((t) => t.title === 'Doppia').map((t) => t.id),
      ordine: tm.tabs.map((t) => t.id),
      archivio,
      chiamate: globalThis.__chiamateTriage,
    };
  });
  await expect.poll(async () => (await stato()).doppie.length, { timeout: 10_000 }).toBe(2);

  await app.evaluate(() => {
    globalThis.__chiamateTriage = 0;
    // Il modello configurato: tiene tutto, ma ogni giro è una chiamata.
    globalThis.SN_TAB_TRIAGE_DECIDE = async () => { globalThis.__chiamateTriage += 1; return { decisions: [] }; };
  });
  const prima = await stato();

  // Dal mondo isolato del sito B, cioè dallo stesso canale che usano i content script di Filo.
  const dalSito = await app.evaluate(async ({ BrowserWindow }, bersaglio) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const b = tm.tabs.find((t) => /sito-pubblico\.test/.test(t.url || ''));
    const manda = (m) => b.view.webContents.executeJavaScriptInIsolatedWorld(999, [{
      code: `chrome.runtime.sendMessage(${JSON.stringify(m)})`,
    }]);
    return {
      riordino: await manda({ type: 'run_tab_triage' }),
      riordinoColori: await manda({ type: 'reorder_tabs' }),
      chiudi: await manda({ type: '_tabs:remove', id: bersaglio }),
      confermaAFreddo: await manda({ type: 'filo_confirm_action', action: { type: 'PULISCI_TAB' } }),
    };
  }, prima.doppie[0]);

  for (const porta of ['riordino', 'riordinoColori', 'chiudi']) {
    expect(dalSito[porta] && dalSito[porta].ok, `${porta}: un sito visitato non deve ottenere niente`).toBe(false);
    expect(String(dalSito[porta].code || ''), porta).toBe('forbidden');
  }
  expect(dalSito.confermaAFreddo.executed, 'una conferma mai chiesta ha lanciato il riordino').toBe(false);
  const dopo = await stato();
  expect(dopo.doppie, 'un sito ha chiuso una scheda dell\'utente').toEqual(prima.doppie);
  expect(dopo.ordine).toEqual(prima.ordine);
  expect(dopo.archivio).not.toContain('Doppia');
  expect(dopo.chiamate, 'un sito ha fatto partire una chiamata al modello').toBe(0);

  // Il bottone della home funziona come prima: la doppia va nell'archivio.
  const home = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  const r = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'run_tab_triage' }));
  expect(r).toMatchObject({ ok: true, archived: 1 });
  const fine = await stato();
  expect(fine.doppie.length).toBe(1);
  expect(fine.archivio).toContain('Doppia');
  expect(fine.chiamate).toBe(1);
  expect((await home.evaluate(() => chrome.runtime.sendMessage({ type: 'reorder_tabs' }))).ok).toBe(true);
  void shell;
});
