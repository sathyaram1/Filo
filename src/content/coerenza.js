// I suggerimenti del correttore che non chiedono DOM (#1115, #1446): date e giorni controllati in codice, e la prova di
// una contraddizione (la sua citazione deve stare, alla lettera, nella pagina mandata). Lo usano spellcheck.js e i
// test; il resto delle regole del correttore sta in correttoreRegole.js.

(function (global) {
  'use strict';

  const I18n = () => global.SN_I18N;
  const t = (k, ...a) => (I18n() ? I18n().t(k, ...a) : k);

  // Le forme di ogni giorno (0 = domenica, come Date.getDay) e di ogni mese. `intere` alla prima posizione la forma
  // con cui Filo scrive; `brevi` le abbreviazioni. Mese e giorno devono essere della stessa lingua: «sabato 3 mai più»
  // non è una data francese.
  const LINGUE = {
    it: {
      giorni: [
        [['domenica'], ['dom']], [['lunedì', 'lunedi'], ['lun']], [['martedì', 'martedi'], []],
        [['mercoledì', 'mercoledi'], ['mer']], [['giovedì', 'giovedi'], ['gio']], [['venerdì', 'venerdi'], ['ven']],
        [['sabato'], ['sab']],
      ],
      mesi: [
        [['gennaio'], ['gen']], [['febbraio'], ['feb']], [['marzo'], ['mar']], [['aprile'], ['apr']],
        [['maggio'], ['mag']], [['giugno'], ['giu']], [['luglio'], ['lug']], [['agosto'], ['ago']],
        [['settembre'], ['set', 'sett']], [['ottobre'], ['ott']], [['novembre'], ['nov']], [['dicembre'], ['dic']],
      ],
      relativi: { oggi: 0, domani: 1, dopodomani: 2, ieri: -1 },
      verbo: '(?:è|e\'|é)',
      // Abbreviazioni che sono anche parole d'uso («3 set a 1», «3 ago», «2 giu» per giù): data solo con l'anno.
      ambigue: new Set(['set', 'ago', 'giu']),
    },
    en: {
      giorni: [
        [['sunday'], ['sun']], [['monday'], ['mon']], [['tuesday'], ['tue', 'tues']], [['wednesday'], ['wed']],
        [['thursday'], ['thu', 'thur', 'thurs']], [['friday'], ['fri']], [['saturday'], ['sat']],
      ],
      mesi: [
        [['january'], ['jan']], [['february'], ['feb']], [['march'], ['mar']], [['april'], ['apr']],
        [['may'], []], [['june'], ['jun']], [['july'], ['jul']], [['august'], ['aug']],
        [['september'], ['sep', 'sept']], [['october'], ['oct']], [['november'], ['nov']], [['december'], ['dec']],
      ],
      relativi: { today: 0, tomorrow: 1, yesterday: -1 },
      verbo: '(?:is|was)',
      // Parole inglesi che sono anche verbi o nomi comuni («we wed», «I sat», «may», «march»): valgono solo maiuscole.
      soloMaiuscole: new Set(['sun', 'mon', 'wed', 'sat', 'may', 'march', 'mar']),
    },
    es: {
      giorni: [
        [['domingo'], []], [['lunes'], []], [['martes'], []], [['miércoles', 'miercoles'], []],
        [['jueves'], []], [['viernes'], []], [['sábado', 'sabado'], []],
      ],
      mesi: [
        [['enero'], []], [['febrero'], []], [['marzo'], []], [['abril'], []], [['mayo'], []], [['junio'], []],
        [['julio'], []], [['agosto'], []], [['septiembre', 'setiembre'], []], [['octubre'], []],
        [['noviembre'], []], [['diciembre'], []],
      ],
    },
    fr: {
      giorni: [
        [['dimanche'], []], [['lundi'], []], [['mardi'], []], [['mercredi'], []],
        [['jeudi'], []], [['vendredi'], []], [['samedi'], []],
      ],
      mesi: [
        [['janvier'], []], [['février', 'fevrier'], []], [['mars'], []], [['avril'], []], [['mai'], []],
        [['juin'], []], [['juillet'], []], [['août', 'aout'], []], [['septembre'], []], [['octobre'], []],
        [['novembre'], []], [['décembre', 'decembre'], []],
      ],
    },
    de: {
      giorni: [
        [['sonntag'], []], [['montag'], []], [['dienstag'], []], [['mittwoch'], []],
        [['donnerstag'], []], [['freitag'], []], [['samstag'], []],
      ],
      mesi: [
        [['januar', 'jänner'], []], [['februar'], []], [['märz', 'maerz'], []], [['april'], []], [['mai'], []],
        [['juni'], []], [['juli'], []], [['august'], []], [['september'], []], [['oktober'], []],
        [['november'], []], [['dezember'], []],
      ],
    },
    pt: {
      giorni: [
        [['domingo'], []], [['segunda-feira', 'segunda'], []], [['terça-feira', 'terça'], []],
        [['quarta-feira', 'quarta'], []], [['quinta-feira', 'quinta'], []], [['sexta-feira', 'sexta'], []],
        [['sábado', 'sabado'], []],
      ],
      mesi: [
        [['janeiro'], []], [['fevereiro'], []], [['março', 'marco'], []], [['abril'], []], [['maio'], []],
        [['junho'], []], [['julho'], []], [['agosto'], []], [['setembro'], []], [['outubro'], []],
        [['novembro'], []], [['dezembro'], []],
      ],
    },
  };

  const PRIMA = '(?<![\\p{L}\\p{N}])';
  // «mercoledì 9 ottobre del 2024», «October 9th of 2024», «9 de octubre de 2024»: l'anno dopo la preposizione è l'anno.
  const ANNO_DOPO = '(?:(?:de|del|nel|of|do|von)\\s+)?';
  // «lunedì 2/3 ore», «sabato 3/4 persone»: senza anno, una barra seguita da una parola è una quantità, non una data.
  // Restano date «venerdì 9/10», «venerdì 9/10, alle 18», «venerdì 9/10 ore 18».
  const DOPO_NUMERICA = /^(?:\s*$|\s*[^\s\p{L}]|\s+(?:alle|all'|dalle|dalla|verso|e|ed|o|oppure|a|at|and|or|from|to|by|et|ou|à|y|und|oder|um)(?!\p{L})|\s+(?:ore|h)\s*\d)/iu;
  const DOPO = '(?![\\p{L}\\p{N}])';
  // Un anno detto intorno a una data che non lo porta («nel 2023, lunedì 9 ottobre», «… '23», «… (2023)», «dell'anno
  // scorso», «tre anni fa»): l'anno non è per forza quello vicino a oggi, e nel dubbio si tace.
  const INDIZIO_ANNO = /(?<![\p{L}\p{N}])(?:1[5-9]\d\d|2\d\d\d)(?!\p{N})|['’‘`´]\d\d(?!\p{N})|(?<!\p{L})(?:ann[oi]|years?|años?|années?|ans|jahre?n?|anos?)(?!\p{L})/iu;
  const ANNO_ATTACCATO = /^[\s,]*\(?\d{2}(?!\p{N}|[:.,]\p{N})/u;
  const FINE_FRASE = /[\n!?]/;
  function annoIntorno(intero, inizio, fine) {
    if (typeof intero !== 'string') return false;
    const prima = intero.slice(Math.max(0, inizio - 80), inizio).split(FINE_FRASE).pop();
    const dopo = intero.slice(fine, fine + 80).split(FINE_FRASE)[0];
    return INDIZIO_ANNO.test(prima) || INDIZIO_ANNO.test(dopo) || ANNO_ATTACCATO.test(dopo);
  }
  // Gli anni che dice la pagina intorno a una data senza anno (un'altra riga del campo, la conversazione, il titolo):
  // giusta in uno di loro non si segna, e il più vicino entro ANNO_VICINO è la prima lettura proposta (#1115.2).
  const ANNO_VICINO = 600;
  const ANNO_DETTO = /(?<![\p{L}\p{N}.,€$£])(1[6-9]\d\d|2[01]\d\d)(?!\p{N}|[.,]\p{N}|\s*(?:[€$£%‰]|(?:euro|eur|usd|dollari|dollars?|sterline|km|kg|mq|metri|persone|people|pagine|pages|parole|words)(?!\p{L})))/giu;
  const ANNO_APOSTROFO = /(?<![\p{L}\p{N}])['’‘](\d\d)(?![\p{N}%])/gu;
  const QUANTI = { a: 1, an: 1, one: 1, un: 1, uno: 1, due: 2, two: 2, tre: 3, three: 3, quattro: 4, four: 4, cinque: 5,
    five: 5, sei: 6, six: 6, sette: 7, seven: 7, otto: 8, eight: 8, nove: 9, nine: 9, dieci: 10, ten: 10 };
  const ANNO_RELATIVO = [
    [/(?<!\p{L})(?:l['’]anno (?:scorso|passato)|lo scorso anno|last year)(?!\p{L})/giu, () => -1],
    [/(?<!\p{L})(?:l['’]anno prossimo|il prossimo anno|next year)(?!\p{L})/giu, () => 1],
    [new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,2}|${Object.keys(QUANTI).join('|')})\\s+(?:ann[oi]\\s+fa|years?\\s+ago)(?!\\p{L})`, 'giu'),
      (m) => -(QUANTI[m[1].toLowerCase()] || Number(m[1]))],
  ];
  function anniIn(s, oggi) {
    const out = [];
    if (typeof s !== 'string' || !s) return out;
    const y = oggi.getFullYear();
    const metti = (anno, m) => out.push({ anno, da: m.index, fine: m.index + m[0].length });
    for (const m of s.matchAll(ANNO_DETTO)) if (Number(m[1]) <= y + 50) metti(Number(m[1]), m);
    for (const m of s.matchAll(ANNO_APOSTROFO)) metti(2000 + Number(m[1]) <= y + 10 ? 2000 + Number(m[1]) : 1900 + Number(m[1]), m);
    for (const [re, quanti] of ANNO_RELATIVO) for (const m of s.matchAll(re)) metti(y + quanti(m), m);
    return out;
  }
  // `intorno`: { prima, dopo, titolo }, il testo della pagina subito prima e subito dopo il campo e il titolo della pagina.
  function anniDetti(testo, intorno, oggi) {
    const c = intorno && typeof intorno === 'object' ? intorno : {};
    const prima = typeof c.prima === 'string' ? c.prima : '';
    return {
      campo: anniIn(testo, oggi),
      prima: anniIn(prima, oggi).map((x) => ({ anno: x.anno, lontano: prima.length - x.fine })),
      dopo: anniIn(c.dopo, oggi).map((x) => ({ anno: x.anno, lontano: x.da })),
      titolo: anniIn(c.titolo, oggi).map((x) => x.anno),
    };
  }
  // Dal più vicino alla data [inizio, fine) di un campo lungo `lunghezza`; il titolo sta al limite del vicino.
  function anniVicini(detti, inizio, fine, lunghezza) {
    if (!detti) return [];
    return [
      ...detti.campo.filter((x) => x.fine <= inizio || x.da >= fine)
        .map((x) => ({ anno: x.anno, dist: x.fine <= inizio ? inizio - x.fine : x.da - fine })),
      ...detti.prima.map((x) => ({ anno: x.anno, dist: x.lontano + inizio })),
      ...detti.dopo.map((x) => ({ anno: x.anno, dist: x.lontano + lunghezza - fine })),
      ...detti.titolo.map((anno) => ({ anno, dist: ANNO_VICINO })),
    ].sort((p, q) => p.dist - q.dist);
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alternative = (liste) => liste.flat(2).filter(Boolean).sort((a, b) => b.length - a.length).map(esc).join('|');

  // forma (minuscola) → { indice, breve, variante }
  function indiceDi(tabella) {
    const m = new Map();
    tabella.forEach(([intere, brevi], i) => {
      intere.forEach((f, v) => m.set(f, { indice: i, breve: false, variante: v }));
      brevi.forEach((f, v) => m.set(f, { indice: i, breve: true, variante: v }));
    });
    return m;
  }

  const MOTORI = Object.entries(LINGUE).map(([lingua, L]) => {
    const G = alternative(L.giorni);
    const M = alternative(L.mesi);
    const giornoMese = new RegExp(
      `${PRIMA}(${G})${DOPO}\\.?,?\\s+(?:the\\s+)?(\\d{1,2})(st|nd|rd|th|°|º|\\.)?\\s+(?:(?:de|of)\\s+)?(${M})${DOPO}\\.?`
      + `(?:,?\\s+${ANNO_DOPO}(\\d{4})(?!\\p{N}))?`, 'giu');
    const meseGiorno = lingua === 'en' ? new RegExp(
      `${PRIMA}(${G})${DOPO}\\.?,?\\s+(${M})${DOPO}\\.?\\s+(\\d{1,2})(st|nd|rd|th)?${DOPO}(?:,?\\s+${ANNO_DOPO}(\\d{4})(?!\\p{N}))?`, 'giu') : null;
    // «9.10» e «9-10» senza anno sono anche orari e intervalli («mercoledì 9-10 sono libero»): solo con l'anno.
    const numerica = new RegExp(
      `${PRIMA}(${G})${DOPO}\\.?,?\\s+(\\d{1,2})(?:/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?|([.\\-])(\\d{1,2})\\5(\\d{2}|\\d{4}))(?![\\p{N}/.\\-]\\p{N}|\\p{N})`, 'giu');
    const relativa = L.relativi ? new RegExp(
      `${PRIMA}(${alternative([Object.keys(L.relativi)])})${DOPO}(?:\\s+${L.verbo})?\\s+(${G})${DOPO}`, 'giu') : null;
    return { lingua, L, giorni: indiceDi(L.giorni), mesi: indiceDi(L.mesi), giornoMese, meseGiorno, numerica, relativa };
  });

  function giorniNelMese(anno, mese) { return new Date(anno, mese + 1, 0).getDate(); }
  function mezzanotte(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // Senza anno una data ha due letture, quella passata e quella che arriva, e vale la più vicina a oggi: «venerdì 2
  // gennaio» scritto a fine dicembre è il 2 gennaio che arriva. Oltre VICINA_GIORNI le due letture si equivalgono
  // («lunedì 2 marzo» detto a ottobre): si segna solo se non torna nessuna.
  const VICINA_GIORNI = 120;
  const GIORNO_MS = 86400000;
  function lettureSenzaAnno(giorno, mese, oggi) {
    const y = oggi.getFullYear();
    const base = mezzanotte(oggi).getTime();
    const out = [];
    for (const a of [y - 1, y, y + 1]) {
      if (giorno > giorniNelMese(a, mese)) continue;
      const dist = Math.abs(new Date(a, mese, giorno).getTime() - base);
      if (dist <= 366 * GIORNO_MS) out.push({ a, dist });
    }
    return out.sort((p, q) => p.dist - q.dist);
  }

  function annoScritto(s) {
    if (!s) return null;
    const n = Number(s);
    return s.length === 2 ? 2000 + n : n;
  }

  function comeScritto(originale, parola) {
    if (!originale || !parola) return parola;
    if (originale.length > 1 && originale === originale.toUpperCase() && originale !== originale.toLowerCase()) return parola.toUpperCase();
    const p = originale[0];
    if (p === p.toUpperCase() && p !== p.toLowerCase()) return parola[0].toUpperCase() + parola.slice(1);
    return parola;
  }

  // Il giorno giusto nella stessa forma di quello scritto (intero o abbreviato, con o senza accento, maiuscole uguali).
  function giornoNellaForma(motore, scritto, info, giusto) {
    const [intere, brevi] = motore.L.giorni[giusto];
    const parola = info.breve ? (brevi[0] || intere[0]) : (intere[info.variante] || intere[0]);
    return comeScritto(scritto, parola);
  }

  const nomeGiorno = (i) => LINGUE.it.giorni[i][0][0];
  const nomeMese = (i) => LINGUE.it.mesi[i][0][0];
  // «Il 9 ottobre», «L'8 ottobre», «Il 1° ottobre».
  const ilGiorno = (n, mese) => `${n === 8 || n === 11 ? 'L\'' : 'Il '}${n === 1 ? '1°' : n} ${nomeMese(mese)}`;
  const dataDetta = (d) => `${ilGiorno(d.getDate(), d.getMonth())} ${d.getFullYear()}`;
  const dataInMezzo = (d) => { const s = dataDetta(d); return s[0].toLowerCase() + s.slice(1); };

  function suffissoInglese(n) {
    if (n % 100 >= 11 && n % 100 <= 13) return 'th';
    return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  }

  function valeLaParola(motore, scritto, tabella) {
    const k = scritto.toLowerCase();
    if (!tabella.has(k)) return null;
    if (motore.L.soloMaiuscole && motore.L.soloMaiuscole.has(k) && scritto[0] === scritto[0].toLowerCase()) return null;
    return tabella.get(k);
  }

  // Una data scritta con il suo giorno della settimana: torna il segno se non tornano, altrimenti null.
  // `parti`: { inizio, testo, intero (il testo del campo), detti (anniDetti), giorno: [testo, posizione], numero: [testo, posizione, suffisso], mese, anno, oggi, motore }
  function verifica(parti) {
    const { motore, testo, inizio, oggi } = parti;
    const g = valeLaParola(motore, parti.giorno[0], motore.giorni);
    if (!g) return null;
    const n = Number(parti.numero[0]);
    const mese = parti.mese;
    if (!(n >= 1 && n <= 31) || !(mese >= 0 && mese <= 11)) return null;
    const scrittoAnno = annoScritto(parti.anno);
    const segno = { start: inizio, end: inizio + testo.length, segment: testo, fonte: 'data', tipo: 'falso', citazione: '', correzioni: [] };
    if (n > giorniNelMese(scrittoAnno || 2024, mese)) {
      segno.spiegazione = t('spell_ocra_inesistente', ilGiorno(n, mese), nomeMese(mese), giorniNelMese(scrittoAnno || 2023, mese));
      return segno;
    }
    let anno = scrittoAnno;
    let anche = null;
    if (!anno) {
      if (annoIntorno(parti.intero, inizio, inizio + testo.length)) return null;
      const vale = (a) => n <= giorniNelMese(a, mese) && new Date(a, mese, n).getDay() === g.indice;
      const detti = anniVicini(parti.detti, inizio, inizio + testo.length, parti.intero.length);
      if (detti.some((d) => vale(d.anno))) return null;
      const letture = lettureSenzaAnno(n, mese, oggi);
      if (letture.length && (vale(letture[0].a) || (letture[0].dist > VICINA_GIORNI * GIORNO_MS && letture.some((l) => vale(l.a))))) return null;
      const vicino = detti.find((d) => d.dist <= ANNO_VICINO && n <= giorniNelMese(d.anno, mese));
      // Il 29 febbraio senza anno, lontano da un bisestile e senza un anno detto vicino: non si sa quale.
      anno = vicino ? vicino.anno : (letture.length ? letture[0].a : null);
      if (!anno) return null;
      if (letture.length && letture[0].a !== anno) anche = new Date(letture[0].a, mese, n);
    }
    const data = new Date(anno, mese, n);
    if (data.getDay() === g.indice) return null;
    if (anche && anche.getDay() === data.getDay()) anche = null;
    segno.spiegazione = anche
      ? t('spell_ocra_data_anni', dataDetta(data), nomeGiorno(data.getDay()), dataInMezzo(anche), nomeGiorno(anche.getDay()))
      : t('spell_ocra_data', dataDetta(data), nomeGiorno(data.getDay()));
    const [gTesto, gPos] = parti.giorno;
    const conGiorno = (d) => testo.slice(0, gPos) + giornoNellaForma(motore, gTesto, g, d.getDay()) + testo.slice(gPos + gTesto.length);
    segno.correzioni.push(conGiorno(data));
    // L'altra lettura: il giorno della settimana era giusto e il numero no. Si propone il più vicino, se resta nel mese.
    let delta = (g.indice - data.getDay() + 7) % 7;
    if (delta > 3) delta -= 7;
    const altra = new Date(anno, mese, n + delta);
    const [nTesto, nPos, suffisso] = parti.numero;
    if (altra.getMonth() === mese && (!suffisso || /^(st|nd|rd|th|\.)$/i.test(suffisso))) {
      let nuovo = String(altra.getDate());
      if (nTesto[0] === '0' && nuovo.length === 1) nuovo = '0' + nuovo;
      const fine = nPos + nTesto.length + (suffisso ? suffisso.length : 0);
      const coda = suffisso && suffisso !== '.' ? comeScritto(suffisso, suffissoInglese(altra.getDate())) : (suffisso || '');
      segno.correzioni.push(testo.slice(0, nPos) + nuovo + coda + testo.slice(fine));
    }
    if (anche) segno.correzioni.push(conGiorno(anche));
    return segno;
  }

  // Dove sta un gruppo della corrispondenza, dentro il testo trovato: la prima volta che compare dopo `da`.
  const posizione = (testo, pezzo, da = 0) => testo.indexOf(pezzo, da);

  // `intorno` (facoltativo): { prima, dopo, titolo } della pagina intorno al campo, per le date senza anno.
  function dateDi(testo, oggi, intorno) {
    const out = [];
    const detti = anniDetti(testo, intorno, oggi);
    for (const motore of MOTORI) {
      for (const m of testo.matchAll(motore.giornoMese)) {
        const [tutto, giorno, numero, suffisso, mese, anno] = m;
        const pm = valeLaParola(motore, mese, motore.mesi);
        if (!pm || (!anno && motore.L.ambigue && motore.L.ambigue.has(mese.toLowerCase()))) continue;
        const pn = posizione(tutto, numero, giorno.length);
        out.push(verifica({ motore, testo: tutto, intero: testo, detti, inizio: m.index, oggi, giorno: [giorno, 0], numero: [numero, pn, suffisso], mese: pm.indice, anno }));
      }
      if (motore.meseGiorno) {
        for (const m of testo.matchAll(motore.meseGiorno)) {
          const [tutto, giorno, mese, numero, suffisso, anno] = m;
          const pm = valeLaParola(motore, mese, motore.mesi);
          if (!pm) continue;
          const pn = posizione(tutto, numero, giorno.length + mese.length);
          out.push(verifica({ motore, testo: tutto, intero: testo, detti, inizio: m.index, oggi, giorno: [giorno, 0], numero: [numero, pn, suffisso], mese: pm.indice, anno }));
        }
      }
      for (const m of testo.matchAll(motore.numerica)) {
        const [tutto, giorno, primo, secondoBarra, annoBarra, , secondoAltro, annoAltro] = m;
        const secondo = secondoBarra || secondoAltro;
        const anno = annoBarra || annoAltro;
        if (!anno && !DOPO_NUMERICA.test(testo.slice(m.index + tutto.length))) continue;
        const pn = posizione(tutto, primo, giorno.length);
        const base = { motore, testo: tutto, intero: testo, detti, inizio: m.index, oggi, giorno: [giorno, 0], numero: [primo, pn, ''], anno };
        if (motore.lingua !== 'en') {
          out.push(verifica({ ...base, mese: Number(secondo) - 1 }));
          continue;
        }
        // In inglese «10/9» è il 9 ottobre o il 10 settembre: si segna solo se nessuna delle letture possibili torna.
        const letture = [[secondo, primo], [primo, secondo]]
          .filter(([g, m]) => Number(g) >= 1 && Number(g) <= 31 && Number(m) >= 1 && Number(m) <= 12)
          .map(([g, m]) => verifica({ ...base, numero: [g, 0, ''], mese: Number(m) - 1 }));
        if (letture.length && letture.every(Boolean)) out.push({ ...letture[0], correzioni: [] });
      }
      if (motore.relativa) {
        for (const m of testo.matchAll(motore.relativa)) {
          const [tutto, parola, giorno] = m;
          const g = valeLaParola(motore, giorno, motore.giorni);
          if (!g) continue;
          // «non domani, mercoledì»: chi nega sta già correggendo.
          if (/(?:^|[^\p{L}])(?:non|not)\s+$/iu.test(testo.slice(Math.max(0, m.index - 6), m.index))) continue;
          const offset = motore.L.relativi[parola.toLowerCase()];
          const data = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() + offset);
          if (data.getDay() === g.indice) continue;
          const gPos = tutto.length - giorno.length;
          out.push({
            start: m.index, end: m.index + tutto.length, segment: tutto, fonte: 'data', tipo: 'falso', citazione: '',
            spiegazione: t('spell_ocra_relativa', nomeRelativo(offset), `${nomeGiorno(data.getDay())} ${data.getDate()} ${nomeMese(data.getMonth())}`),
            correzioni: [tutto.slice(0, gPos) + giornoNellaForma(motore, giorno, g, data.getDay())],
          });
        }
      }
    }
    return senzaSovrapposti(out.filter(Boolean));
  }

  function nomeRelativo(offset) {
    return { '-1': 'Ieri', 0: 'Oggi', 1: 'Domani', 2: 'Dopodomani' }[offset] || 'Oggi';
  }

  function senzaSovrapposti(lista) {
    const ordinati = lista.slice().sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const out = [];
    for (const it of ordinati) {
      const ultimo = out[out.length - 1];
      if (ultimo && it.start < ultimo.end) continue;
      out.push(it);
    }
    return out;
  }

  // ── La risposta del modello ───────────────────────────────────────────────

  // Come si confronta una citazione con la pagina: spazi e a capo contano uno, apici e virgolette tipografiche valgono
  // quelle dritte, maiuscole uguali, e via gli invisibili che la busta toglie prima che il modello legga.
  function normalizza(s) {
    let v = String(s == null ? '' : s);
    const E = global.SN_ESTERNO;
    if (E && E.invisibiliTolti) v = E.invisibiliTolti(v);
    return v.normalize('NFC')
      .replace(/[‘’‚‛′`´]/g, '\'')
      .replace(/[“”„‟″«»]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  const BORDI_CITAZIONE = /^[\s"'«»“”„‘’…]+|[\s"'«»“”„‘’…]+$/g;
  function pulisciCitazione(c) {
    return typeof c === 'string' ? c.replace(/\.\.\.+/g, '…').replace(BORDI_CITAZIONE, '') : '';
  }

  const contestoComeTesto = (contesto) => {
    const c = contesto && typeof contesto === 'object' ? contesto : {};
    return `${typeof c.prima === 'string' ? c.prima : ''}\n${typeof c.dopo === 'string' ? c.dopo : ''}`;
  };

  // Il controllo contro le contraddizioni inventate: la citazione deve stare, alla lettera, in quello che si è mandato.
  function citazioneNelContesto(citazione, contesto) {
    const c = normalizza(pulisciCitazione(citazione));
    if (c.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return false;
    return normalizza(contestoComeTesto(contesto)).includes(c);
  }

  // Un segno ignorato copre anche quelli dello stesso tipo che toccano il suo pezzo nel testo di adesso: al giro dopo
  // il modello può segnare qualche parola in più o in meno della stessa frase. `ignorate`: [{ fonte, tipo, segment }].
  function ignorato(it, ignorate, testo) {
    const basso = String(testo || '').toLowerCase();
    for (const ig of ignorate || []) {
      if (!ig || ig.fonte !== it.fonte || ig.tipo !== it.tipo || !ig.segment) continue;
      const pezzo = ig.segment.toLowerCase();
      for (let i = basso.indexOf(pezzo); i >= 0; i = basso.indexOf(pezzo, i + 1)) {
        if (i < it.end && i + pezzo.length > it.start) return true;
      }
    }
    return false;
  }

  global.SN_COERENZA = { dateDi, citazioneNelContesto, normalizza, ignorato, contestoComeTesto };
})(typeof globalThis !== 'undefined' ? globalThis : self);
