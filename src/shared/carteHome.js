// Le carte della home (#870): il catalogo di quelle che l'utente tiene a destra, le app di «altro» e le mosse
// che cambiano la disposizione. Logica pura: niente storage né DOM, salva il main e disegna la home.
// Regole: patterns/le-carte-della-home-hanno-un-contratto-unico.md
(function (global) {
  'use strict';

  // L'ordine qui è la disposizione di chi non ha ancora spostato niente.
  const CARTE = [
    {
      id: 'editor', titolo: 'Editor', icona: 'editor', url: 'filo://editor/editor.html',
      nomi: ['editor', 'documenti', 'documento', 'file', 'appunti'],
    },
    {
      id: 'mazzi', titolo: 'Mazzi', icona: 'decks', url: 'filo://decks/decks.html',
      nomi: ['mazzi', 'mazzo', 'deck', 'decks', 'magic', 'mtg', 'deck builder'],
    },
    {
      id: 'suggerimenti', titolo: 'Filo ti suggerisce', icona: 'sparkles',
      nomi: ['suggerimenti', 'suggerimento', 'suggerisce', 'consigli', 'suggeriti', 'filo ti suggerisce'],
    },
    {
      id: 'rapide', titolo: 'Impostazioni rapide', icona: 'options', url: 'filo://preferences/preferences.html',
      nomi: ['impostazioni rapide', 'rapide', 'impostazioni', 'preferenze rapide'],
    },
  ];

  // Le app che una carta non ce l'hanno: in «altro» restano un'icona.
  const APP = [
    { id: 'perDopo', titolo: 'Aperti per dopo', icona: 'saveForLater', url: 'filo://home/home.html' },
    { id: 'scaricamenti', titolo: 'Scaricamenti', icona: 'download', url: 'filo://downloads/downloads.html' },
    { id: 'cronologia', titolo: 'Cronologia', icona: 'history', url: 'filo://archive/archive.html' },
    { id: 'bacheca', titolo: 'Bacheca', icona: 'checklist', url: 'filo://board/board.html' },
  ];

  const VERSIONE = 1;
  // Chiavi di carte di sinistra già passate (download di ieri, timer finiti): ordine e «tolta» sono solo
  // promemoria di com'erano, e oltre questi numeri cade il più vecchio.
  const TETTO_ORDINE = 200;
  const TETTO_NASCOSTE = 500;
  const TETTO_CHIAVE = 200;

  const IDS = CARTE.map((c) => c.id);
  const carta = (id) => CARTE.find((c) => c.id === id) || null;
  const lista = (v) => (Array.isArray(v) ? v : []);
  const unici = (arr) => [...new Set(arr)];
  const chiaveValida = (k) => typeof k === 'string' && k.length > 0 && k.length <= TETTO_CHIAVE;

  function predefinita() {
    return { versione: VERSIONE, destra: IDS.slice(), tolte: [], sinistra: [], nascoste: [] };
  }

  // Una carta che il catalogo non conosceva quando l'utente ha salvato compare in fondo a destra: tolta è
  // solo quella che l'utente ha tolto.
  function normalizza(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const tolte = unici(lista(r.tolte).filter((id) => IDS.includes(id)));
    const destra = unici(lista(r.destra).filter((id) => IDS.includes(id) && !tolte.includes(id)));
    for (const id of IDS) if (!destra.includes(id) && !tolte.includes(id)) destra.push(id);
    const sinistra = unici(lista(r.sinistra).filter(chiaveValida)).slice(0, TETTO_ORDINE);
    const nascoste = unici(lista(r.nascoste).filter(chiaveValida)).slice(-TETTO_NASCOSTE);
    return { versione: VERSIONE, destra, tolte, sinistra, nascoste };
  }

  function senzaAccenti(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function pulisciNome(nome) {
    return senzaAccenti(nome).replace(/^(la|il|lo|le|i|gli|l')\s*/, '').replace(/^carta\s+(de(i|gli|ll[ae']?|l)\s*)?/, '').trim();
  }

  // Il nome come lo dice l'utente («la carta dei mazzi», «Editor») → id del catalogo, o null.
  // `esatto`: niente nomi contenuti nella frase («il file scaricato» non è l'Editor).
  function risolvi(nome, { esatto = false } = {}) {
    const s = pulisciNome(nome);
    if (!s) return null;
    if (IDS.includes(s)) return s;
    for (const c of CARTE) if (senzaAccenti(c.titolo) === s || c.nomi.includes(s)) return c.id;
    if (esatto) return null;
    for (const c of CARTE) if (c.nomi.some((n) => s.includes(n))) return c.id;
    return null;
  }

  // ===== La colonna di sinistra: una regola sola per la home e per la chat =====
  // Uno scaricamento finito resta fra le cose accadute per un giorno: dopo lo si ritrova negli Scaricamenti.
  const DOWNLOAD_RECENTE_MS = 24 * 60 * 60 * 1000;
  const DOWNLOAD_ATTIVI = ['progressing', 'paused', 'pending'];
  function downloadVisibile(r, ora = Date.now()) {
    if (!r || !r.id) return false;
    if (DOWNLOAD_ATTIVI.includes(r.state)) return true;
    if (r.state !== 'completed' && r.state !== 'interrupted') return false;
    const fine = Date.parse(r.endedAt || r.startedAt || '');
    return Number.isFinite(fine) && ora - fine < DOWNLOAD_RECENTE_MS;
  }
  const scadenza = (t) => { const v = Date.parse(t && t.endsAt); return Number.isFinite(v) ? v : Infinity; };
  const nomeTimer = (t) => t.label || (t.kind === 'alarm' ? 'Sveglia' : 'Timer');

  // Le carte di sinistra nell'ordine in cui si vedono, senza le nascoste: i Crediti e ciò che suona in cima, poi
  // le altre nell'ordine dell'utente (le nuove davanti, nell'ordine di Filo: lavori, scaricamenti in corso, timer
  // per scadenza, avvisi, scaricamenti finiti). Ogni voce porta `ref`, la cosa da cui la carta nasce.
  function sinistra({ timers = [], notifiche = [], downloads = [], lavori = [], crediti = false } = {}, layout, ora = Date.now()) {
    const nascoste = new Set(normalizza(layout).nascoste);
    const voce = (chiave, tipo, titolo, ref) => ({ chiave, tipo, titolo, ref });
    const vT = (t) => voce(`timer:${t.id}`, t.kind === 'alarm' ? 'sveglia' : 'timer', nomeTimer(t), t);
    const vD = (r) => voce(`download:${r.id}`, 'download', r.filename || 'download', r);
    const cima = [];
    if (crediti && !nascoste.has('crediti')) cima.push(voce('crediti', 'crediti', 'Crediti', null));
    for (const t of lista(timers).filter((x) => x && x.ringing)) cima.push(vT(t));
    const vis = lista(downloads).filter((r) => downloadVisibile(r, ora));
    const resto = [
      ...lista(lavori).filter((l) => l && l.id).map((l) => voce(`lavoro:${l.id}`, 'lavoro', l.testo || 'lavoro in corso', l)),
      ...vis.filter((r) => DOWNLOAD_ATTIVI.includes(r.state)).map(vD),
      ...lista(timers).filter((x) => x && !x.ringing).sort((a, b) => scadenza(a) - scadenza(b)).map(vT),
      ...lista(notifiche).filter((n) => n && n.id).map((n) => voce(`avviso:${n.id}`, 'avviso', String(n.text || ''), n)),
      ...vis.filter((r) => !DOWNLOAD_ATTIVI.includes(r.state)).map(vD),
    ].filter((v) => !nascoste.has(v.chiave));
    const perChiave = new Map(resto.map((v) => [v.chiave, v]));
    return [...cima, ...ordinaSinistra(resto.map((v) => v.chiave), layout).map((k) => perChiave.get(k))];
  }

  const TIPI_SINISTRA = {
    timer: ['timer'], sveglia: ['sveglia', 'sveglie'], download: ['scaricamento', 'scaricamenti', 'download', 'file scaricato'],
    avviso: ['avviso', 'avvisi', 'notifica', 'notifiche'], lavoro: ['lavoro', 'lavori', 'comando'], crediti: ['crediti'],
  };
  // Le carte di sinistra che l'utente intende con un nome («l'avviso del backup», «gli avvisi», la chiave della
  // carta). `perTipo`: il nome era solo il tipo, quindi valgono tutte quelle di quel tipo. `tipo`: il nome ne
  // nomina uno, quindi la carta cercata è di sinistra anche se non si trova.
  const VUOTE = ['del', 'dei', 'della', 'delle', 'dello', 'degli', 'per', 'con', 'che', 'dalla', 'home'];
  function trovaSinistra(nome, voci) {
    const tutte = lista(voci);
    const raw = String(nome == null ? '' : nome).trim();
    const esatta = tutte.find((v) => v.chiave === raw);
    if (esatta) return { voci: [esatta], perTipo: false, tipo: esatta.tipo };
    const s = pulisciNome(raw).replace(/^(de(i|gli|ll[ae']?|l)|di)\s*/, '');
    if (!s) return { voci: [], perTipo: false, tipo: null };
    for (const [tipo, nomi] of Object.entries(TIPI_SINISTRA)) {
      if (nomi.includes(s)) return { voci: tutte.filter((v) => v.tipo === tipo), perTipo: true, tipo };
    }
    const tit = (v) => senzaAccenti(v.titolo);
    const parole = s.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const tipo = (Object.entries(TIPI_SINISTRA).find(([, nomi]) => nomi.some((n) => parole.includes(n) || s.includes(`${n} `))) || [null])[0];
    const candidate = tipo ? tutte.filter((v) => v.tipo === tipo) : tutte;
    let trovate = candidate.filter((v) => tit(v) === s);
    if (!trovate.length) trovate = candidate.filter((v) => tit(v).length > 1 && (tit(v).includes(s) || s.includes(tit(v))));
    if (!trovate.length) {
      const piene = parole.filter((w) => !VUOTE.includes(w) && !Object.values(TIPI_SINISTRA).flat().includes(w));
      if (piene.length) trovate = candidate.filter((v) => piene.every((w) => tit(v).includes(w)));
      // «togli lo scaricamento» detto con altre parole: se di quel tipo ce n'è uno solo, è quello.
      if (!trovate.length && tipo && candidate.length === 1) trovate = candidate;
    }
    return { voci: trovate, perTipo: false, tipo };
  }

  // Mette `id` prima di `prima` (null = in fondo). Un `prima` che non c'è vale «in fondo».
  function inserisci(arr, id, prima) {
    const senza = arr.filter((x) => x !== id);
    const at = prima != null ? senza.indexOf(prima) : -1;
    if (at < 0) senza.push(id);
    else senza.splice(at, 0, id);
    return senza;
  }

  function primaDa(destra, id, verso) {
    const senza = destra.filter((x) => x !== id);
    const at = destra.indexOf(id);
    if (verso === 'cima') return senza[0] ?? null;
    if (verso === 'fondo') return null;
    if (verso === 'su') return at <= 0 ? senza[0] ?? null : destra[at - 1];
    if (verso === 'giu') return at < 0 || at + 2 >= destra.length ? null : destra[at + 2];
    return undefined;
  }

  const uguali = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Una mossa → { layout, cambiato, errore? }. Una mossa che non si può fare dice perché e lascia tutto com'era.
  function applica(raw, mossa) {
    const prima = normalizza(raw);
    const m = mossa && typeof mossa === 'object' ? mossa : {};
    const tipo = String(m.tipo || '');
    const fine = (layout, errore) => {
      const n = normalizza(layout);
      return errore ? { layout: prima, cambiato: false, errore } : { layout: n, cambiato: !uguali(n, prima) };
    };
    // «Come all'inizio» vale per tutta la home: anche le carte di sinistra solo nascoste tornano a vedersi.
    if (tipo === 'ripristina') return fine(predefinita());
    if (tipo === 'nascondi') {
      if (!chiaveValida(m.chiave)) return fine(prima, 'chiave della carta mancante');
      return fine({ ...prima, nascoste: [...prima.nascoste.filter((k) => k !== m.chiave), m.chiave] });
    }
    if (tipo === 'ordina-sinistra') {
      const ordine = lista(m.ordine).filter(chiaveValida);
      if (!ordine.length) return fine(prima, 'ordine vuoto');
      return fine({ ...prima, sinistra: unici([...ordine, ...prima.sinistra]) });
    }
    const id = IDS.includes(m.carta) ? m.carta : risolvi(m.carta);
    if (!id) return fine(prima, 'carta sconosciuta');
    const rif = m.prima == null ? null : (IDS.includes(m.prima) ? m.prima : risolvi(m.prima));
    if (tipo === 'togli') {
      return fine({ ...prima, destra: prima.destra.filter((x) => x !== id), tolte: [...prima.tolte, id] });
    }
    if (tipo === 'aggiungi') {
      const dove = m.verso === 'cima' ? prima.destra.filter((x) => x !== id)[0] ?? null : rif;
      return fine({ ...prima, destra: inserisci(prima.destra, id, dove), tolte: prima.tolte.filter((x) => x !== id) });
    }
    if (tipo === 'sposta') {
      if (!prima.destra.includes(id)) return fine(prima, 'la carta non è fra quelle a destra: prima va rimessa');
      const dove = m.verso ? primaDa(prima.destra, id, m.verso) : rif;
      if (dove === undefined) return fine(prima, 'verso sconosciuto');
      return fine({ ...prima, destra: inserisci(prima.destra, id, dove) });
    }
    return fine(prima, 'mossa sconosciuta');
  }

  // Le carte a sinistra in ordine: prima le nuove (non ancora nell'ordine salvato), poi quelle già disposte.
  // `chiavi` arriva già nell'ordine di Filo (la più urgente prima).
  function ordinaSinistra(chiavi, layout) {
    const salvato = normalizza(layout).sinistra;
    const nuove = chiavi.filter((k) => !salvato.includes(k));
    const note = salvato.filter((k) => chiavi.includes(k));
    return [...nuove, ...note];
  }

  // Per il modello e per chi legge un esito: dove sta ogni carta, coi nomi che vede l'utente.
  function descrivi(raw) {
    const l = normalizza(raw);
    return {
      destra: l.destra.map((id) => carta(id).titolo),
      altro: l.tolte.map((id) => carta(id).titolo),
    };
  }

  global.SN_CARTE_HOME = {
    CARTE, APP, IDS, VERSIONE, TETTO_ORDINE, TETTO_NASCOSTE, DOWNLOAD_RECENTE_MS,
    carta, predefinita, normalizza, risolvi, applica, ordinaSinistra, descrivi,
    downloadVisibile, sinistra, trovaSinistra,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
