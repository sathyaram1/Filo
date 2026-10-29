// I contatori della finestra (#1470): schede, chiusure, riordino, notifiche, scaricamenti e ambiente, negli elenchi
// chiusi di questo file e nel documento dell'ora che ne esce. Mai titoli, indirizzi, host, nomi di file o testi.
// Forma nelle regole: tests/unit/firestoreRulesContatoriFinestra.test.mjs. Misura: src/main/services/contatoriFinestra.js.

(function (global) {
  'use strict';

  // Un documento per pseudonimo e ora, con l'id dell'ora (#1461): le regole dell'ora sono già al tetto di espressioni.
  const VERSIONE = 1;
  const COLLEZIONE = 'contatori-finestra';
  const ALTRO = 'altro';
  const MIN = 60 * 1000;
  const ORA = 60 * MIN;
  const GIORNO = 24 * ORA;

  const FASCE_SCHEDE = Object.freeze([['n1', 1], ['n2_5', 5], ['n6_10', 10], ['n11_20', 20], ['n21_50', 50], ['oltre', Infinity]]);
  const FASCE_FINESTRE = Object.freeze([['n1', 1], ['n2', 2], ['n3_oltre', Infinity]]);
  // «tasto_destro_riga»: l'icona nella riga del tasto destro di una pagina; «tasto_destro_scheda»: «Chiudi» nel menu
  // della scheda; «barra»: la barra laterale; «chat»: il riordino chiesto alla chat (la chat non chiude da sé).
  const VIE_CHIUSURA = Object.freeze(['pulsante_x', 'clic_centrale', 'ctrl_w', 'barra', 'tasto_destro_riga',
    'tasto_destro_scheda', 'chiudi_tutto', 'riordino_automatico', 'chat', 'salva_per_dopo', ALTRO]);
  const FASCE_ETA = Object.freeze([['m1', MIN], ['m10', 10 * MIN], ['h1', ORA], ['h8', 8 * ORA], ['g1', GIORNO], ['oltre', Infinity]]);
  const INNESCHI = Object.freeze(['idle', 'reopen', 'manual']);
  const FASCE_ARCHIVIATE = Object.freeze([['n0', 0], ['n1', 1], ['n2_5', 5], ['oltre', Infinity]]);
  // Il motivo scritto dal modello non esce mai: si tiene solo se era un duplicato o una decisione del modello.
  const MOTIVI_ARCHIVIO = Object.freeze(['duplicato', 'modello']);
  const ESITI_GIRO = Object.freeze(['giudizio_mancato', 'gia_in_corso']);
  const FASCE_RIAPERTURA = Object.freeze([['m1', MIN], ['m10', 10 * MIN], ['h1', ORA], ['g1', GIORNO], ['oltre', Infinity]]);
  const RIAPERTA = 'riaperta';
  const SPOSTATA = 'spostata_a_mano';
  // Una scheda spostata a mano entro questo tempo da un riordino per colore disfa il riordino.
  const SPOSTATA_MS = 60 * 1000;
  const FASCE_DISTANZA = Object.freeze([['d1', 1], ['d2_3', 3], ['d4_10', 10], ['oltre', Infinity]]);
  // Le voci del tasto destro su una scheda (src/renderer/shell.js); «Chiudi» lo conta la chiusura.
  const VOCI_MENU_SCHEDA = Object.freeze(['tab-duplicate', 'tab-mute', 'tab-help', 'tab-proxy-pick', 'tab-proxy-clear',
    'tab-proxy-default', 'tab-cookies-auto', 'tab-cookies-show', 'tab-connesso-si', 'tab-connesso-no', 'tab-permessi-azzera']);
  // «vecchia»: la foto c'è ma la scheda ne aspetta una più nuova (è cambiata, o era a metà caricamento).
  const STATI_FOTO = Object.freeze(['pronta', 'vecchia', 'assente']);
  const ESITI_ANTEPRIMA = Object.freeze(['clic_sulla_scheda', 'via']);
  const FASCE_SOSTA = Object.freeze([['ms500', 500], ['s1', 1000], ['s2', 2000], ['s5', 5000], ['oltre', Infinity]]);
  // I tipi delle notifiche della finestra che non sono errori; gli errori hanno già il loro elenco (SN_CONTATORI.AVVISI_ERRORE).
  const TIPI_NOTIFICA_PROPRI = Object.freeze([
    'avviso_crediti', 'invito_prodotti_google', 'prodotti_google_rifiutati', 'accesso_nel_browser', 'accesso_non_ricordato',
    'segnalazione_automatica', 'segnalazione_in_attesa', 'segnalazione_non_ritirata', 'filo_spento_sito', 'menu_del_sito',
    'aiuto_spento', 'pagine_salvate_tetto', 'download_finito', 'download_nome_dato', 'download_senza_nome', 'nome_rimesso',
    'resta_connesso_proposta', 'resta_connesso_rientro', 'resta_connesso_scelta', 'permessi_azzerati', 'aperta_da_paese',
    'indirizzo_fermato', 'riordino_schede', 'scheda_ponte_chiusa', 'sito_bloccato', 'popup_bloccato', 'aggiornamento',
    'proposta_email_spenta', 'dati_avviso', 'filo_illeggibile', 'filo_pesante', 'cancella_tutto', 'riordino_mancato',
    'nessuna_chiusa', 'giudici_fermi', 'sito_fidato',
  ]);
  // «sostituita»: una gemella con la stessa chiave ha preso il suo posto; «ritirata»: Filo l'ha tolta perché il suo
  // stato è cambiato; «chiuse_tutte»: il «Chiudi tutti» della pila. «azione_2» vale anche per le azioni dopo la terza.
  const ESITI_NOTIFICA = Object.freeze(['azione_0', 'azione_1', 'azione_2', 'chiusa_x', 'scaduta', 'sostituita', 'chiuse_tutte', 'ritirata']);
  // Segni contati a parte, una volta per notifica: il puntatore ci è passato sopra; ha aspettato dietro il «+N».
  const SEGNI_NOTIFICA = Object.freeze(['letta', 'in_attesa']);
  const FORMA_TIPO = '[a-z][a-z0-9_]{0,39}';
  const LUOGHI_DOWNLOAD = Object.freeze(['pannello', 'pagina', 'notifica']);
  const AZIONI_DOWNLOAD = Object.freeze(['apri_file', 'apri_cartella', 'pausa', 'riprendi', 'annulla', 'rimuovi', 'svuota', 'rimetti_nome']);
  const RINOMINATO = 'rinominato_da_filo';
  const FASCE_LARGHEZZA = Object.freeze([['w1024', 1024], ['w1366', 1366], ['w1600', 1600], ['w1920', 1920], ['oltre', Infinity]]);
  const SCALE = Object.freeze(['1', '1_25', '1_5', '2', ALTRO]);
  const STATI_FINESTRA = Object.freeze(['normale', 'massimizzata', 'schermo_intero']);
  const TEMI = Object.freeze(['chiaro', 'scuro']);
  // La quota delle schede ripristinate chiuse nei primi minuti, in quarti come la cache delle chiamate.
  const QUOTE = Object.freeze(['zero', 'q25', 'q50', 'q75', 'q100']);
  const PRESTO_MS = 5 * MIN;

  const MAX_CONTO = 999999999;
  const nomi = (fasce) => Object.freeze(fasce.map(([k]) => k));
  const alternative = (l) => `(${l.join('|')})`;
  const intero = (n) => Number.isInteger(n) && n >= 0;
  const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const conto = (n) => (intero(n) ? Math.min(n, MAX_CONTO) : 0);

  function fasciaIn(fasce, v) {
    const n = Number(v);
    if (v == null || v === '' || !Number.isFinite(n) || n < 0) return '';
    return fasce.find(([, fino]) => n <= fino)[0];
  }

  function tipiNotifica() {
    const C = global.SN_CONTATORI;
    const errori = C && Array.isArray(C.AVVISI_ERRORE) ? C.AVVISI_ERRORE : [];
    return [...new Set([...TIPI_NOTIFICA_PROPRI, ...errori])].filter((t) => new RegExp(`^${FORMA_TIPO}$`).test(t));
  }

  // ── Le chiavi di ogni misura: l'elenco chiuso intero, e la forma che ne tengono le regole ──────────────────────
  const prodotto = (...liste) => liste.reduce((acc, l) => acc.flatMap((a) => l.map((b) => (a ? `${a}:${b}` : b))), ['']);
  const MAPPE = Object.freeze(['chiusuraScheda', 'riordinoAutomatico', 'schedaTrascinata', 'voceMenuScheda', 'anteprimaScheda',
    'notifica', 'downloadAzione', 'sessioneRipristinata']);
  const STRINGHE = Object.freeze(['schedeAperte', 'ambienteFinestra']);
  const CAMPI = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'ora', 'app', 'os', 'schedeAperte', ...MAPPE.slice(0, 7),
    'ambienteFinestra', 'sessioneRipristinata']);

  function chiaviDi(campo) {
    switch (campo) {
      case 'chiusuraScheda': return prodotto(VIE_CHIUSURA, nomi(FASCE_ETA));
      case 'riordinoAutomatico': return [
        ...prodotto(INNESCHI, [...prodotto(MOTIVI_ARCHIVIO, nomi(FASCE_ARCHIVIATE)), ...ESITI_GIRO]),
        ...prodotto([RIAPERTA], nomi(FASCE_RIAPERTURA)), SPOSTATA,
      ];
      case 'schedaTrascinata': return [...nomi(FASCE_DISTANZA)];
      case 'voceMenuScheda': return [...VOCI_MENU_SCHEDA];
      case 'anteprimaScheda': return prodotto(STATI_FOTO, ESITI_ANTEPRIMA, nomi(FASCE_SOSTA));
      case 'notifica': return prodotto(tipiNotifica(), [...ESITI_NOTIFICA, ...SEGNI_NOTIFICA]);
      case 'downloadAzione': return [...prodotto(LUOGHI_DOWNLOAD, AZIONI_DOWNLOAD), RINOMINATO];
      case 'sessioneRipristinata': return prodotto(nomi(FASCE_SCHEDE), QUOTE);
      default: return [];
    }
  }

  // La chiave di una voce come la leggono le regole: le alternative dell'elenco chiuso; i tipi delle notifiche, che
  // crescono a ogni avviso nuovo, con la loro forma.
  const CHIAVI_FORMA = Object.freeze({
    chiusuraScheda: `${alternative(VIE_CHIUSURA)}[:]${alternative(nomi(FASCE_ETA))}`,
    riordinoAutomatico: `(${alternative(INNESCHI)}[:](${alternative(MOTIVI_ARCHIVIO)}[:]${alternative(nomi(FASCE_ARCHIVIATE))}|${ESITI_GIRO.join('|')})`
      + `|${RIAPERTA}[:]${alternative(nomi(FASCE_RIAPERTURA))}|${SPOSTATA})`,
    schedaTrascinata: alternative(nomi(FASCE_DISTANZA)),
    voceMenuScheda: alternative(VOCI_MENU_SCHEDA),
    anteprimaScheda: `${alternative(STATI_FOTO)}[:]${alternative(ESITI_ANTEPRIMA)}[:]${alternative(nomi(FASCE_SOSTA))}`,
    notifica: `${FORMA_TIPO}[:]${alternative([...ESITI_NOTIFICA, ...SEGNI_NOTIFICA])}`,
    downloadAzione: `(${alternative(LUOGHI_DOWNLOAD)}[:]${alternative(AZIONI_DOWNLOAD)}|${RINOMINATO})`,
    sessioneRipristinata: `${alternative(nomi(FASCE_SCHEDE))}[:]${alternative(QUOTE)}`,
  });
  const unite = (voce) => `^(${voce}(#${voce})*)?$`;
  const FORME = Object.freeze({
    CHIAVI: Object.freeze(Object.fromEntries(MAPPE.map((c) => [c, unite(CHIAVI_FORMA[c])]))),
    CONTI: unite('[0-9]{1,9}'),
    schedeAperte: `^(${alternative(nomi(FASCE_SCHEDE))}[:]${alternative(nomi(FASCE_FINESTRE))})?$`,
    ambienteFinestra: `^(${alternative(nomi(FASCE_LARGHEZZA))}[:]${alternative(SCALE)}[:]${alternative(STATI_FINESTRA)}[:]${alternative(TEMI)})?$`,
  });
  // I tetti di caratteri delle chiavi unite e dei conti uniti, per misura: il doppio dell'elenco di oggi. Le notifiche
  // hanno posto per quasi il doppio dei tipi di oggi, a trecento caratteri di chiavi ciascuno: un avviso nuovo non
  // aspetta regole nuove, e chi scrive a mano non trova spazio oltre il doppio del caso peggiore (#1547).
  const TIPI_PREVISTI = 135;
  const TETTI = Object.freeze({
    chiusuraScheda: [2500, 1500], riordinoAutomatico: [1500, 800], schedaTrascinata: [100, 100], voceMenuScheda: [600, 300],
    anteprimaScheda: [1500, 700], notifica: [TIPI_PREVISTI * 300, TIPI_PREVISTI * 100], downloadAzione: [1000, 600],
    sessioneRipristinata: [700, 400],
  });

  // ── L'ora, in memoria ─────────────────────────────────────────────────
  // Sta nell'ora dei contatori sotto `finestra`: i suoi conti hanno già la chiave che esce.
  function vuota() {
    return { schede: 0, finestre: 0, ambiente: '', ...Object.fromEntries(MAPPE.map((c) => [c, {}])) };
  }
  function dati(ora) {
    if (!oggetto(ora)) return vuota();
    if (!oggetto(ora.finestra)) ora.finestra = vuota();
    const d = ora.finestra;
    for (const c of MAPPE) if (!oggetto(d[c])) d[c] = {};
    if (!intero(d.schede)) d.schede = 0;
    if (!intero(d.finestre)) d.finestre = 0;
    if (typeof d.ambiente !== 'string') d.ambiente = '';
    return d;
  }
  function piuUno(ora, campo, chiave) {
    const m = dati(ora)[campo];
    m[chiave] = conto(m[chiave]) + 1;
    return true;
  }
  const dalElenco = (v, l) => l.includes(v);

  // Il massimo dell'ora: schede delle finestre normali, e quante finestre normali.
  function registraSchede(ora, schede, finestre) {
    if (!intero(schede) || !intero(finestre) || schede < 1 || finestre < 1) return false;
    const d = dati(ora);
    d.schede = Math.max(d.schede, Math.min(schede, MAX_CONTO));
    d.finestre = Math.max(d.finestre, Math.min(finestre, MAX_CONTO));
    return true;
  }
  function registraChiusura(ora, via, etaMs) {
    const v = dalElenco(via, VIE_CHIUSURA) ? via : ALTRO;
    const e = fasciaIn(FASCE_ETA, etaMs);
    return e ? piuUno(ora, 'chiusuraScheda', `${v}:${e}`) : false;
  }
  // Un giro del riordino: le schede archiviate, divise fra duplicati e decisioni del modello.
  function registraGiroRiordino(ora, innesco, { duplicati = 0, modello = 0, giudizioMancato = false, giaInCorso = false } = {}) {
    if (!dalElenco(innesco, INNESCHI)) return false;
    if (giaInCorso) return piuUno(ora, 'riordinoAutomatico', `${innesco}:gia_in_corso`);
    const fd = fasciaIn(FASCE_ARCHIVIATE, duplicati);
    const fm = fasciaIn(FASCE_ARCHIVIATE, modello);
    if (!fd || !fm) return false;
    piuUno(ora, 'riordinoAutomatico', `${innesco}:duplicato:${fd}`);
    piuUno(ora, 'riordinoAutomatico', `${innesco}:modello:${fm}`);
    if (giudizioMancato) piuUno(ora, 'riordinoAutomatico', `${innesco}:giudizio_mancato`);
    return true;
  }
  function registraRiaperta(ora, msDallaChiusura) {
    const f = fasciaIn(FASCE_RIAPERTURA, msDallaChiusura);
    return f ? piuUno(ora, 'riordinoAutomatico', `${RIAPERTA}:${f}`) : false;
  }
  function registraSpostata(ora) { return piuUno(ora, 'riordinoAutomatico', SPOSTATA); }
  function registraTrascinata(ora, distanza) {
    const f = intero(distanza) && distanza >= 1 ? fasciaIn(FASCE_DISTANZA, distanza) : '';
    return f ? piuUno(ora, 'schedaTrascinata', f) : false;
  }
  function registraVoceMenu(ora, id) {
    return dalElenco(id, VOCI_MENU_SCHEDA) ? piuUno(ora, 'voceMenuScheda', id) : false;
  }
  function registraAnteprima(ora, stato, esito, sostaMs) {
    const f = fasciaIn(FASCE_SOSTA, sostaMs);
    if (!dalElenco(stato, STATI_FOTO) || !dalElenco(esito, ESITI_ANTEPRIMA) || !f) return false;
    return piuUno(ora, 'anteprimaScheda', `${stato}:${esito}:${f}`);
  }
  // Un tipo fuori elenco è «altro»: la notifica si conta lo stesso.
  function tipoNotifica(tipo) {
    const t = String(tipo || '');
    return tipiNotifica().includes(t) ? t : ALTRO;
  }
  function esitoNotifica(esito) {
    const m = /^azione_(\d{1,3})$/.exec(String(esito || ''));
    if (m) return `azione_${Math.min(Number(m[1]), 2)}`;
    return dalElenco(esito, ESITI_NOTIFICA) ? esito : '';
  }
  function registraNotifica(ora, tipo, esito, { letta = false, inAttesa = false } = {}) {
    const e = esitoNotifica(esito);
    if (!e) return false;
    const t = tipoNotifica(tipo);
    piuUno(ora, 'notifica', `${t}:${e}`);
    if (letta) piuUno(ora, 'notifica', `${t}:letta`);
    if (inAttesa) piuUno(ora, 'notifica', `${t}:in_attesa`);
    return true;
  }
  function registraDownload(ora, luogo, azione) {
    if (!dalElenco(luogo, LUOGHI_DOWNLOAD) || !dalElenco(azione, AZIONI_DOWNLOAD)) return false;
    return piuUno(ora, 'downloadAzione', `${luogo}:${azione}`);
  }
  function registraRinominato(ora) { return piuUno(ora, 'downloadAzione', RINOMINATO); }

  function scalaDi(f) {
    const n = Number(f);
    const vicino = (x) => Math.abs(n - x) < 0.01;
    if (vicino(1)) return '1';
    if (vicino(1.25)) return '1_25';
    if (vicino(1.5)) return '1_5';
    if (vicino(2)) return '2';
    return ALTRO;
  }
  // L'ultimo stato visto nell'ora: larghezza in pixel della pagina, scala dello schermo, stato, tema che si vede.
  function ambienteDi({ larghezza, scala, stato, scuro } = {}) {
    const w = fasciaIn(FASCE_LARGHEZZA, larghezza);
    if (!w || !dalElenco(stato, STATI_FINESTRA)) return '';
    return `${w}:${scalaDi(scala)}:${stato}:${scuro ? 'scuro' : 'chiaro'}`;
  }
  function registraAmbiente(ora, info) {
    const a = ambienteDi(info);
    if (!a) return false;
    dati(ora).ambiente = a;
    return true;
  }
  function quotaDi(chiuse, ripristinate) {
    const q = chiuse / ripristinate;
    if (!(q > 0)) return 'zero';
    return q <= 0.25 ? 'q25' : q <= 0.5 ? 'q50' : q <= 0.75 ? 'q75' : 'q100';
  }
  function registraSessione(ora, ripristinate, chiusePresto) {
    if (!intero(ripristinate) || ripristinate < 1 || !intero(chiusePresto)) return false;
    const f = fasciaIn(FASCE_SCHEDE, ripristinate);
    return piuUno(ora, 'sessioneRipristinata', `${f}:${quotaDi(Math.min(chiusePresto, ripristinate), ripristinate)}`);
  }

  // ── Il documento che esce: ricostruito dagli elenchi chiusi, mai copiato ───────────────────────────────────
  function contiPuliti(mappa, ammesse) {
    const out = {};
    for (const k of ammesse) {
      const n = oggetto(mappa) && has(mappa, k) ? mappa[k] : 0;
      if (intero(n) && n > 0) out[k] = String(conto(n));
    }
    return out;
  }
  function schedeAperte(d) {
    const s = fasciaIn(FASCE_SCHEDE, d.schede);
    const f = fasciaIn(FASCE_FINESTRE, d.finestre);
    return d.schede >= 1 && d.finestre >= 1 && s && f ? `${s}:${f}` : '';
  }

  // `dati`: l'ora dei contatori com'è sul disco.
  function documento({ pseudonimo, chiave, app, os, dati: ora }) {
    const C = global.SN_CONTATORI;
    const grezzo = oggetto(ora) && oggetto(ora.finestra) ? JSON.parse(JSON.stringify(ora.finestra)) : {};
    const d = dati({ finestra: grezzo });
    const [giorno, h] = String(chiave || '').split('T');
    const ambiente = new RegExp(FORME.ambienteFinestra).test(d.ambiente) ? d.ambiente : '';
    const doc = {
      v: VERSIONE,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: String(giorno || '').slice(0, 7),
      ora: String(h || ''),
      app: C ? C.versioneApp(app) : String(app || ''),
      os: C && C.OS.includes(os) ? os : ALTRO,
      schedeAperte: schedeAperte(d),
    };
    for (const c of MAPPE.slice(0, 7)) doc[c] = contiPuliti(d[c], chiaviDi(c));
    doc.ambienteFinestra = ambiente;
    doc.sessioneRipristinata = contiPuliti(d.sessioneRipristinata, chiaviDi('sessioneRipristinata'));
    return doc;
  }
  // Un'ora senza niente della finestra non ha il terzo documento.
  function senzaDati(doc) {
    return !doc || (!doc.schedeAperte && !doc.ambienteFinestra && MAPPE.every((c) => !oggetto(doc[c]) || !Object.keys(doc[c]).length));
  }

  // La forma che chiedono le regole, e in più le chiavi dell'elenco chiuso intero.
  function valida(doc) {
    const no = (motivo) => ({ ok: false, motivo });
    const C = global.SN_CONTATORI;
    if (!oggetto(doc)) return no('non è un documento');
    const chiavi = Object.keys(doc);
    if (chiavi.length !== CAMPI.length || !CAMPI.every((k) => has(doc, k))) return no(`campi: ${chiavi.join(',')}`);
    if (doc.v !== VERSIONE) return no('versione');
    if (!C) return no('contatori non caricati');
    if (!C.PSEUDONIMO_RE.test(String(doc.pseudonimo))) return no('pseudonimo');
    if (!C.GIORNO_RE.test(String(doc.giorno)) || doc.mese !== String(doc.giorno).slice(0, 7)) return no('giorno');
    if (!C.ORA_RE.test(String(doc.ora))) return no('ora');
    if (!C.APP_RE.test(String(doc.app))) return no('versione dell\'app');
    if (!C.OS.includes(doc.os)) return no('sistema');
    for (const c of STRINGHE) {
      if (typeof doc[c] !== 'string' || !new RegExp(FORME[c]).test(doc[c])) return no(c);
    }
    const conti = new RegExp(FORME.CONTI);
    for (const c of MAPPE) {
      const m = doc[c];
      if (!oggetto(m)) return no(c);
      const ammesse = new Set(chiaviDi(c));
      const ks = Object.keys(m);
      if (ks.some((k) => !ammesse.has(k))) return no(`${c}: chiave fuori elenco`);
      const vs = Object.values(m);
      if (!vs.every((v) => typeof v === 'string')) return no(`${c}: valori`);
      const [tk, tv] = TETTI[c];
      if (ks.join('#').length > tk || vs.join('#').length > tv) return no(`${c}: oltre il tetto`);
      if (!new RegExp(FORME.CHIAVI[c]).test(ks.join('#')) || !conti.test(vs.join('#'))) return no(`${c}: forma`);
    }
    return { ok: true, motivo: '' };
  }

  global.SN_CONTATORI_FINESTRA = {
    VERSIONE, COLLEZIONE, CAMPI, MAPPE, STRINGHE, FORME, TETTI, CHIAVI_FORMA, TIPI_PREVISTI,
    FASCE_SCHEDE, FASCE_FINESTRE, VIE_CHIUSURA, FASCE_ETA, INNESCHI, FASCE_ARCHIVIATE, MOTIVI_ARCHIVIO, ESITI_GIRO,
    FASCE_RIAPERTURA, SPOSTATA_MS, FASCE_DISTANZA, VOCI_MENU_SCHEDA, STATI_FOTO, ESITI_ANTEPRIMA, FASCE_SOSTA,
    TIPI_NOTIFICA_PROPRI, ESITI_NOTIFICA, SEGNI_NOTIFICA, LUOGHI_DOWNLOAD, AZIONI_DOWNLOAD, RINOMINATO, FASCE_LARGHEZZA,
    SCALE, STATI_FINESTRA, TEMI, QUOTE, PRESTO_MS,
    tipiNotifica, chiaviDi, fasciaIn, scalaDi, ambienteDi, quotaDi, tipoNotifica, esitoNotifica,
    vuota, dati, registraSchede, registraChiusura, registraGiroRiordino, registraRiaperta, registraSpostata,
    registraTrascinata, registraVoceMenu, registraAnteprima, registraNotifica, registraDownload, registraRinominato,
    registraAmbiente, registraSessione,
    documento, senzaDati, valida,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
