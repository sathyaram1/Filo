// Le somme dei contatori anonimi per la scheda Contatori di Gestione (#1462): legge i documenti di un intervallo e li somma.
// Alla pagina escono solo somme, e una cella contata su meno di cinque copie esce senza numero. Forma dei documenti:
// src/shared/contatoriGiornalieri.js; la porta dell'owner: src/main/services/handlers/contatori.js.

'use strict';

// Sotto questa soglia di copie una cella dice «meno di 5»: con pochi tester, un numero è il comportamento di uno di loro.
const SOGLIA_COPIE = 5;
const PAGINA = 1000;
// Duecentomila documenti prima di dire che la lettura è parziale: un mese di cinquecento copie sempre accese.
const TETTO_PAGINE = 200;
const ATTESA_RETE_MS = 30000;
// Le ore nuove arrivano ogni ora: una lettura vale dieci minuti per la stessa richiesta, «Rileggi» la rifà subito.
const VALE_MS = 10 * 60 * 1000;
const RICHIESTE_TENUTE = 4;
// Tre anni: i contatori orari esistono dal 2026, e oltre una colonna al mese non si legge più.
const TETTO_GIORNI = 1100;
const GIORNI_PER_GIORNO = 62;
const GIORNI_PER_SETTIMANA = 548;
// I campi che la scheda somma, e nient'altro: «primo» e «mese» si ricavano o non servono.
const CAMPI_LETTI = Object.freeze(['v', 'pseudonimo', 'giorno', 'ora', 'app', 'os', 'uso', 'errori', 'azioni',
  'impostazioni', 'ricerche', 'correttore', 'conferme', 'annullati', 'anticipi', 'chiedi', 'erroriVisti', 'intervista',
  'primeVolte']);

const ESITI_CONFERMA_CHIAVE = Object.freeze({
  automatica: 'automatica', approvata: 'approvata', rifiutata: 'rifiutata', 'senza-risposta': 'senzaRisposta',
  negata: 'negata', pannello: 'pannello',
});

// ── Celle ──────────────────────────────────────────────────────────────────
// Un conto tiene gli eventi e le copie per mese: lo pseudonimo cambia ogni mese, e una copia attiva in due mesi ne
// porta due. Per la soglia vale il mese con più copie, che non conta mai una copia due volte.
function conto() { return { n: 0, mesi: new Map() }; }

function aggiungi(c, doc, k = 1) {
  const n = Number(k);
  if (!Number.isFinite(n) || n <= 0) return;
  c.n += n;
  let s = c.mesi.get(doc.m);
  if (!s) c.mesi.set(doc.m, (s = new Set()));
  s.add(doc.p);
}

function copieDi(c) {
  let minimo = 0;
  let somma = 0;
  for (const s of c.mesi.values()) { minimo = Math.max(minimo, s.size); somma += s.size; }
  return { minimo, somma };
}

function cella(c) {
  const { minimo, somma } = copieDi(c || conto());
  return minimo < SOGLIA_COPIE ? { sotto: true } : { n: c.n, copie: somma };
}

// La cella di un conto di copie: il numero è quello delle copie.
function cellaCopie(c) {
  const { minimo, somma } = copieDi(c || conto());
  return minimo < SOGLIA_COPIE ? { sotto: true } : { n: somma, copie: somma };
}

// Una quota si mostra solo se i due numeri da cui nasce si mostrano: se no il nascosto si ricava per divisione.
function quota(a, b) {
  if (!a || !b || a.sotto || b.sotto) return { sotto: true };
  return b.n > 0 ? { quota: a.n / b.n } : { quota: null };
}

function differenza(a, b) {
  if (!a || !b || a.sotto || b.sotto) return { sotto: true };
  return { n: Math.max(0, a.n - b.n) };
}

