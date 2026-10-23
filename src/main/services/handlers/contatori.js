// Handler di dominio dei contatori anonimi (#969, #1461, #1471): crea il servizio, lo mette a disposizione del cancello dei
// modelli, segue le scritture delle impostazioni e riceve i gesti contati nelle pagine. Cosa si conta e quando parte:
// src/main/services/contatori.js. Le pagine mandano solo nomi da elenchi chiusi e numeri: qui si rifiuta il resto.

const { soloFilo } = require('./origine');
const auth = require('../../auth/google-auth');
const Servizio = require('../contatori');
const Finestra = require('../contatoriFinestra');
const Disco = require('../../shim/storage');
const Registro = require('../registroCambi');

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const testo = (v) => (typeof v === 'string' ? v : '');
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Crash e blocchi di ogni renderer e processo (#1461, #1466): dove, quale e perché, come lo dice Electron. Una scheda in
// incognito non si conta; quello che cade mentre Filo si chiude non è un crash.
function seguiCrash(contatori, C) {
  let electron;
  try { electron = require('electron'); } catch (_) { return; }
  const { app, BrowserWindow } = electron;
  if (!app || typeof app.on !== 'function') return;
  let inChiusura = false;
  app.on('before-quit', () => { inChiusura = true; });
  const finestre = () => BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed());
  const doveDi = (wc) => {
    for (const w of finestre()) {
      const incognito = !!w._filoIncognito;
      if (w.webContents === wc) return { dove: 'finestra', incognito };
      const tm = w._filoTabs;
      if (tm && Array.isArray(tm.tabs) && tm.tabs.some((t) => t.view && t.view.webContents === wc)) return { dove: 'scheda', incognito };
      // Le viste accanto alle schede (barra, assistente, menu) hanno la sessione di sempre anche in una finestra incognito.
      let figli = [];
      try { figli = (w.contentView && w.contentView.children) || []; } catch (_) {}
      if (figli.some((v) => v && v.webContents === wc)) return { dove: 'vista', incognito };
    }
    let incognito = false;
    try { incognito = !wc.session.isPersistent(); } catch (_) {}
    return { dove: 'vista', incognito };
  };
  const motivo = (d) => (C.MOTIVI_CRASH.includes(d && d.reason) ? d.reason : 'altro');
  app.on('render-process-gone', (_e, wc, details) => {
    if (inChiusura || !details || details.reason === 'clean-exit') return;
    const d = doveDi(wc);
    contatori.erroreVisto(`crash:${d.dove}:${motivo(details)}`, { incognito: d.incognito });
  });
  app.on('child-process-gone', (_e, details) => {
    if (inChiusura || !details || details.reason === 'clean-exit') return;
    // Un processo comune a tutte le finestre: con sole finestre incognito aperte non si conta.
    contatori.erroreVisto(`crash:processo:${motivo(details)}`, { incognito: !finestre().some((w) => !w._filoIncognito) });
    // Quale processo (#1466): GPU, Utility e gli altri non schede, come lo dice Electron; anche prima della prima finestra.
    contatori.processoMorto(details.type, details.reason);
  });
  app.on('web-contents-created', (_e, wc) => {
    wc.on('unresponsive', () => {
      if (inChiusura) return;
      const d = doveDi(wc);
      contatori.erroreVisto(`bloccata:${d.dove}`, { incognito: d.incognito });
    });
  });
}

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const A = globalThis.SN_CONST.ACTIONS;
  const C = globalThis.SN_CONTATORI;
  const contatori = Servizio.crea({
    // Le funzioni che preparano una risposta prima che la persona la chieda: l'uso lo conta la pagina che la mostra.
    dallaPagina: [A.EXPLAIN, A.SPELLCHECK_SEMANTIC, A.SPELLCHECK_CONTEXT],
    esclusi: async () => {
      const out = [];
      try { out.push(await globalThis.SN_STORAGE.getRaw('sn_feedback_client_id', null)); } catch (_) {}
      try { out.push(globalThis.SN_WALLET_MAIN?.pseudonym?.()); } catch (_) {}
      return out.filter(Boolean);
    },
  });
  globalThis.SN_CONTATORI_MAIN = contatori;
  // La finestra (#1470): le sue misure passano dallo stesso servizio.
  const finestra = Finestra.crea({ contatori });
  globalThis.SN_CONTATORI_FINESTRA_MAIN = finestra;
  contatori.avvia();

  // Ogni scrittura delle impostazioni, chiunque l'abbia chiesta, col segno di chi l'ha chiesta (#867): un valore di
  // serie che cambia con un aggiornamento non l'ha scelto nessuno.
  const SETTINGS = globalThis.SN_CONST.STORAGE_KEYS.SETTINGS;
  Disco.onScrittura((changes, { incognito }) => {
    const c = changes && changes[SETTINGS];
    if (!c) return;
    // L'interruttore è uno per tutte le finestre: toccato in incognito, dove le impostazioni restano in memoria, va
    // scritto anche sul disco, o la finestra normale continua a contare e a spedire.
    if (incognito) {
      const attivi = (s) => !(s && s.contatori && s.contatori.attivi === false);
      const dopo = attivi(c.newValue);
      if (attivi(c.oldValue) !== dopo) {
        Promise.resolve(Disco.runNormale(() => require('../handlers').applySettingsUpdate({ contatori: { attivi: dopo } })))
          .catch(() => {});
      }
    }
    const prov = Registro.corrente();
    if (prov && prov.via === 'migrazione') return;
    contatori.impostazioniCambiate(c.oldValue, c.newValue, {
      via: C.viaDi(prov), incognito, normalizza: globalThis.SN_STORAGE && globalThis.SN_STORAGE.normalizza,
    });
  }, [SETTINGS]);

  seguiCrash(contatori, C);

  on(MSG.CONTATORI_USO, async (msg) => ({
    ok: contatori.usoDallaPagina(msg && msg.action, msg && msg.attesaMs, { anticipata: Boolean(msg && msg.anticipata === true) }),
  }));

  on(MSG.CONTATORI_EVENTO, async (msg) => {
    const m = msg && typeof msg === 'object' ? msg : {};
    const attese = { vistoMs: numero(m.vistoMs), fineMs: numero(m.fineMs) };
    let ok = false;
    switch (m.misura) {
      case 'azione': ok = contatori.azioneMisurata(testo(m.id), attese); break;
      case 'icona': ok = has(C.AZIONE_DI_ICONA, testo(m.icona)) && contatori.azioneMisurata(C.AZIONE_DI_ICONA[m.icona], attese); break;
      case 'ricerca': ok = contatori.ricerca(testo(m.pannello), { esito: testo(m.esito), attesaMs: numero(m.attesaMs), posizione: numero(m.posizione) }); break;
      case 'proposta': ok = contatori.proposta(testo(m.tipo), testo(m.modello), testo(m.esito)); break;
      case 'annullato': ok = contatori.annullatoInPagina(testo(m.tipo), numero(m.msDopo) ?? 0); break;
      case 'chiesto': ok = contatori.chiesto(testo(m.action)); break;
      case 'avviso': ok = contatori.erroreVisto(`avviso:${testo(m.chiave)}`); break;
      case 'errore-modello': {
        const tipo = C.tipoErroreVisto({ code: testo(m.code), status: numero(m.status) || 0 });
        ok = Boolean(tipo) && contatori.erroreVisto(`modello:${tipo}`);
        break;
      }
      case 'intervista': ok = contatori.intervista(testo(m.passo), testo(m.scelta)); break;
      case 'tasto-annulla': ok = contatori.tastoAnnulla(); break;
      case 'anticipo-aperto': ok = contatori.anticipoAperto(testo(m.action)); break;
      case 'conferma': ok = contatori.confermaRisposta(testo(m.chiave), testo(m.esito)); break;
      case 'voce-menu-scheda': ok = finestra.voceMenu(testo(m.id)); break;
      case 'notifica': ok = finestra.notifica(testo(m.tipo), testo(m.esito), { letta: m.letta === true, inAttesa: m.inAttesa === true }); break;
      // I gesti della personalizzazione (#1471): solo quelli che nascono in una pagina, coi campi dei loro elenchi.
      case 'gesto': ok = C.GESTI_DALLE_PAGINE.includes(testo(m.gesto)) && contatori.gesto(testo(m.gesto), m); break;
      default: ok = false;
    }
    return { ok: Boolean(ok) };
  });

  on(MSG.CONTATORI_INSTALLAZIONI, soloFilo(async () => {
    if (!ctx.isAdmin()) return { ok: false, error: 'not_admin' };
    try {
      return { ok: true, installazioni: await contatori.installazioni({ idToken: await auth.getIdToken() }) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }));
};
