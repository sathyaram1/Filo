// Handler di dominio dei contatori anonimi (#969, #1461, #1462, #1465, #1467, #1471, #1473, #1474): crea il servizio, segue le impostazioni,
// riceve i gesti contati nelle pagine e dà all'owner le somme, mai sotto le cinque copie. Cosa si conta: src/main/services/contatori.js.
// Le pagine mandano solo nomi da elenchi chiusi e numeri: qui si rifiuta il resto.

const { soloFilo, daFilo } = require('./origine');
const auth = require('../../auth/google-auth');
const Servizio = require('../contatori');
const Finestra = require('../contatoriFinestra');
const Sicurezza = require('../contatoriSicurezza');
const HomePagina = require('../contatoriHomePagina');
const Somme = require('../contatoriSomme');
const Disco = require('../../shim/storage');
const Registro = require('../registroCambi');

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const testo = (v) => (typeof v === 'string' ? v : '');
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// La proposta di restare connessi è un avviso della finestra: come se ne va è la sua risposta (#1473).
const RISPOSTE_RESTA_CONNESSO = Object.freeze({
  azione_0: 'accettata', chiusa_x: 'rifiutata', scaduta: 'ignorata', sostituita: 'ignorata', chiuse_tutte: 'ignorata', ritirata: 'ignorata',
});
const sitiCoiBanner = (s) => {
  const l = s && s.security && s.security.cookies && s.security.cookies.bannerSites;
  return Array.isArray(l) ? [...new Set(l.filter((x) => typeof x === 'string' && x))] : [];
};

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
  // La sicurezza (#1474): verdetti, controlli, avvisi, pagine delicate, segreti, uscite e tetti, dallo stesso servizio.
  globalThis.SN_CONTATORI_SICUREZZA_MAIN = Sicurezza.crea({ contatori });
  // La home e quello che Filo fa da sé sulla pagina (#1473).
  const homePagina = HomePagina.crea({ contatori });
  globalThis.SN_CONTATORI_HOME_PAGINA_MAIN = homePagina;
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
    // «Mostra il banner» per un sito, da qualunque strada scelta da una persona (menu della scheda, Sicurezza,
    // Preferenze, chat): sono i siti che Filo ha rotto nascondendo il banner (#1469). Un'importazione no.
    if (['mano', 'chat'].includes(C.viaDi(prov))) {
      const prima = new Set(sitiCoiBanner(c.oldValue));
      for (const s of sitiCoiBanner(c.newValue)) {
        if (prima.has(s)) continue;
        contatori.navigazione(C.NAV.banner('mostra_banner'), { incognito });
        // Lo stesso gesto disfa il banner nascosto o rifiutato da Filo (#1473).
        homePagina.disfatto('banner_cookie', { incognito });
      }
    }
  }, [SETTINGS]);

  seguiCrash(contatori, C);
  // I conti che aspettavano il salvataggio, e le chat delle schede che se ne vanno con Filo, sul disco prima di uscire.
  try {
    const { app } = require('electron');
    for (const ev of ['before-quit', 'will-quit']) app.on(ev, () => { try { contatori.alChiudere(); } catch (_) {} });
  } catch (_) {}

  on(MSG.CONTATORI_USO, async (msg) => ({
    ok: contatori.usoDallaPagina(msg && msg.action, msg && msg.attesaMs, { anticipata: Boolean(msg && msg.anticipata === true) }),
  }));

  // Le attività che una pagina conta quando finiscono (#1467): i conti arrivano come numeri, e qui diventano fasce.
  function attivitaDellaPagina(cosa, m) {
    switch (cosa) {
      case 'aiuto': return ['aiuto', {
        esito: testo(m.esito), passiDaSolo: numero(m.passiDaSolo), passiCliccati: numero(m.passiCliccati),
        nonTrovati: numero(m.nonTrovati), documenti: numero(m.documenti),
      }];
      case 'dettatura': return ['dettatura', { motivo: testo(m.motivo), frasi: numero(m.frasi), invio: testo(m.invio), provvisorie: m.provvisorie === true }];
      case 'lettura': {
        const motivo = C.motivoLettura({
          ripiego: m.ripiego === true, codice: testo(m.codice), chiaveRifiutata: m.chiaveRifiutata === true,
          errore: m.senzaModello === true ? 'no_tts_model' : '',
        });
        return ['lettura', { voce: testo(m.voce), motivo, fino: C.finoLettura(numero(m.quota), m.finita === true) }];
      }
      default: return null;
    }
  }
  // Una pagina che si chiude non lo dice (chiudere una scheda non le dà eventi): quello che aveva aperto lo conta il
  // main quando la sua WebContents se ne va. `id` distingue due attività dello stesso tipo nella stessa pagina.
  const seguite = new WeakSet();
  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  function chiaveInCorso(sender, cosa, id) {
    const wc = sender && sender.wc;
    if (!wc || typeof wc.id !== 'number' || !ID_RE.test(String(id || ''))) return '';
    if (!seguite.has(wc) && typeof wc.once === 'function') {
      seguite.add(wc);
      const prefisso = `${wc.id}|`;
      wc.once('destroyed', () => contatori.chiudiInCorso(prefisso));
    }
    return `${wc.id}|${cosa}|${id}`;
  }

  // Le misure della home (#1473) nascono solo in una pagina di Filo: da un sito non arrivano.
  const DELLA_HOME = new Set(['comando-home', 'ricerca-home', 'ricerca-home-aperta', 'risali', 'risali-fine']);
  on(MSG.CONTATORI_EVENTO, async (msg, sender, origin) => {
    const m = msg && typeof msg === 'object' ? msg : {};
    if (DELLA_HOME.has(m.misura) && !daFilo(origin, sender)) return { ok: false };
    if (m.misura === 'in-corso') {
      const a = attivitaDellaPagina(testo(m.cosa), m);
      const k = a ? chiaveInCorso(sender, m.cosa, m.id) : '';
      return { ok: Boolean(k) && contatori.apertaInCorso(k, a[0], a[1]) };
    }
    const fine = attivitaDellaPagina(testo(m.misura), m);
    if (fine) {
      const k = m.id == null ? '' : chiaveInCorso(sender, m.misura, m.id);
      if (k) contatori.finitaInCorso(k);
      return { ok: contatori.attivita(fine[0], fine[1]) };
    }
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
      case 'notifica':
        ok = finestra.notifica(testo(m.tipo), testo(m.esito), { letta: m.letta === true, inAttesa: m.inAttesa === true });
        if (testo(m.tipo) === 'resta_connesso_proposta' && has(RISPOSTE_RESTA_CONNESSO, testo(m.esito))) {
          homePagina.proposta('resta_connesso', RISPOSTE_RESTA_CONNESSO[m.esito]);
        }
        break;
      // I gesti della personalizzazione (#1471): solo quelli che nascono in una pagina, coi campi dei loro elenchi.
      case 'gesto': ok = C.GESTI_DALLE_PAGINE.includes(testo(m.gesto)) && contatori.gesto(testo(m.gesto), m); break;
      // I riquadri AI e l'Editor (#1465): la voce si costruisce dai soli campi degli elenchi, il resto del messaggio si perde.
      case 'riquadro': ok = contatori.riquadro(C.voceRiquadro(testo(m.cosa), m)); break;
      case 'reazione': ok = contatori.reazione(testo(m.voce)); break;
      case 'copia': ok = contatori.copia(testo(m.ruolo)); break;
      case 'ricerca-web-tetto': ok = contatori.attivita('ricercaWeb', { da: 'aiuto', alTetto: true }); break;
      case 'suggerimento': ok = contatori.attivita('suggerimenti', { tipo: testo(m.tipo), posizione: numero(m.posizione), etaMs: numero(m.etaMs) }); break;
      // La barra della home (#1473): l'avviso del sito non trovato e i «risali» di fila restano aperti nella pagina finché
      // non finiscono, e li chiude il main se la scheda se ne va.
      case 'comando-home': {
        const cosa = testo(m.cosa);
        ok = cosa === globalThis.SN_CONTATORI_HOME_PAGINA.NON_RISOLTO
          ? homePagina.nonRisolto(chiaveInCorso(sender, 'non-risolto', 'home'), testo(m.scelta))
          : homePagina.comando(cosa);
        break;
      }
      case 'ricerca-home': ok = homePagina.ricerca(numero(m.risultati), { ripetuta: m.ripetuta === true }); break;
      case 'ricerca-home-aperta': ok = homePagina.aperto(testo(m.tipo), numero(m.posizione), numero(m.ms)); break;
      case 'risali': ok = homePagina.risaliDiFila(chiaveInCorso(sender, 'risali', 'home'), numero(m.pezzi)); break;
      case 'risali-fine': ok = homePagina.fineInCorso(chiaveInCorso(sender, 'risali', 'home')); break;
      // Dalle pagine web arriva solo quello che vede soltanto la pagina: la pubblicità saltata.
      case 'automatismo': ok = testo(m.tipo) === 'pubblicita_saltata' && homePagina.fatto('pubblicita_saltata'); break;
      default: ok = false;
    }
    return { ok: Boolean(ok) };
  });

  on(MSG.CONTATORI_INSTALLAZIONI, soloFilo(async () => {
    if (!ctx.isAdmin()) return { ok: false, error: 'not_admin' };
    try {
      const i = await contatori.installazioni({ idToken: await auth.getIdToken() });
      return { ok: true, installazioni: { ...i, ieri: Somme.sottoSoglia(i && i.ieri), mese: Somme.sottoSoglia(i && i.mese) } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }));

  on(MSG.CONTATORI_SOMME, soloFilo(async (msg) => {
    if (!ctx.isAdmin()) return { ok: false, error: 'not_admin' };
    const m = msg && typeof msg === 'object' ? msg : {};
    try {
      return {
        ok: true,
        somme: await contatori.somme({
          idToken: await auth.getIdToken(), dal: testo(m.dal), al: testo(m.al), app: testo(m.app), os: testo(m.os), forza: m.forza === true,
        }),
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }));
};
