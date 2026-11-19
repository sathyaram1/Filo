// Il doppio Ctrl (#2377): due tocchi di Ctrl (Cmd su Mac) e una lettera lanciano un'azione di Filo; senza lettera, dopo la
// soglia, compare il box con le lettere. Logica pura: catalogo, lettere di serie e dell'utente, ordine per uso, frasi
// della chat, riconoscitore dei tocchi. Il gesto e le azioni li tiene src/main/lettereDiFilo.js; prove: tests/unit/doppioCtrl.test.mjs.
(function (global) {
  'use strict';

  const SOGLIA_LIMITI = Object.freeze([150, 1500]);
  const SOGLIA_DI_SERIE = 400;
  // Un tocco tenuto più a lungo di così non è un tocco: è un Ctrl lasciato andare senza usarlo.
  const TENUTA_MIN_MS = 500;

  // Le azioni con la loro lettera di serie (scelte dall'owner, #2366). `web`: solo su una pagina web, come il suo tasto.
  const AZIONI = Object.freeze([
    { id: 'cerca', lettera: 'c', titolo: 'Cerca nel filo', nomi: ['cerca', 'cerca nel filo', 'ricerca', 'ricerca nel filo'] },
    { id: 'impostazioni', lettera: 'i', titolo: 'Impostazioni', nomi: ['impostazioni', 'menu impostazioni', 'opzioni'] },
    { id: 'cattura', lettera: 's', titolo: 'Cattura schermo', nomi: ['cattura schermo', 'cattura', 'screenshot', 'schermata'] },
    { id: 'tema', lettera: 'd', titolo: 'Tema chiaro o scuro', nomi: ['tema', 'tema chiaro o scuro', 'tema scuro', 'tema chiaro', 'scuro', 'chiaro'] },
    { id: 'schermoIntero', lettera: 'f', titolo: 'Schermo intero', nomi: ['schermo intero', 'tutto schermo', 'fullscreen'] },
    { id: 'aiuto', lettera: 'h', titolo: 'Aiuto', nomi: ['aiuto', 'chat', 'chiama filo', 'filo'] },
    { id: 'muto', lettera: 'm', titolo: 'Muto', nomi: ['muto', 'silenzio', 'volume', 'muto del computer'] },
    { id: 'pausa', lettera: 'p', titolo: 'Pausa o riprendi', nomi: ['pausa', 'riprendi', 'pausa o riprendi', 'musica', 'play'] },
    { id: 'leggi', lettera: 'l', titolo: 'Leggi ad alta voce', nomi: ['leggi', 'leggi ad alta voce', 'ad alta voce', 'lettura'] },
    { id: 'salvaPerDopo', lettera: 'a', titolo: 'Salva per dopo', nomi: ['salva per dopo', 'per dopo', 'salva'], web: true },
    { id: 'riapri', lettera: 'z', titolo: 'Riapri scheda chiusa', nomi: ['riapri', 'riapri scheda', 'riapri la scheda chiusa', 'scheda chiusa'] },
    { id: 'blocca', lettera: 'b', titolo: 'Blocca il computer', nomi: ['blocca', 'blocca il computer', 'blocca il pc', 'blocco'] },
    { id: 'cuffie', lettera: 'u', titolo: 'Cuffie preferite', nomi: ['cuffie', 'cuffie preferite', 'auricolari', 'bluetooth'] },
    { id: 'trascrivi', lettera: 'o', titolo: 'Trascrivi', nomi: ['trascrivi', 'trascrizione', 'testo da immagine'] },
  ]);

  // Le app della home hanno una lettera che si assegna, di serie nessuna. «Filo ti suggerisce» non apre niente, le
  // Impostazioni rapide sono già la «i».
  function carteHome() {
    if (!global.SN_CARTE_HOME && typeof require === 'function') { try { require('./carteHome.js'); } catch (_) {} }
    return global.SN_CARTE_HOME || null;
  }
  function app() {
    const H = carteHome();
    if (!H) return [];
    return [...H.CARTE, ...H.APP]
      .filter((c) => c.url && c.id !== 'rapide' && c.id !== 'bacheca')
      .map((c) => ({ id: `app:${c.id}`, lettera: '', titolo: c.titolo, nomi: [String(c.titolo).toLowerCase(), ...(c.nomi || [])], url: c.url }));
  }
  const catalogo = () => [...AZIONI, ...app()];
  const azione = (id) => catalogo().find((a) => a.id === id) || null;

  // Una lettera latina sola: è quella che si legge sul tasto anche con un'altra disposizione (vedi daTasto).
  const LETTERA_RE = /^[a-z]$/;
  const lettera = (s) => {
    const x = String(s == null ? '' : s).trim().toLowerCase();
    return LETTERA_RE.test(x) ? x : '';
  };
  // Il tasto premuto → la lettera: con una tastiera cirillica o greca vale la lettera stampata sul tasto (KeyD → d).
  function daTasto(key, code) {
    const l = lettera(key);
    if (l) return l;
    const m = /^Key([A-Z])$/.exec(String(code || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function sogliaMs(v) {
    const n = Math.round(Number(v));
    const [min, max] = SOGLIA_LIMITI;
    return Number.isFinite(n) && v !== null && v !== '' && typeof v !== 'boolean' ? Math.max(min, Math.min(max, n)) : SOGLIA_DI_SERIE;
  }

  // Le scelte dell'utente sono solo le differenze dalla serie, [{ azione, lettera | '' }]: un'azione nuova di serie arriva
  // con la sua lettera anche a chi ne ha già cambiate altre. Un elenco e non una mappa: le impostazioni fondono gli
  // oggetti, e una scelta tolta resterebbe.
  function mappa(raw) {
    const out = {};
    const ids = new Set(catalogo().map((a) => a.id));
    for (const v of Array.isArray(raw) ? raw : []) {
      if (!v || typeof v !== 'object' || !ids.has(v.azione) || Object.prototype.hasOwnProperty.call(out, v.azione)) continue;
      if (v.lettera === '' || v.lettera === null) out[v.azione] = '';
      else if (lettera(v.lettera)) out[v.azione] = lettera(v.lettera);
    }
    return out;
  }
  const elenco = (m) => catalogo().filter((a) => Object.prototype.hasOwnProperty.call(m, a.id)).map((a) => ({ azione: a.id, lettera: m[a.id] }));
  const scelte = (raw) => elenco(mappa(raw));

  function normalizza(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return { acceso: r.acceso !== false, sogliaMs: sogliaMs(r.sogliaMs), lettere: scelte(r.lettere) };
  }

  // Le voci in vigore: [{ id, lettera, titolo, url? }]. Una lettera scelta dall'utente vince su quella di serie.
  function voci(cfg) {
    const s = mappa(normalizza(cfg).lettere);
    const prese = new Map();
    for (const [id, l] of Object.entries(s)) if (l) prese.set(l, id);
    return catalogo().map((a) => {
      let l = Object.prototype.hasOwnProperty.call(s, a.id) ? s[a.id] : a.lettera;
      if (l && prese.has(l) && prese.get(l) !== a.id) l = '';
      return { id: a.id, lettera: l, titolo: a.titolo, ...(a.url ? { url: a.url } : {}), ...(a.web ? { web: true } : {}) };
    });
  }
  const diLettera = (cfg, l) => voci(cfg).find((v) => v.lettera && v.lettera === lettera(l)) || null;

  // Il box: prima le lettere usate da poco, poi le altre nell'ordine del catalogo, in fondo le azioni senza lettera.
  // `usate`: { azione: ms dell'ultimo uso }.
  function ordinate(cfg, usate) {
    const u = usate && typeof usate === 'object' ? usate : {};
    const t = (v) => (Number.isFinite(Number(u[v.id])) ? Number(u[v.id]) : 0);
    const tutte = voci(cfg).map((v, i) => ({ v, i }));
    const con = tutte.filter((x) => x.v.lettera).sort((a, b) => t(b.v) - t(a.v) || a.i - b.i).map((x) => x.v);
    const senza = tutte.filter((x) => !x.v.lettera).map((x) => x.v);
    return { con, senza };
  }

  // Dà la lettera `l` all'azione `id` (`''` la toglie). Chi l'aveva prende la lettera di prima di `id`, così niente si
  // perde in silenzio. → { lettere } | { rifiuto }
  function assegna(cfg, id, l) {
    const a = azione(id);
    if (!a) return { rifiuto: 'azione sconosciuta' };
    const nuova = l === '' ? '' : lettera(l);
    if (l !== '' && !nuova) return { rifiuto: 'serve una lettera dalla a alla z' };
    const c = normalizza(cfg);
    const prima = (voci(c).find((v) => v.id === id) || {}).lettera || '';
    const out = { ...c.lettere };
    if (nuova) {
      const altra = voci(c).find((v) => v.lettera === nuova && v.id !== id);
      if (altra) out[altra.id] = prima;
    }
    out[id] = nuova;
    // Una scelta uguale alla serie non è una scelta: resta pulito, e la serie torna a valere.
    for (const v of catalogo()) {
      if (out[v.id] !== v.lettera) continue;
      if (!v.lettera || !voci({ lettere: out }).some((x) => x.id !== v.id && x.lettera === v.lettera)) delete out[v.id];
    }
    return { lettere: out };
  }

  const pulito = (s) => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^(il|la|lo|l'|le|i|gli)\s+/, '').replace(/[«»"'.!?]/g, '').trim();
  function risolvi(nome) {
    const s = pulito(nome);
    if (!s) return null;
    const tutte = catalogo();
    return tutte.find((a) => a.id === s || pulito(a.titolo) === s || a.nomi.some((n) => pulito(n) === s))
      || tutte.find((a) => a.nomi.some((n) => n.length > 3 && s.includes(pulito(n))))
      || null;
  }

  const etichetta = (v) => `${String(v.lettera || '').toUpperCase()} → ${v.titolo}`;
  // Le scelte dell'utente in parole, per il filo dei cambi.
  function descrivi(lettereScelte) {
    const s = scelte(lettereScelte);
    const righe = Object.entries(s).map(([id, l]) => {
      const a = azione(id);
      return a ? (l ? `${l.toUpperCase()} → ${a.titolo}` : `${a.titolo} senza lettera`) : '';
    }).filter(Boolean);
    return righe.length ? righe.join(', ') : 'quelle di serie';
  }

  // La frase della chat o delle Preferenze: «e editor», «z: riapri», «togli b», «lettere di serie».
  // `attuali`: le impostazioni di adesso. → { lettere, label } | { rifiuto } | null (illeggibile)
  function daTesto(testo, attuali) {
    const s = String(testo == null ? '' : testo).trim();
    const cfg = attuali && attuali.doppioCtrl;
    if (/^(di serie|ripristina|quelle di serie|lettere di serie|reset)$/i.test(s)) return { lettere: {}, label: 'Lettere del doppio Ctrl: quelle di serie' };
    const via = s.match(/^(?:togli|rimuovi|cancella|libera)\s+(?:la\s+lettera\s+)?[«"']?([a-z])[»"']?$/i)
      || s.match(/^[«"']?([a-z])[»"']?\s*(?:[:=→>-]+\s*)?(?:nessuna|niente|nulla|off)$/i);
    if (via) {
      const v = diLettera(cfg, via[1]);
      if (!v) return { rifiuto: `la ${via[1].toUpperCase()} non fa ancora niente` };
      const r = assegna(cfg, v.id, '');
      return { lettere: r.lettere, label: `Doppio Ctrl: ${v.titolo} senza lettera` };
    }
    const m = s.match(/^[«"']?([a-z])[»"']?\s*(?:[:=→>-]+|\s)\s*(.+)$/i) || s.match(/^(.+?)\s*(?:[:=→>-]+|\s)\s*[«"']?([a-z])[»"']?$/i);
    if (!m) return null;
    const [l, nome] = /^[a-z]$/i.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    const a = risolvi(nome.replace(/^(apre|apri|a|ad|per|su)\s+/i, ''));
    if (!a) return { rifiuto: `non so cosa sia «${nome.trim()}»: ${catalogo().map((x) => x.titolo).join(', ')}` };
    const r = assegna(cfg, a.id, l);
    if (r.rifiuto) return r;
    return { lettere: r.lettere, label: `Doppio Ctrl: ${etichetta({ lettera: lettera(l), titolo: a.titolo })}` };
  }

  // ── Il riconoscitore dei tocchi ───────────────────────────────────────────
  // Un tocco è Ctrl premuto e lasciato senza altri tasti né clic nel mezzo. Eventi: { tipo: 'giu' | 'su' (il tasto del
  // tocco), 'tasto' (un altro tasto: key, code, mod), 'mouse', t (ms), repeat }. Esiti: { attendi: ms } (doppio tocco
  // fatto: il box dopo l'attesa, se nel frattempo non arriva altro), 'annulla', { lettera } (con `inghiotti`),
  // 'chiudi' (un tocco col box aperto), null. `scaduto()` → 'apri' quando l'attesa finisce senza altro.
  function riconoscitore() {
    let fase = 'riposo';
    let t0 = 0;
    const azzera = () => { fase = 'riposo'; };
    return {
      evento(e, cfg) {
        const c = normalizza(cfg);
        const tenuta = Math.max(TENUTA_MIN_MS, c.sogliaMs);
        const tipo = e && e.tipo;
        const t = Number(e && e.t) || 0;
        if (fase === 'aperto' || fase === 'apertoGiu') {
          if (tipo === 'giu' && !e.repeat && fase === 'aperto') { fase = 'apertoGiu'; t0 = t; return null; }
          if (tipo === 'su' && fase === 'apertoGiu') { fase = 'aperto'; return t - t0 <= tenuta ? 'chiudi' : null; }
          if (tipo === 'tasto' || tipo === 'mouse') fase = 'aperto';
          return null;
        }
        if (tipo === 'giu') {
          if (e.repeat) return null;
          if (fase === 'su1' && t - t0 <= c.sogliaMs) { fase = 'giu2'; t0 = t; return null; }
          // Il terzo tocco entro l'attesa: niente box, e il gesto riparte da capo dopo che lo si lascia.
          if (fase === 'doppio') { fase = 'annullato'; return 'annulla'; }
          if (fase === 'annullato') return null;
          fase = 'giu1'; t0 = t;
          return null;
        }
        if (tipo === 'su') {
          if (fase === 'giu1') { if (t - t0 <= tenuta) { fase = 'su1'; t0 = t; } else azzera(); return null; }
          if (fase === 'giu2') {
            if (t - t0 <= tenuta) { fase = 'doppio'; t0 = t; return { attendi: c.sogliaMs }; }
            azzera();
            return null;
          }
          if (fase === 'annullato') azzera();
          return null;
        }
        if (tipo === 'tasto') {
          const prima = fase;
          azzera();
          if (prima !== 'doppio') return null;
          const m = e.mod || {};
          if (e.key === 'Escape') return { annulla: true, inghiotti: true };
          const l = m.ctrl || m.meta || m.alt ? '' : daTasto(e.key, e.code);
          return l ? { lettera: l, inghiotti: true } : 'annulla';
        }
        if (tipo === 'mouse') { const prima = fase; azzera(); return prima === 'doppio' ? 'annulla' : null; }
        return null;
      },
      scaduto() {
        if (fase !== 'doppio') return null;
        fase = 'aperto';
        return 'apri';
      },
      // Il box si apre anche da una lettera senza azione, e si chiude da sé (Esc, una scelta, il fuoco altrove).
      aperto() { fase = 'aperto'; },
      chiuso() { if (fase === 'aperto' || fase === 'apertoGiu') azzera(); },
      fase: () => fase,
    };
  }

  global.SN_DOPPIO_CTRL = {
    AZIONI, SOGLIA_LIMITI, SOGLIA_DI_SERIE, TENUTA_MIN_MS,
    catalogo, azione, lettera, daTasto, sogliaMs, scelte, normalizza, voci, diLettera, ordinate, assegna, risolvi,
    etichetta, descrivi, daTesto, riconoscitore,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