// ── Il calendario ────────────────────────────────────────────────────────────
const due = (n) => String(n).padStart(2, '0');
function giornoDa(d) { return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`; }
function dataDi(g) { const [y, m, d] = String(g).split('-').map(Number); return new Date(y, m - 1, d, 12); }
function giornoDopo(g) { const d = dataDi(g); d.setDate(d.getDate() + 1); return giornoDa(d); }
function giornoValido(g, C) { return C.GIORNO_RE.test(String(g || '')) && giornoDa(dataDi(g)) === g; }

function giorniFra(dal, al) {
  const out = [];
  for (let g = dal; g <= al && out.length < 40000; g = giornoDopo(g)) out.push(g);
  return out;
}

function passoPer(nGiorni) {
  if (nGiorni <= GIORNI_PER_GIORNO) return 'giorno';
  return nGiorni <= GIORNI_PER_SETTIMANA ? 'settimana' : 'mese';
}

// La settimana porta il nome del suo lunedì.
function periodoDi(g, passo) {
  if (passo === 'giorno') return g;
  if (passo === 'mese') return g.slice(0, 7);
  const d = dataDi(g);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return giornoDa(d);
}

function periodiFra(giorni, passo) {
  const out = [];
  for (const g of giorni) {
    const k = periodoDi(g, passo);
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.chiave === k) ultimo.al = g;
    else out.push({ chiave: k, dal: g, al: g });
  }
  return out;
}

// ── I documenti letti ────────────────────────────────────────────────────────
// Le chiavi delle mappe le sceglie chi scrive il documento: tabelle senza eredità.
function daFs(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return String(v.stringValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(daFs);
  if ('mapValue' in v) {
    const o = Object.create(null);
    for (const [k, x] of Object.entries((v.mapValue && v.mapValue.fields) || {})) o[k] = daFs(x);
    return o;
  }
  return null;
}

function documentoDa(fields, C) {
  const d = daFs({ mapValue: { fields } }) || Object.create(null);
  const p = String(d.pseudonimo || '');
  const g = String(d.giorno || '');
  if (!C.PSEUDONIMO_RE.test(p) || !C.GIORNO_RE.test(g)) return null;
  const ora = String(d.ora || '');
  return {
    v: Number(d.v) || 0, p, g, m: g.slice(0, 7), h: C.ORA_RE.test(ora) ? Number(ora) : null,
    app: C.APP_RE.test(String(d.app || '')) ? String(d.app) : '0.0.0',
    os: C.OS.includes(d.os) ? d.os : 'altro',
    dati: d,
  };
}

const mappa = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : Object.create(null));
const voci = (s) => (typeof s === 'string' && s ? s.split(';') : []);
const intero = (x) => { const n = Number(x); return Number.isInteger(n) && n > 0 ? n : 0; };

// ── Le etichette, dai cataloghi che le possiedono ────────────────────────────
function catalogo(g = globalThis) {
  const C = g.SN_CONTATORI;
  const caps = (g.SN_CAPABILITIES && Array.isArray(g.SN_CAPABILITIES.CAPABILITIES)) ? g.SN_CAPABILITIES.CAPABILITIES : [];
  const usi = (g.SN_MODEL_USAGE && Array.isArray(g.SN_MODEL_USAGE.ENTRIES)) ? g.SN_MODEL_USAGE.ENTRIES : [];
  const vociCambi = (g.SN_CAMBI && g.SN_CAMBI.VOCI) || {};
  const passi = (g.SN_ONBOARDING && Array.isArray(g.SN_ONBOARDING.ITEMS)) ? g.SN_ONBOARDING.ITEMS : [];
  const t = (k) => { try { const s = g.SN_I18N && g.SN_I18N.t(k); return s && s !== k ? s : ''; } catch (_) { return ''; } };
  const grande = (s) => { const x = String(s || ''); return x ? x[0].toUpperCase() + x.slice(1) : x; };
  const titoloAzione = (id) => (id === C.AVVIO ? 'Avvio di Filo' : ((caps.find((c) => c.id === id) || {}).title || ''));
  const titoloFunzione = (id) => (usi.find((e) => e.id === id) || {}).label || '';
  return {
    azioni: () => C.azioni(),
    funzioni: () => C.funzioni(),
    azione: (id) => titoloAzione(id) || id,
    funzione: (id) => titoloFunzione(id) || id,
    primaVolta: (id) => titoloFunzione(id) || titoloAzione(id) || id,
    impostazione(k) {
      if (k === 'altro') return 'Altre impostazioni';
      if (k === 'autonomia.livello') return 'Quanto Filo fa da solo';
      if (k === 'autonomia.*') return 'Quanto Filo fa da solo, per tipo d’azione';
      const v = Object.prototype.hasOwnProperty.call(vociCambi, k) ? vociCambi[k] : null;
      let nome = v && v.nome;
      if (typeof nome === 'function') { try { nome = nome('…'); } catch (_) { nome = ''; } }
      return grande(typeof nome === 'string' && nome ? nome : k);
    },
    valore(k, valore) {
      if (valore === 'cambiato') return 'un valore scritto';
      const v = Object.prototype.hasOwnProperty.call(vociCambi, k) ? vociCambi[k] : null;
      const nomi = v && v.valori && typeof v.valori === 'object' ? v.valori : null;
      return nomi && Object.prototype.hasOwnProperty.call(nomi, valore) && typeof nomi[valore] === 'string' ? nomi[valore] : valore;
    },
    passo(id) {
      if (id === 'chiusura') return 'Fine dell’intervista';
      return (passi.find((p) => p.id === id) || {}).label || id;
    },
    tipoAzione(tipo) {
      if (tipo === C.AZIONE_PAGINA) return 'Azioni dell’Aiuto nella pagina';
      const pagina = { correzione: 'Correzione del correttore', 'correzione-automatica': 'Correzione automatica', 'modifica-testo': 'Modifica del testo' };
      if (pagina[tipo]) return pagina[tipo];
      return grande(String(tipo).toLowerCase().replace(/_/g, ' '));
    },
    erroreVisto: (k) => etichettaErrore(k, t),
    pannello: (p) => PANNELLI[p] || p,
    tipoProposta: (tp) => TIPI_PROPOSTA[tp] || tp,
  };
}

const PANNELLI = Object.freeze({
  'cerca-filo': 'Cerca nella home', incolla: 'Incolla dalla cronologia', font: 'Scelta del font', modello: 'Scelta del modello',
  'barra-laterale': 'Barra laterale', 'tasto-destro': 'Tasto destro', menu: 'Menu a comparsa',
});
const TIPI_PROPOSTA = Object.freeze({ ortografia: 'Parola', frase: 'Frase', coerenza: 'Coerenza', suggerimento: 'Suggerimento' });
const DOVE = Object.freeze({ scheda: 'Scheda', finestra: 'Finestra', vista: 'Pannello di Filo', processo: 'Processo di Filo' });
const MOTIVI = Object.freeze({
  'abnormal-exit': 'uscita anomala', killed: 'chiusa dal sistema', crashed: 'crash', oom: 'memoria finita',
  'launch-failed': 'non partita', 'integrity-failure': 'file danneggiati', 'memory-eviction': 'memoria ripresa dal sistema',
  altro: 'altro motivo',
});
const GUASTI = Object.freeze({
  rete: 'rete', tempo: 'tempo scaduto', crediti: 'crediti finiti', chiave: 'chiave rifiutata',
  nessun_host: 'nessun fornitore ammesso', fornitore: 'errore del fornitore', senza_chiave: 'manca la chiave',
  limite_spesa: 'tetto di spesa raggiunto', senza_modello: 'nessun modello scelto', senza_pesi_aperti: 'nessun modello a pesi aperti',
  dati_fornitore: 'regole sui dati del fornitore', risposta_tagliata: 'risposta tagliata', tetto_risposta: 'tetto della risposta',
  modello_assente: 'modello non disponibile', moderazione: 'moderazione', troppe_richieste: 'troppe richieste', altro: 'altro',
});

function etichettaErrore(k, t) {
  const [a, b, c] = String(k).split(':');
  if (a === 'crash') return `${DOVE[b] || b} caduta: ${MOTIVI[c] || c}`;
  if (a === 'bloccata') return `${DOVE[b] || b} bloccata`;
  if (a === 'rete') return b === 'bloccato' ? 'Pagina bloccata dalla rete' : `Pagina d’errore di rete (${b})`;
  if (a === 'chat') return `Risposta non arrivata in chat: ${GUASTI[b] || b}`;
  if (a === 'modello') return `Risposta non arrivata in una pagina: ${GUASTI[b] || b}`;
  if (a === 'avviso') return `Avviso «${t(b) || String(b).replace(/_/g, ' ')}»`;
  return String(k);
}

// ── La somma ───────────────────────────────────────────────────────────────
// Una riga per voce: le celle e, per la cella principale, un conto per periodo (l'andamento che la riga apre).
function righe() {
  const m = new Map();
  return {
    m,
    riga(id, fai) {
      let r = m.get(id);
      if (!r) m.set(id, (r = { id, principale: conto(), periodi: new Map(), ...fai() }));
      return r;
    },
  };
}

function principale(r, doc, periodo, k = 1) {
  aggiungi(r.principale, doc, k);
  if (Number(k) > 0) {
    let c = r.periodi.get(periodo);
    if (!c) r.periodi.set(periodo, (c = conto()));
    aggiungi(c, doc, k);
  }
}

function chiusa(r, periodi, etichetta, celle, { copie = false } = {}) {
  const fai = copie ? cellaCopie : cella;
  const p = fai(r.principale);
  return {
    id: r.id, etichetta, principale: p, celle,
    ...(p.sotto ? {} : { periodi: periodi.map((x) => fai(r.periodi.get(x.chiave))) }),
  };
}

const fasceVuote = (nomi) => nomi.map(() => conto());

function somma(documenti, { dal, al, app = '', os = '', completo = true, lettoAlle = 0, C = globalThis.SN_CONTATORI, cat = null } = {}) {
  const K = cat || catalogo();
  const giorni = giorniFra(dal, al);
  const passo = passoPer(giorni.length);
  const periodi = periodiFra(giorni, passo);
  const tutti = (Array.isArray(documenti) ? documenti : []).filter((d) => d && d.g >= dal && d.g <= al);
  const versioni = [...new Set(tutti.map((d) => d.app))].sort(confrontaVersioni);
  const docs = tutti.filter((d) => (!app || d.app === app) && (!os || d.os === os));

  const copie = { totale: conto(), periodi: new Map(), ore: Array.from({ length: 24 }, () => conto()), orePer: new Map() };
  const attese = righe();
  const ricerche = righe();
  const correttore = righe();
  const conferme = righe();
  const impostazioni = righe();
  const anticipi = righe();
  const chiedi = righe();
  const erroriVisti = righe();
  const guasti = righe();
  const intervista = righe();
  const primeVolte = righe();

  const rigaAttesa = (id) => attese.riga(id, () => ({
    n: conto(), visto: fasceVuote(C.NOMI_FASCE), fine: fasceVuote(C.NOMI_FASCE), rifatte: conto(),
  }));

  for (const doc of docs) {
    const per = periodoDi(doc.g, passo);
    const d = doc.dati;
    // Le copie attive: ogni documento è un'ora (o un giorno, d'allora) con Filo aperto.
    aggiungi(copie.totale, doc);
    if (!copie.periodi.has(per)) copie.periodi.set(per, conto());
    aggiungi(copie.periodi.get(per), doc);
    if (doc.h != null) {
      aggiungi(copie.ore[doc.h], doc);
      if (!copie.orePer.has(per)) copie.orePer.set(per, Array.from({ length: 24 }, () => conto()));
      aggiungi(copie.orePer.get(per)[doc.h], doc);
    }

    const misure = (m, prefisso) => {
      for (const [k, s] of Object.entries(mappa(m))) {
        const x = doc.v === C.VERSIONE_GIORNO ? C.leggiUso(s) : C.leggiMisura(s);
        if (!x || !x.n) continue;
        const r = rigaAttesa(`${prefisso}:${k}`);
        principale(r, doc, per, x.n);
        aggiungi(r.n, doc, x.n);
        if (doc.v !== C.VERSIONE_GIORNO) {
          C.NOMI_FASCE.forEach((f, i) => { aggiungi(r.visto[i], doc, x.visto[f]); aggiungi(r.fine[i], doc, x.fine[f]); });
          aggiungi(r.rifatte, doc, x.ripetute);
        }
      }
    };
    misure(d.azioni, 'a');
    misure(d.uso, 'f');

    for (const [f, s] of Object.entries(mappa(d.errori))) {
      for (const e of (C.leggiErrori(s) || [])) {
        const r = guasti.riga(`${f}|${e.modello}|${e.host}|${e.tipo}`, () => ({ f, modello: e.modello, host: e.host, tipo: e.tipo }));
        principale(r, doc, per, e.n);
      }
    }
    if (doc.v === C.VERSIONE_GIORNO) continue;

    for (const [p, s] of Object.entries(mappa(d.ricerche))) {
      const x = C.leggiRicerca(s);
      if (!x) continue;
      const r = ricerche.riga(p, () => ({ aperte: conto(), scelte: conto(), tempo: fasceVuote(C.NOMI_FASCE), posizioni: fasceVuote(C.NOMI_POSIZIONI), vuote: conto() }));
      principale(r, doc, per, x.aperte);
      aggiungi(r.aperte, doc, x.aperte);
      aggiungi(r.vuote, doc, x.vuote);
      C.NOMI_FASCE.forEach((f, i) => { aggiungi(r.tempo[i], doc, x.scelte[f]); aggiungi(r.scelte, doc, x.scelte[f]); });
      C.NOMI_POSIZIONI.forEach((f, i) => aggiungi(r.posizioni[i], doc, x.posizioni[f]));
    }

    for (const [tipo, s] of Object.entries(mappa(d.correttore))) {
      for (const v of voci(s)) {
        const [modello, numeri] = v.split('|');
        const n = String(numeri || '').split(',').map(intero);
        if (n.length !== 4) continue;
        for (const id of [tipo, `${tipo}|${modello}`]) {
          const r = correttore.riga(id, () => ({ tipo, modello: id === tipo ? '' : modello, esiti: [conto(), conto(), conto(), conto()] }));
          principale(r, doc, per, n[0]);
          n.forEach((x, i) => aggiungi(r.esiti[i], doc, x));
        }
      }
    }

    const rigaConferma = (tipo) => conferme.riga(tipo, () => ({
      ...Object.fromEntries(Object.values(ESITI_CONFERMA_CHIAVE).map((k) => [k, conto()])), annullati: conto(),
    }));
    for (const [tipo, s] of Object.entries(mappa(d.conferme))) {
      for (const v of voci(s)) {
        const parti = v.split('|');
        const n = intero(parti[parti.length - 1]);
        const esito = ESITI_CONFERMA_CHIAVE[parti[parti.length - 2]];
        if (!n || !esito) continue;
        const r = rigaConferma(tipo);
        principale(r, doc, per, n);
        aggiungi(r[esito], doc, n);
      }
    }
    for (const [tipo, s] of Object.entries(mappa(d.annullati))) {
      const n = intero(s);
      if (!n) continue;
      const r = rigaConferma(tipo);
      principale(r, doc, per, n);
      aggiungi(r.annullati, doc, n);
    }

    for (const [k, s] of Object.entries(mappa(d.impostazioni))) {
      const r = impostazioni.riga(k, () => ({ cambi: conto(), valori: new Map(), vie: new Map() }));
      let qui = 0;
      for (const v of voci(s)) {
        const [valore, via, numero] = v.split('|');
        const n = intero(numero);
        if (!n || !C.VIE.includes(via)) continue;
        qui += n;
        aggiungi(r.cambi, doc, n);
        if (!r.valori.has(valore)) r.valori.set(valore, conto());
        aggiungi(r.valori.get(valore), doc, n);
        if (!r.vie.has(via)) r.vie.set(via, conto());
        aggiungi(r.vie.get(via), doc, n);
      }
      if (qui) principale(r, doc, per, qui);
    }

    for (const [f, s] of Object.entries(mappa(d.anticipi))) {
      const [a, b] = String(s).split(';').map(intero);
      if (!a && !b) continue;
      const r = anticipi.riga(f, () => ({ preparati: conto(), aperti: conto() }));
      principale(r, doc, per, a);
      aggiungi(r.preparati, doc, a);
      aggiungi(r.aperti, doc, b);
    }

    for (const [dest, m] of [[chiedi, d.chiedi], [erroriVisti, d.erroriVisti]]) {
      for (const [k, s] of Object.entries(mappa(m))) {
        const n = intero(s);
        if (n) principale(dest.riga(k, () => ({})), doc, per, n);
      }
    }

    for (const [passoIntervista, s] of Object.entries(mappa(d.intervista))) {
      const r = intervista.riga(passoIntervista, () => ({ scelte: new Map() }));
      for (const v of voci(s)) {
        const [scelta, numero] = v.split('|');
        const n = intero(numero);
        if (!n) continue;
        principale(r, doc, per, n);
        if (!r.scelte.has(scelta)) r.scelte.set(scelta, conto());
        aggiungi(r.scelte.get(scelta), doc, n);
      }
    }

    for (const id of Array.isArray(d.primeVolte) ? new Set(d.primeVolte.map(String)) : []) {
      principale(primeVolte.riga(id, () => ({})), doc, per, 1);
    }
  }

  // Le voci degli elenchi chiusi ci sono tutte, anche mai viste: zero e «meno di 5» non si distinguono.
  for (const id of K.azioni()) rigaAttesa(`a:${id}`);
  for (const id of K.funzioni()) rigaAttesa(`f:${id}`);
  for (const p of C.PANNELLI) ricerche.riga(p, () => ({ aperte: conto(), scelte: conto(), tempo: fasceVuote(C.NOMI_FASCE), posizioni: fasceVuote(C.NOMI_POSIZIONI), vuote: conto() }));
  for (const t of [...C.tipiAzione(), ...C.ANNULLABILI_IN_PAGINA]) {
    conferme.riga(t, () => ({ ...Object.fromEntries(Object.values(ESITI_CONFERMA_CHIAVE).map((k) => [k, conto()])), annullati: conto() }));
  }
  for (const k of [...C.chiaviImpostazioni(), 'altro']) impostazioni.riga(k, () => ({ cambi: conto(), valori: new Map(), vie: new Map() }));
  for (const p of C.passiIntervista()) intervista.riga(p, () => ({ scelte: new Map() }));
  for (const id of new Set([...K.funzioni(), ...K.azioni()])) primeVolte.riga(id, () => ({}));
  for (const tp of C.TIPI_PROPOSTA) correttore.riga(tp, () => ({ tipo: tp, modello: '', esiti: [conto(), conto(), conto(), conto()] }));

  const lista = (r) => [...r.m.values()];
  const fasce = (arr) => arr.map(cella);

  const outAttese = lista(attese).map((r) => {
    const [tipo, id] = [r.id.slice(0, 1), r.id.slice(2)];
    const n = cella(r.n);
    const rif = cella(r.rifatte);
    return chiusa(r, periodi, tipo === 'a' ? K.azione(id) : K.funzione(id), {
      tipo: tipo === 'a' ? 'azione' : 'funzione', n, visto: fasce(r.visto), fine: fasce(r.fine), rifatte: rif, rifatteQuota: quota(rif, n),
    });
  });

  const outRicerche = lista(ricerche).map((r) => {
    const aperte = cella(r.aperte);
    const vuote = cella(r.vuote);
    return chiusa(r, periodi, K.pannello(r.id), {
      aperte, scelte: cella(r.scelte), tempo: fasce(r.tempo), posizioni: fasce(r.posizioni), vuote, vuoteQuota: quota(vuote, aperte),
    });
  });

  const outCorrettore = lista(correttore).map((r) => {
    const [mostrate, accettate, rifiutate, ignorate] = r.esiti.map(cella);
    const nome = K.tipoProposta(r.tipo);
    return chiusa(r, periodi, r.modello ? r.modello : `${nome}, tutti i modelli`, {
      tipo: r.tipo, tipoNome: nome, modello: r.modello, mostrate, accettate, rifiutate, ignorate, accettateQuota: quota(accettate, mostrate),
    });
  });

  const outConferme = lista(conferme).map((r) => chiusa(r, periodi, K.tipoAzione(r.id), {
    ...Object.fromEntries(Object.values(ESITI_CONFERMA_CHIAVE).map((k) => [k, cella(r[k])])),
    annullati: cella(r.annullati), soloPagina: C.ANNULLABILI_IN_PAGINA.includes(r.id),
  }));

  const outImpostazioni = lista(impostazioni).map((r) => chiusa(r, periodi, K.impostazione(r.id), {
    cambi: cella(r.cambi),
    valori: [...r.valori.entries()].map(([v, c]) => ({ valore: v, etichetta: K.valore(r.id, v), copie: cellaCopie(c) }))
      .sort(perCella),
    vie: Object.fromEntries(C.VIE.map((v) => [v, cellaCopie(r.vie.get(v))])),
  }, { copie: true }));

  const outAnticipi = lista(anticipi).map((r) => {
    const preparati = cella(r.preparati);
    const aperti = cella(r.aperti);
    const maiVisti = differenza(preparati, aperti);
    return chiusa(r, periodi, K.funzione(r.id), { preparati, aperti, maiVisti, maiVistiQuota: quota(maiVisti, preparati) });
  });

  const outChiedi = lista(chiedi).map((r) => chiusa(r, periodi, K.funzione(r.id), {}));
  const outErrori = lista(erroriVisti).map((r) => chiusa(r, periodi, K.erroreVisto(r.id), {}));
  const outGuasti = lista(guasti).map((r) => chiusa(r, periodi, K.funzione(r.f), { modello: r.modello, host: r.host, tipo: GUASTI[r.tipo] || r.tipo }));
  const ordinePassi = C.passiIntervista();
  const outIntervista = lista(intervista)
    .sort((a, b) => indice(ordinePassi, a.id) - indice(ordinePassi, b.id))
    .map((r) => chiusa(r, periodi, K.passo(r.id), {
      scelte: [...r.scelte.entries()].sort((a, b) => indice(C.SCELTE_INTERVISTA, a[0]) - indice(C.SCELTE_INTERVISTA, b[0]))
        .map(([s, c]) => ({ scelta: s, copie: cellaCopie(c), n: cella(c) })),
    }, { copie: true }));
  const outPrime = lista(primeVolte).map((r) => chiusa(r, periodi, K.primaVolta(r.id), {}, { copie: true }));

  return {
    dal, al, passo, soglia: SOGLIA_COPIE, completo: completo !== false, lettoAlle, app, os, versioni, sistemi: [...C.OS],
    periodi: periodi.map((p) => ({ chiave: p.chiave, dal: p.dal, al: p.al })),
    copie: {
      totale: cellaCopie(copie.totale),
      mesi: new Set(docs.map((x) => x.m)).size,
      periodi: periodi.map((p) => cellaCopie(copie.periodi.get(p.chiave))),
      ore: copie.ore.map(cellaCopie),
      orePer: Object.fromEntries(periodi.map((p) => [p.chiave, (copie.orePer.get(p.chiave) || Array.from({ length: 24 }, () => conto())).map(cellaCopie)])),
    },
    attese: ordina(outAttese),
    ricerche: outRicerche.sort((a, b) => indice(C.PANNELLI, a.id) - indice(C.PANNELLI, b.id)),
    correttore: ordinaCorrettore(outCorrettore, C.TIPI_PROPOSTA),
    conferme: ordina(outConferme),
    impostazioni: ordina(outImpostazioni),
    anticipi: ordina(outAnticipi),
    chiedi: ordina(outChiedi),
    erroriVisti: ordina(outErrori),
    guasti: ordina(outGuasti),
    intervista: outIntervista,
    primeVolte: ordina(outPrime),
  };
}

function indice(l, x) { const i = l.indexOf(x); return i < 0 ? l.length : i; }
function perCella(a, b) {
  const va = a.copie && !a.copie.sotto ? a.copie.n : -1;
  const vb = b.copie && !b.copie.sotto ? b.copie.n : -1;
  return vb - va || String(a.etichetta).localeCompare(String(b.etichetta), 'it');
}
// Prima le righe che si mostrano, dalla più grande; poi quelle sotto la soglia, in ordine di nome.
function ordina(l) {
  const v = (r) => (r.principale.sotto ? -1 : r.principale.n);
  return l.sort((a, b) => v(b) - v(a) || String(a.etichetta).localeCompare(String(b.etichetta), 'it'));
}
function ordinaCorrettore(l, tipi) {
  const v = (r) => (r.principale.sotto ? -1 : r.principale.n);
  return l.sort((a, b) => indice(tipi, a.celle.tipo) - indice(tipi, b.celle.tipo)
    || (a.celle.modello ? 1 : 0) - (b.celle.modello ? 1 : 0) || v(b) - v(a) || a.etichetta.localeCompare(b.etichetta, 'it'));
}

function confrontaVersioni(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
}

// ── La lettura ───────────────────────────────────────────────────────────────
function crea(dip = {}) {
  const C = dip.contatori || globalThis.SN_CONTATORI;
  const fetchFn = dip.fetch || ((...a) => fetch(...a));
  const rest = dip.rest || (() => (globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.rest) || {});
  const adesso = dip.adesso || (() => Date.now());
  const oggi = dip.oggi || (() => giornoDa(new Date(adesso())));
  const log = dip.log || ((...a) => console.log('[contatori/somme]', ...a));
  const letture = new Map();

  async function pagine(idToken, dal, al) {
    const { FIRESTORE_BASE, API_KEY } = rest();
    if (!FIRESTORE_BASE || !API_KEY) throw new Error('server non configurato');
    const docs = [];
    let dopo = null;
    let letti = 0;
    for (let pagina = 0; pagina < TETTO_PAGINE; pagina++) {
      const structuredQuery = {
        from: [{ collectionId: C.COLLEZIONE }],
        where: { compositeFilter: { op: 'AND', filters: [
          { fieldFilter: { field: { fieldPath: 'giorno' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: dal } } },
          { fieldFilter: { field: { fieldPath: 'giorno' }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: al } } },
        ] } },
        select: { fields: CAMPI_LETTI.map((f) => ({ fieldPath: f })) },
        orderBy: [{ field: { fieldPath: 'giorno' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGINA,
        ...(dopo ? { startAt: { values: [{ stringValue: dopo.giorno }, { referenceValue: dopo.nome }], before: false } } : {}),
      };
      const res = await fetchFn(`${FIRESTORE_BASE}:runQuery?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ structuredQuery }),
        signal: AbortSignal.timeout(ATTESA_RETE_MS),
      });
      if (!res.ok) {
        let det = '';
        try { const j = await res.json(); det = (Array.isArray(j) ? j[0] : j)?.error?.status || ''; } catch (_) {}
        throw new Error(`contatori ${res.status}${det ? ` ${det}` : ''}`);
      }
      const righe = ((await res.json()) || []).filter((r) => r && r.document);
      letti += righe.length;
      for (const r of righe) {
        const d = documentoDa(r.document.fields || {}, C);
        if (d) docs.push(d);
      }
      if (righe.length < PAGINA) { log(`${letti} documenti letti dal ${dal} al ${al}`); return { docs, completo: true }; }
      const ultimo = righe[righe.length - 1].document;
      dopo = { nome: ultimo.name, giorno: String(daFs(ultimo.fields && ultimo.fields.giorno) || '') };
    }
    log(`${letti} documenti letti dal ${dal} al ${al}: tetto raggiunto, lettura parziale`);
    return { docs, completo: false };
  }

  function leggi(idToken, dal, al, forza) {
    const chiave = `${dal}|${al}`;
    const tenuta = letture.get(chiave);
    if (tenuta && !forza && (tenuta.promessa || adesso() - tenuta.at < VALE_MS)) return tenuta.promessa || Promise.resolve(tenuta);
    const voce = { at: 0, docs: [], completo: true };
    voce.promessa = pagine(idToken, dal, al).then((r) => {
      Object.assign(voce, r, { at: adesso() });
      delete voce.promessa;
      return voce;
    }, (e) => {
      if (letture.get(chiave) === voce) letture.delete(chiave);
      throw e;
    });
    letture.delete(chiave);
    letture.set(chiave, voce);
    while (letture.size > RICHIESTE_TENUTE) letture.delete(letture.keys().next().value);
    return voce.promessa;
  }

  // `dal`/`al`: giorni del calendario di chi usa Filo; `app`/`os`: '' per tutte.
  async function somme({ idToken, dal, al, app = '', os = '', forza = false } = {}) {
    if (!giornoValido(dal, C) || !giornoValido(al, C)) throw new Error('Intervallo non valido: servono due date.');
    if (dal > al) throw new Error('Intervallo non valido: la prima data viene dopo la seconda.');
    const lungo = giorniFra(dal, al).length;
    if (lungo > TETTO_GIORNI) throw new Error(`Intervallo troppo lungo: ${lungo} giorni, al massimo ${TETTO_GIORNI}.`);
    if (app && !C.APP_RE.test(String(app))) throw new Error('Versione non valida.');
    if (os && !C.OS.includes(os)) throw new Error('Sistema non valido.');
    if (!idToken) throw new Error('Sessione scaduta: rifai l’accesso.');
    const l = await leggi(idToken, dal, al, forza === true);
    return somma(l.docs, { dal, al, app: app || '', os: os || '', completo: l.completo, lettoAlle: l.at, C });
  }

  return { somme };
}

// I due riquadri delle installazioni attive (Inviti e utenti) seguono la stessa soglia delle celle della scheda.
function sottoSoglia(v) {
  const n = v && Number(v.n);
  return v && Number.isFinite(n) && n < SOGLIA_COPIE ? { ...v, n: null, sotto: true } : v;
}

module.exports = { crea, somma, documentoDa, catalogo, sottoSoglia, SOGLIA_COPIE, CAMPI_LETTI, periodoDi, passoPer };
