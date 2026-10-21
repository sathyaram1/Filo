// Le regole del correttore senza DOM (#1446): i candidati che il codice trova da sé (anche i segnaposti, #1448), il pezzo
// nuovo da far giudicare al modello, la sua risposta riga per riga e il segno ritrovato nel testo di adesso. Il disegno,
// i tempi e le chiamate stanno in spellcheck.js. Prove: tests/unit/correttoreRegole.test.mjs, correttoreSegnaposti.test.mjs.

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
  // Il pezzo che il controllo rapido giudica in una volta: un documento incollato si giudica a tratti, uno per controllo.
  const REGIONE_MAX = 6000;
  // Il controllo ragionato rilegge il campo intero fino a qui; oltre, l'ultima parte (#1580, D3).
  const TESTO_INTERO_MAX = 12000;
  const MOTIVO_MAX = 160;
  // Il segno sbiadito subito solo su una parola minuscola in alfabeto latino: maiuscole e altri alfabeti sono quasi
  // sempre nomi, sigle o lingue che il dizionario non ha, e aspettano il modello (#1580, D6).
  const LATINA_MINUSCOLA = /^[\p{Script=Latin}\p{M}'’-]+$/u;
  const minuscolaLatina = (p) => p === p.toLowerCase() && LATINA_MINUSCOLA.test(p);

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
  // scarti del modello). Una parola attaccata a cifre («2m», «x86») non si chiede. `attende`: il candidato parte verso il
  // modello ma non si disegna finché il modello non lo conferma.
  function candidatiDizionario(testo, { sbagliata, nota = () => false } = {}) {
    if (typeof sbagliata !== 'function') return [];
    const fuori = zoneEscluse(testo);
    const out = [];
    for (const { start, end, parola } of parole(testo)) {
      if (parola.replace(/['’-]/g, '').length < 2) continue;
      if (diParola(testo[start - 1]) || diParola(testo[end])) continue;
      if (fuori.some(([a, b]) => start < b && end > a)) continue;
      if (nota(parola) || !sbagliata(parola.replace(/’/g, "'"))) continue;
      out.push(segno(testo, start, end, { fonte: 'dizionario', tipo: 'ortografia', ...(minuscolaLatina(parola) ? {} : { attende: true }) }));
    }
    return out;
  }

  // Ripetizioni, errori fissi e date impossibili sono sbagliati comunque: segno pieno subito, nessun giudizio da
  // aspettare né da chiedere (#1580, D5).
  const CERTO = { dubbio: false, certo: true };

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
        ...CERTO, fonte: 'ripetizione', tipo: 'ripetizione', correzioni: [''], motivo: t('spell_ripetuta', q.parola),
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

  // L'apice dopo la parola che comincia in `start` chiude una virgoletta semplice aperta prima sulla riga («'e'»,
  // «‘vengo perche'»): lì non è un accento (#1447).
  const LETTERA = /[\p{L}\p{M}]/u;
  function chiudeVirgolette(testo, start) {
    testo = String(testo ?? '');
    let aperta = false;
    for (let j = testo.lastIndexOf('\n', start - 1) + 1; j < start; j++) {
      const c = testo[j];
      if (c !== "'" && c !== '’' && c !== '‘') continue;
      const prima = LETTERA.test(testo[j - 1] || '');
      const dopo = LETTERA.test(testo[j + 1] || '');
      if (!prima && dopo) aperta = true;
      else if (prima && !dopo) aperta = false;
    }
    return aperta;
  }

  function erroriFissi(testo) {
    const fuori = zoneEscluse(testo);
    const out = [];
    for (const { start, end, parola } of parole(testo)) {
      if (/['’]$/.test(parola) && chiudeVirgolette(testo, start)) continue;
      const giusta = FISSI.get(parola.replace(/’/g, "'").toLowerCase());
      if (!giusta || diParola(testo[start - 1]) || diParola(testo[end])) continue;
      if (fuori.some(([a, b]) => start < b && end > a)) continue;
      const correzione = comeScritto(parola, giusta);
      out.push(segno(testo, start, end, {
        ...CERTO, fonte: 'fisso', tipo: 'fisso', correzioni: [correzione], motivo: t('spell_fisso', correzione),
      }));
    }
    return out;
  }

  // ── I segnaposti (#1448): le x scritte al posto di un dato che non si ricorda ──────────────────────────────────
  // Con le cifre bastano due x in coda («14xx», «3,xx»); da sole, minuscole, servono un numero annunciato prima o
  // un'unità dopo («di soli xx», «xx euro»). Non lo sono «x te», «3x4», «0x1f», i baci («a domani xx»), «XX secolo».
  const GRUPPO_X = /(?<![\p{L}\p{N}_@#])[0-9xX]+(?:[.,'’][0-9xX]+)*(?![\p{L}\p{N}_])/gu;
  const ANNUNCIANO = new Set([
    'di', 'da', 'a', 'al', 'ai', 'alle', 'nel', 'nei', 'negli', 'del', 'dei', 'degli', 'dal', 'dai', 'il', 'i', 'in',
    'con', 'per', 'su', 'tra', 'fra', 'verso', 'entro', 'è', "e'", 'era', 'erano', 'sono', 'fu', 'furono', 'sarà', 'circa',
    'quasi', 'oltre', 'sopra', 'sotto', 'almeno', 'solo', 'soli', 'sola', 'sole', 'appena', 'ben', 'ha', 'hanno', 'aveva',
    'avevano', 'costa', 'costano', 'costava', 'vale', 'valeva', 'pesa', 'pesava', 'misura', 'misurava', 'conta',
    'contava', 'supera', 'superava', 'raggiunge', 'toccato', 'pari', 'media', 'quota', 'numero', 'anno', 'nr', 'n',
    'of', 'is', 'was', 'are', 'were', 'about', 'around', 'over', 'under', 'nearly', 'almost', 'only', 'just', 'at',
    'by', 'to', 'from', 'has', 'had', 'have', 'costs', 'cost', 'weighs', 'roughly', 'approximately', 'than', 'year',
    'since', 'until', 'reached', 'hit', 'with', 'average',
  ]);
  const UNITA = new Set([
    'euro', 'eur', 'dollari', 'dollaro', 'dollars', 'dollar', 'usd', 'sterline', 'franchi', 'yen', 'anni', 'anno',
    'years', 'year', 'mesi', 'months', 'giorni', 'days', 'ore', 'hours', 'minuti', 'minutes', 'secondi', 'seconds',
    'metri', 'metro', 'm', 'km', 'cm', 'mm', 'kg', 'g', 'grammi', 'chili', 'tonnellate', 'litri', 'l', 'gradi', 'mila',
    'milioni', 'milione', 'miliardi', 'miliardo', 'million', 'millions', 'billion', 'billions', 'thousand', 'k', 'mln',
    'mld', 'persone', 'abitanti', 'people', 'inhabitants', 'volte', 'times', 'punti', 'points', 'percento', 'kwh', 'gb',
    'mb', 'tb', 'ghz', 'cv', 'hp', 'mph', 'pagine', 'pages', 'copie', 'voti', 'votes', 'utenti', 'users', 'dipendenti',
    'employees', 'morti', 'vittime', 'deaths', 'casi', 'cases', 'ettari', 'piedi', 'feet', 'miglia', 'miles', 'pollici',
    'inches', 'mq', 'kmq', 'gol', 'goals', 'squadre', 'paesi', 'stati', 'specie',
  ]);
  const PAROLA_PRIMA = /(?:^|[^\p{L}\p{N}'’])([\p{L}][\p{L}'’]*)\.? +$/u;
  const VALUTA_PRIMA = /[$€£¥] ?$/u;
  const SEGNO_DOPO = /^ ?(?:%|‰|°|[$€£¥])/u;
  const PAROLA_DOPO = /^ +([\p{L}]+)/u;
  // Un verbo prima e le cose contate dopo, al plurale: «ha scritto xx sinfonie», «vinse xx scudetti», «released xx albums».
  // Le due condizioni insieme, perché un saluto («bene xx», «a presto xx») non ha né l'uno né l'altro.
  const VERBO = /(?:[aiu]t[oaie]|(?:scritt|vint|fatt|pres|mess|lett|dett|vist|pers|spes|cors|chius|apert|prodott|condott|tradott|raccolt|scelt|tolt|rott|compost|dipint|raggiunt|uccis|decis|divis|inclus)[oaie]|[^aeiu]s[ei]|ss[ei]|ò|arono|erono|irono|[^e]ed)$/u;
  const VERBI_BREVI = new Set(['won', 'wrote', 'sold', 'made', 'built', 'took', 'gave', 'spent', 'lost', 'got', 'fece', 'diede', 'ebbe']);
  const NON_CONTATE = new Set(['che', 'come', 'bene', 'sempre', 'anche', 'dove', 'mentre', 'oppure', 'grazie', 'baci', 'kisses', 'thanks', 'this', 'his', 'yes', 'xoxo']);
  const contate = (w) => w.length >= 3 && w === w.toLowerCase() && !NON_CONTATE.has(w) && /[ies]$/.test(w);

  function numeroAttorno(testo, start, end) {
    const prima = testo.slice(Math.max(0, start - 40), start);
    if (VALUTA_PRIMA.test(prima)) return true;
    const p = PAROLA_PRIMA.exec(prima);
    const parolaPrima = p ? p[1].replace(/’/g, "'").toLowerCase() : '';
    if (parolaPrima && ANNUNCIANO.has(parolaPrima)) return true;
    const dopo = testo.slice(end, end + 30);
    if (SEGNO_DOPO.test(dopo)) return true;
    const d = PAROLA_DOPO.exec(dopo);
    if (!d) return false;
    return UNITA.has(d[1].toLowerCase()) || (((parolaPrima.length >= 4 && VERBO.test(parolaPrima)) || VERBI_BREVI.has(parolaPrima)) && contate(d[1]));
  }

  function segnaposti(testo) {
    testo = String(testo ?? '');
    if (!/x/i.test(testo)) return [];
    const fuori = zoneEscluse(testo);
    const out = [];
    for (const m of testo.matchAll(GRUPPO_X)) {
      const g = m[0];
      const start = m.index;
      const end = start + g.length;
      if ((g.match(/x/gi) || []).length < 2 || /x\d/i.test(g)) continue;
      if (fuori.some(([a, b]) => start < b && end > a)) continue;
      const nudo = g.replace(/[.,'’]/g, '');
      if (/\d/.test(g)) {
        if (!/^\d+x+$/i.test(nudo)) continue;
      } else if (/X/.test(g) || nudo.length > 6 || !numeroAttorno(testo, start, end)) continue;
      out.push(segno(testo, start, end, {
        segno: 'suggerimento', fonte: 'segnaposto', tipo: 'segnaposto', motivo: t('spell_segnaposto_forse'),
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

  // Il controllo ragionato rilegge il campo intero, se qualcosa è cambiato: oltre `max` caratteri l'ultima parte, o la
  // parte che comincia con la frase cambiata se il cambio sta tutto prima. `finoA`: la frase aperta resta al giro dopo.
  // `nuovo`: quello che è cambiato davvero, dove si cerca un pezzo che la risposta cita più volte.
  function testoDaRileggere(base, adesso, { finoA = null, max = TESTO_INTERO_MAX } = {}) {
    adesso = String(adesso ?? '');
    const r = regioneNuova(base, adesso);
    if (!r) return null;
    const fine = typeof finoA === 'number' ? Math.max(0, Math.min(adesso.length, finoA)) : adesso.length;
    if (r.start >= fine) return null;
    let start = Math.max(0, fine - max);
    if (r.end <= start) start = aFrasiIntere(adesso, r.start, r.end).start;
    while (start > 0 && start < adesso.length && diParola(adesso[start - 1]) && diParola(adesso[start])) start++;
    const g = daGiudicare(base, adesso, {
      max, regione: { start, end: Math.min(adesso.length, start + max) },
      inScrittura: fine < adesso.length ? { start: fine, end: adesso.length } : null,
    });
    return g && { ...g, nuovo: { start: Math.max(g.start, r.start), end: Math.min(g.end, r.end) } };
  }

  // ── La risposta del modello ───────────────────────────────────────────────

  function corta(s, max) {
    const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;
  }

  // Una riga per segno: [pezzo][correzione][motivo][tipo], più [citazione] per una contraddizione; il resto si ignora.
  // Una riga a tre campi ha perso il tipo (`tipo: ''`, lo decide chi legge), o il motivo se il terzo è un tipo (#1580, D8).
  const TIPI = new Set(['errore', 'suggerimento', 'contraddizione', 'giusto', 'nessuno']);
  function leggiRighe(raw) {
    const out = [];
    for (const riga of String(raw == null ? '' : raw).split(/\r?\n/)) {
      const r = riga.trim().replace(/^[-*•]\s*/, '');
      if (!r.startsWith('[') || !r.endsWith(']')) continue;
      const campi = r.slice(1, -1).split(/\]\s*\[/);
      if (campi.length < 3 || campi.length > 5) continue;
      if (campi.length === 3) {
        if (TIPI.has(campi[2].trim().toLowerCase())) campi.splice(2, 0, '');
        else campi.push('');
      }
      const [pezzo, correzione, motivo, tipo, citazione = ''] = campi;
      out.push({ pezzo, correzione, motivo: motivo.trim(), tipo: tipo.trim().toLowerCase(), citazione: citazione.trim() });
      if (out.length >= 60) break;
    }
    return out;
  }

  // Una risposta senza nessuna riga leggibile che non dice nemmeno «nessuno» o «NIENTE»: la chiamata si ripete una volta.
  const senzaRighe = (raw) => !leggiRighe(raw).length && !/nessun|niente/i.test(String(raw ?? ''));

  // Il pezzo nel testo di adesso. Le file di spazi valgono uno spazio e apici e virgolette tipografiche quelli dritti
  // (#1580, D8). Se compare più volte vale l'unica occorrenza che tocca `nuovo`, il testo nuovo di quella chiamata; se no
  // si scarta. Prima le occorrenze a parole intere: «sono» non si cerca dentro «persono».
  const APICI = /['‘’‚‛]/;
  const VIRGOLETTE = /["“”„]/;
  const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function formaDelPezzo(pezzo) {
    let out = '';
    for (const pezzetto of pezzo.split(/(\s+)/)) {
      if (!pezzetto) continue;
      if (/^\s+$/.test(pezzetto)) { out += '\\s+'; continue; }
      for (const c of pezzetto) out += APICI.test(c) ? '[\'‘’‚‛]' : VIRGOLETTE.test(c) ? '["“”„]' : esc(c);
    }
    return new RegExp(out, 'gu');
  }
  function trovaPezzo(testo, pezzo, nuovo = null) {
    testo = String(testo ?? '');
    pezzo = String(pezzo ?? '').trim();
    if (!pezzo) return null;
    const tutte = [...testo.matchAll(formaDelPezzo(pezzo))].map((m) => ({ start: m.index, end: m.index + m[0].length }));
    const intere = tutte.filter((o) => !(diParola(pezzo[0]) && diParola(testo[o.start - 1]))
      && !(diParola(pezzo[pezzo.length - 1]) && diParola(testo[o.end])));
    const lista = intere.length ? intere : tutte;
    if (lista.length === 1) return lista[0];
    const vicine = nuovo ? lista.filter((o) => o.start < nuovo.end && o.end > nuovo.start) : [];
    return vicine.length === 1 ? vicine[0] : null;
  }

  // Dove cade nel testo una posizione del pezzo citato, quando le file di spazi hanno lunghezze diverse.
  function posizioniNelTesto(pezzo, visto) {
    const out = new Array(pezzo.length + 1);
    let i = 0;
    let j = 0;
    while (i < pezzo.length) {
      if (/\s/.test(pezzo[i])) {
        let fi = i;
        while (fi < pezzo.length && /\s/.test(pezzo[fi])) fi++;
        let fj = j;
        while (fj < visto.length && /\s/.test(visto[fj])) fj++;
        for (let k = i; k < fi; k++) out[k] = j;
        i = fi;
        j = fj;
      } else {
        out[i++] = j++;
      }
    }
    out[pezzo.length] = visto.length;
    return out;
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

  // Le x dentro il pezzo che il modello ha copiato («di soli xx» → «xx»): { da, a } nel pezzo, o null.
  function xDelPezzo(pezzo) {
    for (const m of String(pezzo).matchAll(GRUPPO_X)) {
      if ((m[0].match(/x/gi) || []).length >= 2 && !/x\d/i.test(m[0])) return { da: m.index, a: m.index + m[0].length };
    }
    return null;
  }
  const DOVE_CERCARE = /^(?:wiki(?::([a-z]{2,3}))?|web)$/;

  // Un segnaposto riempito ([pezzo][valore][motivo][segnaposto]) o da cercare ([pezzo][][ricerca][cerca][dove]): il
  // segno sta sulle sole x, e una riga che non le ha non è un segnaposto.
  function segnoDelSegnaposto(r, testo, dove, fonte) {
    const base = { segno: 'suggerimento', dubbio: false, fonte, tipo: 'segnaposto', citazione: '' };
    if (r.tipo === 'segnaposto') {
      const stretto = r.correzione.trim() ? restringi(r.pezzo, r.correzione.trim()) : null;
      if (!stretto) return null;
      const start = dove.start + stretto.da;
      const end = dove.start + stretto.a;
      const valore = stretto.sostituto.trim();
      if (end <= start || !/x/i.test(testo.slice(start, end)) || !valore || /xx/i.test(valore)) return null;
      return { ...base, start, end, segment: testo.slice(start, end), motivo: corta(r.motivo, MOTIVO_MAX), correzioni: [valore] };
    }
    const x = xDelPezzo(r.pezzo);
    const dc = DOVE_CERCARE.exec(r.citazione.toLowerCase());
    const domanda = corta(r.motivo, 200);
    if (!x || !dc || !domanda) return null;
    const start = dove.start + x.da;
    const end = dove.start + x.a;
    return {
      ...base, start, end, segment: testo.slice(start, end), motivo: '', correzioni: [],
      cerca: { domanda, dove: dc[0].startsWith('web') ? 'web' : `wiki:${dc[1] || 'en'}` },
    };
  }

  // Lo stesso dato è la stessa ricerca: la chiave è la domanda, non la frase, che cambia a ogni ritocco o pausa a metà e
  // rifarebbe la ricerca (#1448). Due x della stessa frase con domande diverse restano due ricerche.
  function chiaveRicerca(segment, cerca) {
    const domanda = String(cerca?.domanda || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return [String(segment || '').toLowerCase(), domanda, cerca?.dove || ''].join('\u0000');
  }

  // Quando la rilettura tace su un segnaposto già deciso, il dato resta se la frase è ancora quella, a meno di parole
  // aggiunte e refusi corretti anche corti («a» → «ha»); se la rilettura chiede, decide la domanda (#1448). Un numero
  // vale solo uguale: «nel 2020» e «nel 2021» sono due dati.
  const lontane = (a, b, max) => {
    if (Math.abs(a.length - b.length) > max) return true;
    let pp = null;
    let p = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const c = [i];
      for (let j = 1; j <= b.length; j++) {
        c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) c[j] = Math.min(c[j], pp[j - 2] + 1);
      }
      pp = p;
      p = c;
    }
    return p[b.length] > max;
  };
  const paroleDi = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  function stessaFrase(allora, adesso) {
    const prima = paroleDi(allora);
    const ora = paroleDi(adesso);
    if (!prima.length) return false;
    return prima.every((w, i) => ora.some((u) => u === w
      || (i === prima.length - 1 && u.startsWith(w))
      || (!/\d/.test(w) && !/\d/.test(u) && !lontane(w, u, w.length >= 8 ? 2 : 1))));
  }

  // La risposta della ricerca di un segnaposto, una riga [valore][motivo][fonte][data][indirizzo] che il main ha
  // ricomposto: { valore, motivo, fonte, data, url }, o null se il dato non si è trovato.
  function valoreTrovato(raw) {
    for (const riga of String(raw == null ? '' : raw).split(/\r?\n/)) {
      const r = riga.trim();
      if (!r.startsWith('[') || !r.endsWith(']')) continue;
      const [valore = '', motivo = '', fonte = '', data = '', url = ''] = r.slice(1, -1).split(/\]\s*\[/).map((x) => x.trim());
      if (!valore || /^nessuno$/i.test(valore) || /^nessuno$/i.test(data) || /xx/i.test(valore)) return null;
      return {
        valore: corta(valore, 80), motivo: corta(motivo, MOTIVO_MAX), fonte: corta(fonte, 120), data: corta(data, 40),
        url: /^https:\/\/[^\s]+$/i.test(url) ? url.slice(0, 500) : '',
      };
    }
    return null;
  }

  // I segni di una risposta sul testo di adesso. `tipi`: quelli che questo controllo può dare; `citata(c)`: la prova di
  // una contraddizione, che deve stare nella pagina; `inScrittura`: la parola che non si segna.
  function segniDaRisposta(raw, testo, { tipi = ['errore'], citata = () => false, inScrittura = null, fonte = 'rapido' } = {}) {
    const ammessi = new Set(tipi);
    const segni = [];
    const giusti = [];
    for (const r of leggiRighe(raw)) {
      const tipo = r.tipo || senzaTipo;
      if (!ammessi.has(tipo) && tipo !== 'giusto') continue;
      const pezzo = r.pezzo.trim();
      const dove = trovaPezzo(testo, pezzo, nuovo);
      if (!dove) continue;
      if (r.tipo === 'giusto') { giusti.push(dove); continue; }
      if (r.tipo === 'contraddizione' && !citata(r.citazione)) continue;
      if (r.tipo === 'segnaposto' || r.tipo === 'cerca') {
        const s = segnoDelSegnaposto(r, testo, dove, fonte);
        if (s && !(inScrittura && s.start < inScrittura.end && s.end > inScrittura.start)) segni.push(s);
        continue;
      }
      const errore = r.tipo === 'errore';
      let start = dove.start;
      let end = dove.end;
      let correzioni = [];
      const correzione = r.correzione.trim();
      if (correzione || errore) {
        const stretto = correzione && formaLetta(correzione) === formaLetta(pezzo) ? null : restringi(pezzo, correzione ? r.correzione : '');
        if (stretto) {
          const pos = posizioniNelTesto(pezzo, testo.slice(dove.start, dove.end));
          start = dove.start + pos[stretto.da];
          end = dove.start + pos[stretto.a];
          correzioni = [stretto.sostituto];
        } else if (errore) continue;
      }
      // Ristretto ai soli spazi, il segno torna sul pezzo intero con la correzione intera: quella ristretta lo cancellerebbe.
      if (end <= start || !testo.slice(start, end).trim()) {
        start = dove.start;
        end = dove.end;
        if (correzioni.length) correzioni = [correzione];
      }
      if (inScrittura && start < inScrittura.end && end > inScrittura.start) continue;
      // Una minuscola dove la correzione vuole la maiuscola non è un errore: un nome scritto minuscolo o si corregge
      // da sé (correttoreAutomatica.js) o si lascia stare (#1447).
      if (errore && correzioni.length && soloPiuMaiuscole(testo.slice(start, end), correzioni[0])) continue;
      segni.push({
        start, end, segment: testo.slice(start, end), segno: errore ? 'errore' : 'suggerimento', dubbio: false, fonte,
        tipo, motivo: corta(r.motivo, MOTIVO_MAX), correzioni,
        citazione: tipo === 'contraddizione' ? corta(r.citazione, 240) : '',
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
    leggiRighe, trovaUnaVolta, restringi, segniDaRisposta, chiaveVerdetto, GRAMMATICALI, segnaposti, xDelPezzo,
    valoreTrovato, chiaveRicerca, stessaFrase,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
