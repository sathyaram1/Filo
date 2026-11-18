// Il doppio tocco di una lettera nella home (#2372): «yy» come prime due battute del campo lancia l'azione che l'utente
// ha assegnato a «y» (un tasto della home o un indirizzo). Logica pura: le assegnazioni, il riconoscimento e la frase
// della chat. Il campo, i riquadri e l'azione li tiene la home (dashboard-tastiera.js).
(function (global) {
  'use strict';

  const SOGLIA_LIMITI = Object.freeze([100, 1000]);
  const SOGLIA_DI_SERIE = 350;
  // Una per lettera: più di quante lettere abbia una tastiera non servono.
  const TETTO_LETTERE = 60;
  const TETTO_URL = 2000;

  // Una lettera sola, di qualunque alfabeto: nessuna è vietata, nemmeno «w».
  const LETTERA_RE = /^\p{L}$/u;
  const lettera = (s) => {
    const x = String(s == null ? '' : s).trim().toLocaleLowerCase('it');
    return LETTERA_RE.test(x) ? x : '';
  };

  // Un indirizzo che si apre da sé: http(s) o una pagina di Filo. «youtube.com» prende https://.
  function indirizzo(s) {
    let u = String(s == null ? '' : s).trim();
    if (!u || u.length > TETTO_URL || /\s/.test(u)) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) {
      if (!/^[^/]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(u)) return '';
      u = `https://${u}`;
    }
    try {
      const x = new URL(u);
      if (x.protocol === 'filo:') return /^filo:\/\/[a-z0-9-]+\/\S*$/i.test(u) ? u : '';
      return (x.protocol === 'https:' || x.protocol === 'http:') && x.hostname ? x.href : '';
    } catch (_) { return ''; }
  }

  const tastiNoti = () => {
    const H = global.SN_CARTE_HOME;
    if (!H) return [];
    // Le carte valgono se aprono un'app: «Filo ti suggerisce» non ha dove portare.
    return [...H.TASTI, ...H.CARTE.filter((c) => c.url)].map((t) => t.id);
  };

  function voce(v) {
    if (!v || typeof v !== 'object') return null;
    const l = lettera(v.lettera);
    if (!l) return null;
    if (typeof v.tasto === 'string' && tastiNoti().includes(v.tasto)) return { lettera: l, tasto: v.tasto };
    const url = indirizzo(v.url);
    return url ? { lettera: l, url } : null;
  }

  function sogliaMs(v) {
    const n = Math.round(Number(v));
    const [min, max] = SOGLIA_LIMITI;
    return Number.isFinite(n) && v !== null && v !== '' && typeof v !== 'boolean' ? Math.max(min, Math.min(max, n)) : SOGLIA_DI_SERIE;
  }

  // Le impostazioni come arrivano dal disco → { sogliaMs, lettere }. Di serie nessuna lettera fa niente.
  function normalizza(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const viste = new Set();
    const lettere = [];
    for (const v of Array.isArray(r.lettere) ? r.lettere : []) {
      const x = voce(v);
      if (!x || viste.has(x.lettera)) continue;
      viste.add(x.lettera);
      lettere.push(x);
      if (lettere.length >= TETTO_LETTERE) break;
    }
    return { sogliaMs: sogliaMs(r.sogliaMs), lettere };
  }

  const diLettera = (cfg, l) => normalizza(cfg).lettere.find((x) => x.lettera === lettera(l)) || null;
  const diTasto = (cfg, id) => normalizza(cfg).lettere.find((x) => x.tasto === id) || null;

  // Assegna `l` a un tasto o a un indirizzo. Una lettera ha un'azione sola; un tasto ha una lettera sola, così «cambia
  // lettera» dal suo tasto destro non ne lascia una vecchia. → { lettere } | { rifiuto }
  function assegna(cfg, l, bersaglio) {
    const x = voce({ lettera: l, ...(bersaglio || {}) });
    if (!lettera(l)) return { rifiuto: 'serve una lettera sola' };
    if (!x) return { rifiuto: 'serve un tasto della home o un indirizzo da aprire' };
    const resto = normalizza(cfg).lettere.filter((v) => v.lettera !== x.lettera && !(x.tasto && v.tasto === x.tasto));
    return { lettere: [...resto, x] };
  }
  function togli(cfg, l) {
    return { lettere: normalizza(cfg).lettere.filter((v) => v.lettera !== lettera(l)) };
  }

  function nomeBersaglio(v) {
    if (!v) return '';
    if (v.url) {
      try { return new URL(v.url).protocol === 'filo:' ? v.url : new URL(v.url).hostname.replace(/^www\./, ''); } catch (_) { return v.url; }
    }
    const H = global.SN_CARTE_HOME;
    const t = H && (H.tasto(v.tasto) || H.carta(v.tasto));
    return t ? t.titolo : v.tasto;
  }
  const etichetta = (v) => `${v.lettera}${v.lettera} → ${nomeBersaglio(v)}`;

  // La frase della chat o delle Preferenze: «y youtube.com», «yy: editor», «e = il tasto delle impostazioni»,
  // «togli y». `attuali`: le impostazioni di adesso. → { lettere, label } | { rifiuto } | null (illeggibile)
  function daTesto(testo, attuali) {
    const s = String(testo == null ? '' : testo).trim();
    const cfg = attuali && attuali.doppioTocco;
    const via = s.match(/^(?:togli|rimuovi|cancella|libera|nessuna)\s+(?:la\s+lettera\s+)?[«"']?(\p{L})\1?[»"']?$/iu)
      || s.match(/^[«"']?(\p{L})\1?[»"']?\s*(?:[:=→>-]+\s*)?(?:nessuna|niente|nulla|off|togli)$/iu);
    if (via) {
      const l = lettera(via[1]);
      if (!diLettera(cfg, l)) return { rifiuto: `«${l}${l}» non fa ancora niente` };
      return { lettere: togli(cfg, l).lettere, label: `Doppio tocco: «${l}${l}» non fa più niente` };
    }
    const m = s.match(/^[«"']?(\p{L})\1?[»"']?\s*(?:[:=→>-]+|\s)\s*(.+)$/u);
    if (!m) return null;
    const l = lettera(m[1]);
    const dove = m[2].trim().replace(/^(apre|apri|a|ad|per|su)\s+/i, '');
    const H = global.SN_CARTE_HOME;
    const id = H ? H.risolvi(dove, { esatto: true }) || H.risolvi(dove.replace(/^(la|il|lo|l')\s*/i, '').replace(/^(pagina|app)\s+(de(i|gli|ll[ae']?|l)\s*)?/i, ''), { esatto: true }) : null;
    const bersaglio = id && tastiNoti().includes(id) ? { tasto: id } : { url: dove };
    const r = assegna(cfg, l, bersaglio);
    if (r.rifiuto) return r;
    return { lettere: r.lettere, label: `Doppio tocco: ${etichetta(r.lettere[r.lettere.length - 1])}` };
  }

  // Il riconoscimento, una battuta alla volta. `b`: { key, repeat, mod (Ctrl/Alt/Cmd premuti), t (ms), vuoto (il campo
  // era vuoto prima della battuta) }. → 'trattieni' (la prima lettera di una coppia possibile: la home la tiene e la
  // scrive se la coppia non arriva), { scatta: voce } (la seconda), 'lascia' (la lettera trattenuta va scritta prima di
  // questa battuta), o null. `cfg`: le impostazioni del doppio tocco.
  function riconoscitore() {
    let prima = null;
    return {
      battuta(b, cfg) {
        const c = normalizza(cfg);
        const tenuta = prima;
        prima = null;
        const l = !b.mod && typeof b.key === 'string' && b.key.length === 1 ? lettera(b.key) : '';
        // Il tasto tenuto premuto si ripete da sé: non è una seconda pressione.
        if (tenuta && !b.repeat && b.key === tenuta.key && b.t - tenuta.t <= c.sogliaMs) {
          const v = c.lettere.find((x) => x.lettera === tenuta.lettera);
          if (v) return { scatta: v };
        }
        if (tenuta) return 'lascia';
        if (b.vuoto && !b.repeat && l && c.lettere.some((x) => x.lettera === l)) {
          prima = { key: b.key, lettera: l, t: b.t };
          return 'trattieni';
        }
        return null;
      },
      // La lettera trattenuta, se c'è, e la si dimentica: la home la scrive (scaduta la soglia, il fuoco altrove).
      lascia() { const p = prima; prima = null; return p ? p.key : ''; },
      inAttesa: () => !!prima,
    };
  }

  global.SN_DOPPIO_TOCCO = {
    SOGLIA_LIMITI, SOGLIA_DI_SERIE, TETTO_LETTERE,
    lettera, indirizzo, normalizza, sogliaMs, diLettera, diTasto, assegna, togli, daTesto, etichetta, nomeBersaglio, riconoscitore,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
