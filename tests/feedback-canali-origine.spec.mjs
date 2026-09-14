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
      elencoDiChiUsaFilo: { type: MSG.OWNER_LIST_USERS },
      regaloDiCrediti: { type: MSG.OWNER_GIFT_CREDITS, email: 'chiunque@example.com', amount: 1000 },
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

  // Da una pagina di Filo la risposta resta intera: è di lì che le pagine
  // mostrano chi è entrato.
  expect(out.filo.ok).toBe(true);
  expect(Object.keys(out.filo).sort()).toEqual(['isAdmin', 'ok', 'profile', 'signedIn', 'uid']);
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
