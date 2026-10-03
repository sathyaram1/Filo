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

  // Il nome come lo dice l'utente («la carta dei mazzi», «Editor») → id del catalogo, o null.
  function risolvi(nome) {
    const s = senzaAccenti(nome).replace(/^(la|il|lo|le|i|gli)\s+/, '').replace(/^carta\s+(de(i|gli|ll[ae']?|l)\s*)?/, '');
    if (!s) return null;
    if (IDS.includes(s)) return s;
    for (const c of CARTE) if (senzaAccenti(c.titolo) === s || c.nomi.includes(s)) return c.id;
    for (const c of CARTE) if (c.nomi.some((n) => s.includes(n))) return c.id;
    return null;
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
    if (tipo === 'ripristina') return fine({ ...prima, destra: IDS.slice(), tolte: [] });
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
      return fine({ ...prima, destra: inserisci(prima.destra, id, dove === undefined ? null : dove) });
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
    CARTE, APP, IDS, VERSIONE, TETTO_ORDINE, TETTO_NASCOSTE,
    carta, predefinita, normalizza, risolvi, applica, ordinaSinistra, descrivi,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
