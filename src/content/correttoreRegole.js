// Le regole del correttore senza DOM (#1446): i candidati che il codice trova da sé, il pezzo nuovo da far giudicare al
// modello, la sua risposta riga per riga e il segno ritrovato nel testo di adesso. Il disegno, i tempi e le chiamate
// stanno in spellcheck.js. Prove: tests/unit/correttoreRegole.test.mjs.

(function (global) {
  'use strict';

  const t = (k, ...a) => (global.SN_I18N ? global.SN_I18N.t(k, ...a) : k);

  // Un pezzo da giudicare ha lettere o cifre: «alle 18» → «alle 19» è un cambio vero, uno spazio o una virgola no.
  const CONTENUTO = /[\p{L}\p{M}\p{N}]/u;
  const DI_PAROLA = /[\p{L}\p{M}\p{N}'’-]/u;
  const diParola = (c) => !!c && DI_PAROLA.test(c);
  const conContenuto = (s) => CONTENUTO.test(String(s || ''));

  // Le parole come le conta il dizionario: lettere, con apostrofi e trattini dentro («l'America», «e-mail», «po'»).
  const PAROLA = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*['’]?/gu;
  // Il pezzo da giudicare in una volta: un documento incollato si giudica a tratti, uno per controllo.
  const REGIONE_MAX = 6000;
  const MOTIVO_MAX = 160;

  // Le stesse parole a meno di spazi e punteggiatura: il giudizio sarebbe lo stesso (#1097.5). Apostrofo e trattino
  // invece cambiano le parole («un amico» / «un'amico», «e-mail»).
  const ossatura = (s) => String(s ?? '').replace(/’/g, "'").replace(/‐/g, '-')
    .replace(/(?:(?!['-])[\s\p{P}])+/gu, ' ').trim();

  // La correzione nella forma della parola scritta: «PERCHÈ» → «PERCHÉ», «Perchè» → «Perché».
  function comeScritto(originale, correzione) {
    if (!originale || !correzione) return correzione;
    if (originale.length > 1 && originale === originale.toUpperCase() && originale !== originale.toLowerCase()) {
      return correzione.toUpperCase();
    }
    const p = originale[0];
    if (p === p.toUpperCase() && p !== p.toLowerCase()) return correzione[0].toUpperCase() + correzione.slice(1);
    return correzione;
  }

  function segno(testo, start, end, campi) {
    return {
      start, end, segment: testo.slice(start, end), segno: 'errore', dubbio: true, fonte: '', tipo: '', motivo: '',
      correzioni: [], citazione: '', ...campi,
    };
  }

  // Indirizzi, email, menzioni, etichette e codice fra apici inversi: lì una «parola» non è una parola da correggere.
  const ZONE = [
    /\b(?:https?:\/\/|www\.)[^\s<>"]+/giu,
    /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
    /(?<![\p{L}\p{N}])[@#][\p{L}\p{N}_]+/gu,
    /`[^`\n]+`/g,
    /(?<![\p{L}\p{N}@])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+\/\S*/gu,
  ];
  function zoneEscluse(testo) {
    const out = [];
    for (const re of ZONE) for (const m of testo.matchAll(re)) out.push([m.index, m.index + m[0].length]);
    return out;
  }

  function parole(testo) {
    const out = [];
    for (const m of String(testo || '').matchAll(PAROLA)) out.push({ start: m.index, end: m.index + m[0].length, parola: m[0] });
    return out;
  }

  // `sbagliata(parola)`: il dizionario del browser; `nota(parola)`: le parole che Filo sa giuste (dizionario personale,
  // scarti del modello). Una parola attaccata a cifre («2m», «x86») non si chiede.
  function candidatiDizionario(testo, { sbagliata, nota = () => false } = {}) {
    if (typeof sbagliata !== 'function') return [];
    const fuori = zoneEscluse(testo);
    const out = [];
    for (const { start, end, parola } of parole(testo)) {
      if (parola.replace(/['’-]/g, '').length < 2) continue;
      if (diParola(testo[start - 1]) || diParola(testo[end])) continue;
      if (fuori.some(([a, b]) => start < b && end > a)) continue;
      if (nota(parola) || !sbagliata(parola.replace(/’/g, "'"))) continue;
      out.push(segno(testo, start, end, { fonte: 'dizionario', tipo: 'ortografia' }));
    }
    return out;
  }

  // Le parole grammaticali, che ripetute di fila sono un refuso. Le parole piene no («piano piano», «quasi quasi»), né
  // quelle che ripetute possono essere giuste: «se se ne va», «si si», «that that», «had had», gli articoli tedeschi.
  const GRAMMATICALI = new Set([
    'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
    'del', 'dello', 'della', 'dei', 'degli', 'delle', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'dal', 'dallo',
    'dalla', 'dai', 'dagli', 'dalle', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'col', 'coi', 'sul', 'sullo',
    'sulla', 'sui', 'sugli', 'sulle', 'e', 'ed', 'o', 'od', 'ma', 'che', 'non', 'mi', 'ti', 'ci', 'vi',
    'the', 'an', 'of', 'to', 'on', 'at', 'for', 'with', 'from', 'by', 'and', 'or', 'but',
  ]);
  const SOLO_SPAZI = /^[ \t ]+$/;

  // «il il»: due volte di fila, non tre («la la la» si canta). Il segno prende la seconda con lo spazio davanti.
  function ripetizioni(testo) {
    const ps = parole(testo);
    const out = [];
    const uguali = (x, y) => !!x && !!y && x.parola.toLowerCase() === y.parola.toLowerCase();
    const vicine = (x, y) => SOLO_SPAZI.test(testo.slice(x.end, y.start));
    for (let i = 1; i < ps.length; i++) {
      const [p, q] = [ps[i - 1], ps[i]];
      if (!uguali(p, q) || !vicine(p, q) || !GRAMMATICALI.has(q.parola.toLowerCase())) continue;
      if ((uguali(ps[i - 2], p) && vicine(ps[i - 2], p)) || (uguali(q, ps[i + 1]) && vicine(q, ps[i + 1]))) continue;
      out.push(segno(testo, p.end, q.end, {
        fonte: 'ripetizione', tipo: 'ripetizione', correzioni: [''], motivo: t('spell_ripetuta', q.parola),
      }));
    }
    return out;
  }

  // Gli errori che non dipendono dalla frase: sbagliati sempre, con una correzione sola.
  const FISSI = new Map(Object.entries({
    "qual'è": 'qual è', "qual'era": 'qual era', "qual'erano": 'qual erano', 'pò': "po'", "e'": 'è',
    'perchè': 'perché', 'poichè': 'poiché', 'affinchè': 'affinché', 'benchè': 'benché', 'finchè': 'finché',
    'purchè': 'purché', 'giacchè': 'giacché', 'cosicchè': 'cosicché', 'fuorchè': 'fuorché', 'nè': 'né', 'sè': 'sé',
    'fà': 'fa', 'stà': 'sta', 'và': 'va', 'quà': 'qua', 'quì': 'qui', 'sù': 'su', 'blù': 'blu',
    "un'altro": 'un altro', "qualcun'altro": 'qualcun altro', "nessun'altro": 'nessun altro', "tutt'ora": 'tuttora',
    "d'avvero": 'davvero', alot: 'a lot', noone: 'no one',
  }));

  function erroriFissi(testo) {
    const fuori = zoneEscluse(testo);
    const out = [];
    for (const { start, end, parola } of parole(testo)) {
      const giusta = FISSI.get(parola.replace(/’/g, "'").toLowerCase());
      if (!giusta || diParola(testo[start - 1]) || diParola(testo[end])) continue;
      if (fuori.some(([a, b]) => start < b && end > a)) continue;
      const correzione = comeScritto(parola, giusta);
      out.push(segno(testo, start, end, {
        fonte: 'fisso', tipo: 'fisso', correzioni: [correzione], motivo: t('spell_fisso', correzione),
      }));
    }
    return out;
  }

  // I segni che non si sovrappongono, nell'ordine: a parità di inizio vince il primo della lista (i più certi davanti).
  function senzaSovrapposti(lista) {
    const ordinati = lista.map((it, i) => ({ it, i })).sort((a, b) => a.it.start - b.it.start || a.i - b.i);
    const out = [];
    for (const { it } of ordinati) {
      if (out.some((o) => it.start < o.end && it.end > o.start)) continue;
      out.push(it);
    }
    return out.sort((a, b) => a.start - b.start);
  }

  // La parola su cui sta il cursore mentre si scrive: { start, end }, o null se il cursore segue uno spazio.
  function parolaAlCursore(testo, caret) {
    testo = String(testo ?? '');
    if (typeof caret !== 'number' || caret <= 0 || caret > testo.length || !diParola(testo[caret - 1])) return null;
    let a = caret;
    while (a > 0 && diParola(testo[a - 1])) a--;
    let b = caret;
    while (b < testo.length && diParola(testo[b])) b++;
    return { start: a, end: b };
  }

  // Cosa è cambiato fra `base` e `adesso`, a parole intere: { start, end } in `adesso`, o null se non c'è niente da
  // giudicare. Una cancellazione porta con sé le due parole che fa toccare («la grande zaino» → «la zaino»).
  function regioneNuova(base, adesso) {
    base = String(base ?? '');
    adesso = String(adesso ?? '');
    if (base === adesso || (base && ossatura(base) === ossatura(adesso))) return null;
    const corto = Math.min(base.length, adesso.length);
    let p = 0;
    while (p < corto && base[p] === adesso[p]) p++;
    let s = 0;
    while (s < corto - p && base[base.length - 1 - s] === adesso[adesso.length - 1 - s]) s++;
    let a = p;
    let b = adesso.length - s;
    if (!conContenuto(adesso.slice(a, b))) {
      while (a > 0 && !diParola(adesso[a - 1])) a--;
      while (b < adesso.length && !diParola(adesso[b])) b++;
      if (a > 0) a--;
      if (b < adesso.length) b++;
    }
    if (diParola(adesso[a])) while (a > 0 && diParola(adesso[a - 1])) a--;
    if (diParola(adesso[b - 1])) while (b < adesso.length && diParola(adesso[b])) b++;
    if (!conContenuto(adesso.slice(a, b))) return null;
    return { start: a, end: b };
  }

  // Il pezzo da mandare e la base per il giro dopo. La parola in scrittura, e quello che resta oltre il tetto, non vanno:
  // la base li perde, così il confronto dopo li ritrova nuovi. `null` se non c'è niente da mandare.
  function daGiudicare(base, adesso, { inScrittura = null, max = REGIONE_MAX, regione = null } = {}) {
    adesso = String(adesso ?? '');
    const r = regione || regioneNuova(base, adesso);
    if (!r) return null;
    const start = r.start;
    let end = r.end;
    let resta = r.end;
    if (inScrittura && inScrittura.end > start && inScrittura.start < r.end) {
      end = Math.max(start, inScrittura.start);
      resta = Math.max(r.end, inScrittura.end);
    }
    if (end - start > max) {
      let taglio = start + max;
      while (taglio > start && diParola(adesso[taglio - 1]) && diParola(adesso[taglio])) taglio--;
      end = taglio > start ? taglio : start + max;
      resta = Math.max(resta, r.end);
    }
    if (end <= start || !conContenuto(adesso.slice(start, end))) return null;
    return { start, end, base: adesso.slice(0, end) + adesso.slice(resta) };
  }

  // Le frasi intorno a [start, end): da dopo la fine della frase prima a dopo la fine dell'ultima.
  const FINE = /[.!?…]+["'»”)\]]*(?=\s|$)|\n/gu;
  function finiDiFrase(testo) {
    const out = [];
    for (const m of testo.matchAll(FINE)) out.push(m.index + m[0].length);
    return out;
  }
  function aFrasiIntere(testo, start, end) {
    const fini = finiDiFrase(testo);
    let a = 0;
    for (const f of fini) if (f <= start) a = f;
    let b = testo.length;
    for (const f of fini) if (f >= end) { b = f; break; }
    while (a < b && /\s/.test(testo[a])) a++;
    return { start: a, end: b };
  }

  // Dove finisce l'ultima frase chiusa prima di `pos`: il controllo ragionato a fine frase non giudica quella aperta.
  function ultimaFineFrase(testo, pos) {
    let a = 0;
    for (const f of finiDiFrase(testo)) if (f <= pos) a = f;
    return a;
  }

  // Come daGiudicare, a frasi intere. `finoA`: oltre non si giudica (la frase ancora aperta), torna al giro dopo.
  function frasiDaGiudicare(base, adesso, { finoA = null, max = REGIONE_MAX } = {}) {
    adesso = String(adesso ?? '');
    const r = regioneNuova(base, adesso);
    if (!r) return null;
    const f = aFrasiIntere(adesso, r.start, r.end);
    const limite = typeof finoA === 'number' ? Math.min(f.end, finoA) : f.end;
    return daGiudicare(base, adesso, {
      max, regione: { start: f.start, end: f.end }, inScrittura: limite < f.end ? { start: limite, end: f.end } : null,
    });
  }

  // ── La risposta del modello ───────────────────────────────────────────────

  function corta(s, max) {
    const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;
  }

  // Una riga per segno: [pezzo][correzione][motivo][tipo], più [citazione] per una contraddizione; il resto si ignora.
  function leggiRighe(raw) {
    const out = [];
    for (const riga of String(raw == null ? '' : raw).split(/\r?\n/)) {
      const r = riga.trim().replace(/^[-*•]\s*/, '');
      if (!r.startsWith('[') || !r.endsWith(']')) continue;
      const campi = r.slice(1, -1).split(/\]\s*\[/);
      if (campi.length < 4 || campi.length > 5) continue;
      const [pezzo, correzione, motivo, tipo, citazione = ''] = campi;
      out.push({ pezzo, correzione, motivo: motivo.trim(), tipo: tipo.trim().toLowerCase(), citazione: citazione.trim() });
      if (out.length >= 60) break;
    }
    return out;
  }

  // Il pezzo nel testo di adesso, se ci sta esattamente una volta. Apici e virgolette tipografiche valgono quelle dritte
  // (stessa lunghezza: le posizioni restano quelle del testo).
  const dritte = (s) => s.replace(/[‘’‚‛]/g, '\'').replace(/[“”„]/g, '"');
  function trovaUnaVolta(testo, pezzo) {
    testo = String(testo ?? '');
    pezzo = String(pezzo ?? '');
    if (!pezzo.trim()) return null;
    for (const [dove, cosa] of [[testo, pezzo], [dritte(testo), dritte(pezzo)]]) {
      const i = dove.indexOf(cosa);
      if (i < 0) continue;
      if (dove.indexOf(cosa, i + 1) >= 0) return null;
      return { start: i, end: i + cosa.length };
    }
    return null;
  }

  // Il segno sta su quello che la correzione cambia, a parole intere: «oggi sonno andato» → «oggi sono andato» segna
  // «sonno» e mette «sono». `null` se pezzo e correzione sono uguali. Le posizioni sono dentro il pezzo.
  function restringi(pezzo, correzione) {
    pezzo = String(pezzo ?? '');
    correzione = String(correzione ?? '');
    if (pezzo === correzione) return null;
    const max = Math.min(pezzo.length, correzione.length);
    let p = 0;
    while (p < max && pezzo[p] === correzione[p]) p++;
    let s = 0;
    while (s < max - p && pezzo[pezzo.length - 1 - s] === correzione[correzione.length - 1 - s]) s++;
    while (p > 0 && diParola(pezzo[p - 1]) && (diParola(pezzo[p]) || diParola(correzione[p]))) p--;
    while (s > 0 && diParola(pezzo[pezzo.length - s]) && (diParola(pezzo[pezzo.length - s - 1]) || diParola(correzione[correzione.length - s - 1]))) s--;
    return { da: p, a: pezzo.length - s, sostituto: correzione.slice(p, correzione.length - s) };
  }

  // I segni di una risposta sul testo di adesso. `tipi`: quelli che questo controllo può dare; `citata(c)`: la prova di
  // una contraddizione, che deve stare nella pagina; `inScrittura`: la parola che non si segna.
  function segniDaRisposta(raw, testo, { tipi = ['errore'], citata = () => false, inScrittura = null, fonte = 'rapido' } = {}) {
    const ammessi = new Set(tipi);
    const segni = [];
    const giusti = [];
    for (const r of leggiRighe(raw)) {
      if (!ammessi.has(r.tipo) && r.tipo !== 'giusto') continue;
      const dove = trovaUnaVolta(testo, r.pezzo);
      if (!dove) continue;
      if (r.tipo === 'giusto') { giusti.push(dove); continue; }
      if (r.tipo === 'contraddizione' && !citata(r.citazione)) continue;
      const errore = r.tipo === 'errore';
      let start = dove.start;
      let end = dove.end;
      let correzioni = [];
      if (r.correzione.trim() || errore) {
        const stretto = restringi(r.pezzo, r.correzione.trim() ? r.correzione : '');
        if (stretto) {
          start = dove.start + stretto.da;
          end = dove.start + stretto.a;
          correzioni = [stretto.sostituto];
        } else if (errore) continue;
      }
      if (end <= start || !testo.slice(start, end).trim()) { start = dove.start; end = dove.end; }
      if (inScrittura && start < inScrittura.end && end > inScrittura.start) continue;
      segni.push({
        start, end, segment: testo.slice(start, end), segno: errore ? 'errore' : 'suggerimento', dubbio: false, fonte,
        tipo: r.tipo, motivo: corta(r.motivo, MOTIVO_MAX), correzioni,
        citazione: r.tipo === 'contraddizione' ? corta(r.citazione, 240) : '',
      });
    }
    const perSegno = (k) => senzaSovrapposti(segni.filter((x) => x.segno === k));
    return { segni: [...perSegno('errore'), ...perSegno('suggerimento')], giusti };
  }

  // Lo stato che il modello ha dato a un candidato vale per quel pezzo in tutto il campo: lo stesso refuso due volte, lo
  // stesso nome proprio due volte.
  const chiaveVerdetto = (it) => `${it.fonte}\u0001${String(it.segment || '').replace(/’/g, "'").toLowerCase()}`;

  global.SN_CORRETTORE = {
    REGIONE_MAX, ossatura, comeScritto, zoneEscluse, parole, candidatiDizionario, ripetizioni, erroriFissi,
    senzaSovrapposti, parolaAlCursore, regioneNuova, daGiudicare, aFrasiIntere, ultimaFineFrase, frasiDaGiudicare,
    leggiRighe, trovaUnaVolta, restringi, segniDaRisposta, chiaveVerdetto, GRAMMATICALI,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
