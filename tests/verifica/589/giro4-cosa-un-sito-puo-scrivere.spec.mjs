// Verifica #589 — giro 4.
//
// I giri 1, 2 e 3 hanno chiuso la strada che VA verso i siti: la spinta delle
// impostazioni è ridotta come le letture, e le domande che un sito può fare al
// cuore di Filo sono un elenco di ciò che passa. Le loro prove stanno accanto a
// questa e restano verdi.
//
// Qui si guarda lo STESSO canale nel verso opposto: non che cosa un sito può
// PORTARSI VIA, ma che cosa può SCRIVERE nelle impostazioni dell'utente.
//
// La segnalazione chiedeva una lista dichiarata dei campi ammessi «non una
// lista dei campi da togliere, così il prossimo segreto aggiunto non finisce
// nelle pagine per dimenticanza». In lettura è così. In scrittura no: resta il
// divieto di un campo solo (le chiavi dei servizi a pagamento) e tutto il resto
// delle impostazioni si lascia riscrivere da un'origine web. Il codice che Filo
// carica dentro le pagine scrive UN campo solo (il modello della dettatura,
// scelto dal menu del tasto destro): l'elenco di ciò che passa costerebbe una
// riga.
//
// Le richieste partono con l'indirizzo della pagina, come le farebbe il codice
// che Filo carica lì dentro: il modello di minaccia è quello della segnalazione
// (difesa in profondità, non furto immediato).

import { test, expect } from '../../fixtures/electron.mjs';

const PWD_ATTACCANTE = 'GIRO4-589-PASSWORD-DEL-SITO';
const PROXY_ATTACCANTE = `socks5://ladro:${PWD_ATTACCANTE}@gate.attaccante.example:7000`;
const SITO_ESCLUSO = 'banca-giro4-589.example';

// Una richiesta fatta come la farebbe il codice che gira DENTRO una certa
// pagina: il mittente è costruito dal suo webContents esattamente come lo
// costruisce il canale interno di Filo (stessa forma del giro 3).
function chiediDaQuellaPagina(app, riconosci) {
  return (messaggio) => app.evaluate(async ({ BrowserWindow }, { src, msg }) => {
    const H = globalThis.__filoHandlers;
    // eslint-disable-next-line no-new-func
    const scegli = new Function('u', `return (${src})(u);`);
    let wc = null; let win = null; let tab = null;
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        let u = ''; try { u = t.view.webContents.getURL(); } catch (_) { u = ''; }
        if (scegli(u)) { wc = t.view.webContents; win = w; tab = t; }
      }
      if (!wc) {
        let u = ''; try { u = w.webContents.getURL(); } catch (_) { u = ''; }
        if (scegli(u)) { wc = w.webContents; win = w; }
      }
    }
    if (!wc) return { nonTrovata: true };
    const sender = {
      tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
      url: wc.getURL(),
      isShell: win ? win.webContents === wc : false,
      win: win || null,
      isIncognito: !!win?._filoIncognito,
      wc,
      frame: wc.mainFrame || null,
    };
    try {
      return { origine: sender.tab?.url || sender.url || '', risposta: await H.handleMessage(msg, sender) };
    } catch (e) { return { origine: sender.tab?.url || sender.url || '', errore: String(e) }; }
  }, { src: riconosci, msg: messaggio });
}

const suSito = `(u) => /^http:\\/\\/127\\.0\\.0\\.1/.test(String(u))`;

// Le impostazioni vere, lette dalla parte di Filo (nessuna riduzione di mezzo).
const impostazioniVere = (shell) => shell.evaluate(async () => {
  const r = await window.filoShell.message({ type: 'get_settings' });
  return r?.settings || null;
});

// ── Porta A: le credenziali del proxy dell'utente, riscritte da un sito ────
test('un sito non riscrive il proxy da cui passa la navigazione dell\'utente', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const chiedi = chiediDaQuellaPagina(app, suSito);

  const esito = await chiedi({
    type: 'update_settings',
    settings: { proxy: { datacenter: PROXY_ATTACCANTE, residential: PROXY_ATTACCANTE } },
  });
  expect(esito.nonTrovata, 'la scheda del sito non è stata trovata: la prova non guarda quello che deve').toBeFalsy();

  const dopo = await impostazioniVere(shell);
  expect(
    JSON.stringify(dopo?.proxy ?? null),
    'un sito ha scritto nelle impostazioni il proxy da cui Filo fa passare le pagine dell\'utente',
  ).not.toContain(PWD_ATTACCANTE);
});

// ── Porta B: le protezioni che Filo tiene accese contro i siti ─────────────
test('un sito non spegne le protezioni che Filo tiene accese', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const chiedi = chiediDaQuellaPagina(app, suSito);

  const prima = await impostazioniVere(shell);
  expect(prima?.security?.protectIpLeak, 'la prova parte da uno stato che non è quello di fabbrica').toBe(true);

  await chiedi({
    type: 'update_settings',
    settings: { security: { protectIpLeak: false, blockPopups: false } },
  });

  const dopo = await impostazioniVere(shell);
  expect(
    dopo?.security?.protectIpLeak,
    'un sito ha spento da sé la protezione contro la fuga dell\'indirizzo IP dell\'utente',
  ).toBe(true);
  expect(
    dopo?.security?.blockPopups,
    'un sito ha spento da sé il blocco dei popup',
  ).toBe(true);
});

// ── Porta C: il tetto di spesa e l'elenco dei siti dove Filo è spento ──────
test('un sito non alza il tetto di spesa né cancella i siti dove Filo è spento', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate((dom) => window.filoShell.message({
    type: 'update_settings',
    settings: { blocklist: [dom], monthlyLimitEur: 5 },
  }), SITO_ESCLUSO);

  await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const chiedi = chiediDaQuellaPagina(app, suSito);

  await chiedi({ type: 'update_settings', settings: { monthlyLimitEur: 999999, blocklist: [] } });

  const dopo = await impostazioniVere(shell);
  expect(
    dopo?.monthlyLimitEur,
    'un sito ha alzato da sé il tetto mensile di spesa dell\'utente',
  ).toBe(5);
  expect(
    dopo?.blocklist || [],
    'un sito ha cancellato l\'elenco dei siti dove l\'utente aveva spento Filo',
  ).toContain(SITO_ESCLUSO);
});

// ── Il contrario: quello che al sito serve davvero deve continuare a valere ─
test('la scelta del modello della dettatura dal menu del sito continua a funzionare', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const chiedi = chiediDaQuellaPagina(app, suSito);

  const esito = await chiedi({
    type: 'update_settings',
    settings: { models: { transcribe_audio: 'GIRO4-589-MODELLO' } },
  });
  expect(esito.nonTrovata).toBeFalsy();
  expect(esito.risposta?.ok, 'la scelta del modello di dettatura dal menu di un sito è stata rifiutata').toBe(true);

  const dopo = await impostazioniVere(shell);
  expect(
    dopo?.models?.transcribe_audio,
    'la scelta del modello di dettatura fatta dal menu di un sito non è stata registrata',
  ).toBe('GIRO4-589-MODELLO');
});
