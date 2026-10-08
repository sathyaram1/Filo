// Il punteggio con cui l'indice dei documenti (documentiIndice.js) ordina i file per una richiesta a parole. PURO:
// niente disco, niente modello. Il modello sceglie poi fra i primi; qui si decide solo chi arriva fra i primi.
// Regole: tests/unit/documentiRicerca.test.mjs.

'use strict';

// Parole che in una richiesta non dicono COSA si cerca («mi serve la … dov'è?»).
const VUOTE = new Set(`
  a ad al alla alle allo ai agli all che chi ci con col coi da dal dalla dalle dai dagli dall de del della delle dello dei
  degli dell di do e ed è era gli ha hai ho i il in io la le lei li lo lui ma me mi mia mie miei mio ne nei nel nella nelle
  nello negli nell no non o od per piu più qua qui quel quella quelle quelli quello questa queste questi questo se si sia
  sono su sua sue sul sulla sulle sui suo suoi te ti tra fra tu tua tue tuo tuoi un una uno vi voi
  dov dove dov'è dove sta stanno trova trovami trovare cerca cercami cercare serve servono servirebbe vorrei voglio dammi
  apri aprimi mostra mostrami fammi vedere ho bisogno bisogno avevo ho salvato salvato salvata messo messa computer pc
  documento documenti file files pdf doc docx foglio fogli cartella cartelle scansione scansionato quello quella
  the of a an and or to for my is where find me i need
`.split(/\s+/).filter(Boolean));

// Sinonimi di casa: la richiesta dice «luce», la bolletta dice «energia elettrica» e «kWh». Il modello è chiamato a
// passare da sé le parole del documento; questa tabella regge quando passa la frase dell'utente così com'è.
const SINONIMI = [
  ['bolletta', 'bollette', 'fattura', 'fatture', 'bollettino'],
  ['luce', 'energia elettrica', 'elettricita', 'kwh', 'fornitura di energia', 'pod'],
  ['gas', 'gas naturale', 'smc', 'pdr'],
  ['acqua', 'servizio idrico', 'idrico'],
  ['affitto', 'locazione', 'canone di locazione', 'locatore', 'conduttore'],
  ['assicurazione', 'polizza', 'assicurativa', 'premio assicurativo'],
  ['ricevuta', 'quietanza', 'ricevuta di pagamento'],
  ['multa', 'verbale', 'contravvenzione', 'sanzione'],
  ['stipendio', 'busta paga', 'cedolino', 'retribuzione'],
  ['telefono', 'telefonia', 'fibra', 'internet'],
  ['estratto conto', 'conto corrente', 'saldo contabile'],
  ['condominio', 'condominiale', 'rate condominiali'],
  ['tasse', 'f24', 'imposta', 'tributi'],
];

// I mesi: il nome scritto per esteso o abbreviato, e il numero nelle date (01/03/2026, 03/2026, 2026-03).
const MESI = [
  ['gennaio', 'gen', 'january', 'jan'], ['febbraio', 'feb', 'february'], ['marzo', 'mar', 'march'],
  ['aprile', 'apr', 'april'], ['maggio', 'mag', 'may'], ['giugno', 'giu', 'june', 'jun'], ['luglio', 'lug', 'july', 'jul'],
  ['agosto', 'ago', 'august', 'aug'], ['settembre', 'set', 'sett', 'september', 'sep', 'sept'],
  ['ottobre', 'ott', 'october', 'oct'], ['novembre', 'nov', 'november'], ['dicembre', 'dic', 'december', 'dec'],
];
// Le abbreviazioni valgono solo come parola intera: «mar» non deve combaciare con «mare».
const ABBREVIAZIONI = new Set(MESI.flatMap((m) => m.slice(1).filter((x) => x.length <= 4)));

/** Minuscolo, senza accenti, ogni segno che non è lettera o cifra diventa uno spazio. PURA. */
function piano(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// La radice con cui una parola combacia anche al plurale e al femminile: «bollette» e «bolletta» → «bollett».
function radice(parola) {
  return parola.length > 4 && /[aeiou]$/.test(parola) ? parola.slice(0, -1) : parola;
}

function meseDi(parola) {
  return MESI.findIndex((m) => m.includes(parola));
}

/**
 * Le idee della richiesta, ognuna con le forme che può avere nel documento. PURA.
 * → [{ nome, forme: [testo piano], mese: indice | -1 }]
 */
function concetti(richiesta) {
  const parole = piano(richiesta).split(' ').filter((p) => p && !VUOTE.has(p) && (p.length > 1 || /\d/.test(p)));
  const out = [];
  const visti = new Set();
  const aggiungi = (c) => {
    const chiave = c.forme.slice().sort().join('|');
    if (visti.has(chiave)) return;
    visti.add(chiave);
    out.push(c);
  };
  // Prima le espressioni di più parole della tabella («energia elettrica», «busta paga»): una volta prese, le loro
  // parole non diventano idee a sé.
  const usate = new Set();
  const testo = ` ${parole.join(' ')} `;
  for (const gruppo of SINONIMI) {
    for (const forma of gruppo) {
      if (!forma.includes(' ') || !testo.includes(` ${forma} `)) continue;
      for (const p of forma.split(' ')) usate.add(p);
      aggiungi({ nome: gruppo[0], forme: gruppo.slice(), mese: -1 });
    }
  }
  for (const p of parole) {
    if (usate.has(p)) continue;
    const m = meseDi(p);
    if (m >= 0) { aggiungi({ nome: MESI[m][0], forme: MESI[m].slice(), mese: m }); continue; }
    const gruppo = SINONIMI.find((g) => g.includes(p) || g.some((f) => !f.includes(' ') && radice(f) === radice(p)));
    aggiungi(gruppo ? { nome: gruppo[0], forme: Array.from(new Set([p, ...gruppo])), mese: -1 } : { nome: p, forme: [p], mese: -1 });
  }
  return out;
}

// Quante volte una forma compare nel testo piano, a inizio di parola (con la radice, anche al plurale). Il conto si
// ferma a un tetto: dieci volte «bolletta» non fanno di un documento la bolletta dieci volte di più.
const CONTA_MAX = 12;
function conta(testoPiano, forma) {
  const intera = ABBREVIAZIONI.has(forma) || forma.length <= 3;
  const cerco = intera ? forma : radice(forma);
  let n = 0;
  let da = 0;
  while (n < CONTA_MAX) {
    const i = testoPiano.indexOf(cerco, da);
    if (i < 0) break;
    da = i + cerco.length;
    if (i > 0 && testoPiano.charCodeAt(i - 1) !== 32) continue;
    if (intera) {
      const dopo = testoPiano.charCodeAt(i + cerco.length);
      if (!Number.isNaN(dopo) && dopo !== 32) continue;
    }
    n += 1;
  }
  return n;
}

// Le date che dicono quando un documento è stato emesso, quando scade o quando si è letto il contatore: non dicono di
// che mese parla. Una bolletta di febbraio è emessa, scade e si legge a marzo.
const AMMINISTRATIVE = /(?:scaden|scade|emess|emission|entro|lettur|rilevat|pagam|pagare|addebit)[\p{L}]*[^\n]{0,24}$/iu;
function amministrativa(s, i) {
  return AMMINISTRATIVE.test(s.slice(Math.max(0, i - 40), i));
}

// Le date col numero del mese: 01/03/2026, 1.3.26, 03/2026, 2026-03-15. Sul testo vero, prima che i segni spariscano.
function reDateDelMese(mese) {
  const mm = `0?${mese + 1}`;
  return new RegExp(`(?:\\b\\d{1,2}[/.\\-]${mm}[/.\\-](?:\\d{4}|\\d{2})\\b)|(?:\\b${mm}[/.\\-](?:19|20)\\d{2}\\b)|(?:\\b(?:19|20)\\d{2}[/.\\-]${mm}(?:[/.\\-]\\d{1,2})?\\b)`, 'g');
}
function contaDateDelMese(testo, mese) {
  const re = reDateDelMese(mese);
  const s = String(testo || '');
  let n = 0;
  let m;
  while (n < CONTA_MAX && (m = re.exec(s))) if (!amministrativa(s, m.index)) n += 1;
  return n;
}

// I periodi che un documento dichiara: un intervallo («01/02/2026 - 28/02/2026», «dal 1 al 28 febbraio 2026»,
// «gennaio-febbraio 2026», le due date in colonna sotto «periodo») o un mese con l'anno («marzo 2026», «03/2026»). Quando
// il documento dichiara un periodo, il mese chiesto si misura su quello e non sulle altre date.
const NOMI_MESE = MESI.flat().slice().sort((a, b) => b.length - a.length).join('|');
const MESE = `(${NOMI_MESE})\\.?`;
const TRA = '\\s*(?:-|–|—|\\bal\\b|\\ba\\b|fino al)\\s*';
const RE_DATA_NUM = /(?<![\d/.])(\d{1,2})[/.\-](\d{1,2})[/.\-]((?:19|20)?\d{2})(?![\d/])/g;
const RE_DATA_ISO = /(?<![\d/.\-])((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/g;
const RE_DATA_NOME = new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,2})\\s+${MESE}\\s+((?:19|20)\\d{2})(?!\\d)`, 'giu');
const RE_MESE_NUM = /(?<![\d/.\-])(\d{1,2})[/.\-]((?:19|20)\d{2})(?![\d/.\-]?\d)/g;
const RE_MESE_NOME = new RegExp(`(?<!\\d\\s{0,3})(?<![\\p{L}\\p{N}])${MESE}\\s+((?:19|20)\\d{2})(?!\\d)`, 'giu');
// L'inizio scritto a metà, che prende mese e anno dalla fine: «1-28 febbraio 2026», «dal 1 febbraio al 28 febbraio
// 2026», «dal 01/02 al 28/02/2026», «gennaio - febbraio 2026».
const RE_GIORNI_NOME = new RegExp(`(?<![\\p{L}\\p{N}/.])(\\d{1,2})(?:\\s+${MESE})?${TRA}(\\d{1,2})\\s+${MESE}\\s+((?:19|20)\\d{2})(?!\\d)`, 'giu');
const RE_GIORNI_NUM = new RegExp(`(?<![\\p{L}\\p{N}/.])(\\d{1,2})(?:[/.](\\d{1,2}))?${TRA}(\\d{1,2})[/.](\\d{1,2})[/.]((?:19|20)?\\d{2})(?![\\d/])`, 'gu');
const RE_MESI_NOME = new RegExp(`(?<![\\p{L}\\p{N}])${MESE}\\s*(?:-|–|—|/|\\be\\b|\\ba\\b)\\s*${MESE}\\s+((?:19|20)\\d{2})(?!\\d)`, 'giu');
const TRA_DATE = /^\s*(?:-|–|—|\/|al|a|fino al|e il)\s*$/i;
// Due date affiancate senza niente in mezzo sono un periodo solo sotto la parola che lo annuncia (le colonne «dal» e
// «al» di una tabella), e solo se fra quella parola e le date non si parla di emissione o scadenza.
const ANNUNCIO = /(?:periodo|competenza|fatturazion|fornitura|riferimento|consumi|\bdal\b)(?![\s\S]*(?:periodo|competenza|fatturazion|fornitura|riferimento|consumi|\bdal\b))([\s\S]*)$/i;
const PERIODI_MAX = 40;

function anno(y) { const n = Number(y); return n < 100 ? 2000 + n : n; }
function mesiFra(m1, y1, m2, y2) {
  const da = y1 * 12 + m1;
  const a = y2 * 12 + m2;
  if (a < da) return [m1, m2];
  if (a - da >= 11) return MESI.map((_, k) => k);
  const out = [];
  for (let x = da; x <= a; x++) out.push(x % 12);
  return out;
}

function annunciato(s, i) {
  const m = ANNUNCIO.exec(s.slice(Math.max(0, i - 80), i));
  return !!m && !AMMINISTRATIVE.test(m[1]) && !/(?:scaden|emess|emission|entro|lettur)/i.test(m[1]);
}

/** → [{ i, fine, testo, mesi: [indice del mese], fino: anno * 12 + mese della fine }]. PURA. */
function periodi(testo) {
  const s = String(testo || '');
  if (!s) return [];
  const out = [];
  const preso = (i, fine) => out.some((p) => i < p.fine && p.i < fine);
  const metti = (i, fine, m1, y1, m2, y2) => {
    if (out.length >= PERIODI_MAX || preso(i, fine)) return;
    // L'inizio senza anno sta nell'anno della fine, o in quello prima se il mese viene dopo («dicembre - gennaio 2026»).
    const ya = y1 != null ? y1 : (m1 > m2 ? y2 - 1 : y2);
    out.push({ i, fine, testo: s.slice(i, fine).replace(/\s+/g, ' '), mesi: mesiFra(m1, ya, m2, y2), fino: y2 * 12 + m2 });
  };
  const prendi = (re, fn) => { re.lastIndex = 0; let m; let n = 0; while ((m = re.exec(s)) && n++ < 400) fn(m); };
  const meseDiNome = (n) => meseDi(String(n).toLowerCase());
  const giorno = (g) => +g >= 1 && +g <= 31;
  prendi(RE_GIORNI_NOME, (m) => {
    const m2 = meseDiNome(m[4]);
    const m1 = m[2] ? meseDiNome(m[2]) : m2;
    if (m1 >= 0 && m2 >= 0 && giorno(m[1]) && giorno(m[3])) metti(m.index, m.index + m[0].length, m1, null, m2, anno(m[5]));
  });
  prendi(RE_GIORNI_NUM, (m) => {
    const m2 = +m[4] - 1;
    const m1 = m[2] ? +m[2] - 1 : m2;
    if (m1 >= 0 && m1 < 12 && m2 >= 0 && m2 < 12 && giorno(m[1]) && giorno(m[3])) metti(m.index, m.index + m[0].length, m1, null, m2, anno(m[5]));
  });
  prendi(RE_MESI_NOME, (m) => {
    const m1 = meseDiNome(m[1]);
    const m2 = meseDiNome(m[2]);
    if (m1 >= 0 && m2 >= 0) metti(m.index, m.index + m[0].length, m1, null, m2, anno(m[3]));
  });
  const date = [];
  const mesi = [];
  prendi(RE_DATA_NUM, (m) => { const me = +m[2] - 1; if (giorno(m[1]) && me >= 0 && me < 12) date.push({ i: m.index, fine: m.index + m[0].length, m: me, y: anno(m[3]) }); });
  prendi(RE_DATA_ISO, (m) => { const me = +m[2] - 1; if (me >= 0 && me < 12) date.push({ i: m.index, fine: m.index + m[0].length, m: me, y: anno(m[1]) }); });
  prendi(RE_DATA_NOME, (m) => { const me = meseDiNome(m[2]); if (me >= 0) date.push({ i: m.index, fine: m.index + m[0].length, m: me, y: anno(m[3]) }); });
  prendi(RE_MESE_NUM, (m) => { const me = +m[1] - 1; if (me >= 0 && me < 12) mesi.push({ i: m.index, fine: m.index + m[0].length, m: me, y: anno(m[2]) }); });
  prendi(RE_MESE_NOME, (m) => { const me = meseDiNome(m[1]); if (me >= 0) mesi.push({ i: m.index, fine: m.index + m[0].length, m: me, y: anno(m[2]) }); });
  const libere = date.filter((d) => !preso(d.i, d.fine)).sort((a, b) => a.i - b.i);
  for (let k = 0; k + 1 < libere.length; k++) {
    const a = libere[k];
    const b = libere[k + 1];
    if (b.i < a.fine) continue;
    const tra = s.slice(a.fine, b.i);
    const affiancate = /^\s+$/.test(tra) && annunciato(s, a.i);
    if (!TRA_DATE.test(tra) && !affiancate) continue;
    // Un intervallo va avanti nel tempo: due date affiancate all'indietro sono altro (emissione e scadenza in tabella).
    if (affiancate && b.y * 12 + b.m < a.y * 12 + a.m) continue;
    metti(a.i, b.fine, a.m, a.y, b.m, b.y);
    k += 1;
  }
  for (const x of mesi) {
    if (date.some((d) => x.i < d.fine && d.i < x.fine)) continue;
    metti(x.i, x.fine, x.m, x.y, x.m, x.y);
  }
  return out.sort((a, b) => a.i - b.i);
}

// Quanto è recente un documento, in mesi: la fine del periodo che dichiara per il mese chiesto (o di uno qualsiasi), se
// no la data del file. Serve solo fra punteggi pari, entro PARI l'uno dall'altro.
const PARI = 0.02;
function recenza({ d, periodi: per }, idee) {
  const mesi = idee.filter((x) => x.mese >= 0).map((x) => x.mese);
  const utili = per.filter((p) => p.fino != null && (!mesi.length || p.mesi.some((m) => mesi.includes(m))));
  if (utili.length) return Math.max(...utili.map((p) => p.fino));
  const t = new Date(Number(d.data) || 0);
  return d.data && !Number.isNaN(t.getTime()) ? t.getFullYear() * 12 + t.getMonth() : -Infinity;
}

/**
 * Il punteggio di ogni documento per la richiesta, e i primi `limite`. PURA.
 * `documenti`: [{ id, nome, testo, data?, testoPiano?, nomePiano?, periodi? }]. → [{ id, punteggio, trovati: [nomi], primo: forma }]
 */
function ordina(documenti, richiesta, { limite = 8 } = {}) {
  const idee = concetti(richiesta);
  if (!idee.length) return [];
  const conMese = idee.some((x) => x.mese >= 0);
  const docs = documenti.map((d) => ({
    d,
    testoPiano: d.testoPiano != null ? d.testoPiano : piano(d.testo),
    nomePiano: d.nomePiano != null ? d.nomePiano : piano(d.nome),
    periodi: !conMese ? [] : (d.periodi != null ? d.periodi : periodi(d.testo)),
  }));
  // Quanti documenti contengono ogni idea: un'idea che hanno tutti (l'anno, «fattura» in una cartella di fatture)
  // distingue poco, una rara distingue molto.
  const presenze = idee.map(() => 0);
  const misure = docs.map(({ d, testoPiano, nomePiano, periodi: per }) => idee.map((idea, k) => {
    let nelTesto = 0;
    let nelNome = 0;
    let forma = '';
    for (const f of idea.forme) {
      const fp = piano(f);
      if (!fp) continue;
      const t = conta(testoPiano, fp);
      const n = conta(nomePiano, fp);
      if ((t || n) && !forma) forma = f;
      nelTesto += t;
      nelNome += n;
    }
    if (idea.mese >= 0 && per.length) {
      const coperti = per.filter((p) => p.mesi.includes(idea.mese)).length;
      nelTesto = coperti ? coperti + 1 : 0;
    } else if (idea.mese >= 0) nelTesto += contaDateDelMese(d.testo, idea.mese);
    if (nelTesto || nelNome) presenze[k] += 1;
    return { nelTesto: Math.min(nelTesto, CONTA_MAX), nelNome, forma };
  }));
  const N = Math.max(docs.length, 1);
  const peso = presenze.map((df) => Math.log(1 + N / (1 + df)) + 0.5);
  const risultati = [];
  misure.forEach((righe, i) => {
    let punteggio = 0;
    const trovati = [];
    righe.forEach((r, k) => {
      if (!r.nelTesto && !r.nelNome) return;
      trovati.push(idee[k].nome);
      punteggio += peso[k] * (1 + Math.log(1 + r.nelTesto)) + (r.nelNome ? peso[k] * 1.5 : 0);
    });
    if (!trovati.length) return;
    // Chi contiene TUTTE le idee della richiesta vince su chi ne ripete una sola molte volte.
    const copertura = trovati.length / idee.length;
    punteggio *= 0.4 + copertura * copertura;
    const primo = righe.map((r, k) => ({ r, k })).filter((x) => x.r.forma)
      .sort((a, b) => peso[b.k] - peso[a.k])[0];
    risultati.push({ id: docs[i].d.id, punteggio, trovati, copertura, primo: primo ? primo.r.forma : '', recente: recenza(docs[i], idee) });
  });
  risultati.sort((a, b) => b.punteggio - a.punteggio);
  // A parità (le bollette di marzo di tre anni, scritte allo stesso modo) viene prima la più recente: chi chiede «la
  // bolletta di marzo» vuole l'ultima, non quella che l'indice ha letto per prima.
  const ordinati = [];
  for (let a = 0; a < risultati.length;) {
    let b = a + 1;
    while (b < risultati.length && risultati[b].punteggio >= risultati[a].punteggio * (1 - PARI)) b += 1;
    ordinati.push(...risultati.slice(a, b).sort((x, y) => y.recente - x.recente));
    a = b;
  }
  return ordinati.slice(0, limite).map(({ recente, ...r }) => r);
}

/** Uno squarcio di testo intorno alla prima volta che compare `forma`, con gli spazi raccolti. PURA. */
function squarcio(testo, forma, lunghezza = 260) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  let i = -1;
  if (forma) {
    const cerco = piano(forma).split(' ')[0];
    if (cerco) {
      const lower = t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      // La normalizzazione può cambiare la lunghezza solo per i segni combinati già scomposti: per un indice di
      // massima basta, e un indice sbagliato di qualche carattere sposta solo la finestra.
      i = lower.indexOf(cerco);
    }
  }
  if (i < 0) return t.length > lunghezza ? `${Array.from(t).slice(0, lunghezza).join('')}…` : t;
  const inizio = Math.max(0, i - Math.floor(lunghezza / 3));
  const fine = Math.min(t.length, inizio + lunghezza);
  return `${inizio > 0 ? '…' : ''}${t.slice(inizio, fine)}${fine < t.length ? '…' : ''}`;
}

/**
 * Lo squarcio che contiene più idee diverse della richiesta: per una bolletta, la riga col periodo e quella col tipo
 * di fornitura insieme, che è quello che serve a chi deve scegliere fra due bollette quasi uguali. PURA.
 */
function squarcioMigliore(testo, richiesta, lunghezza = 280) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const basso = t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  // Con lettere scomposte che non si ricompongono gli indici non tornerebbero: meglio l'inizio del testo.
  if (basso.length !== t.length) return squarcio(t, '', lunghezza);
  const punti = [];
  const idee = concetti(richiesta);
  const perT = idee.some((x) => x.mese >= 0) ? periodi(t) : [];
  idee.forEach((idea, k) => {
    for (const f of idea.forme) {
      const cerco = radice(piano(f));
      if (!cerco) continue;
      let da = 0;
      for (let n = 0; n < CONTA_MAX; n++) {
        const i = basso.indexOf(cerco, da);
        if (i < 0) break;
        da = i + cerco.length;
        if (i > 0 && /[\p{L}\p{N}]/u.test(basso[i - 1])) continue;
        punti.push({ i, k });
      }
    }
    if (idea.mese >= 0 && perT.length) {
      for (const p of perT) if (p.mesi.includes(idea.mese)) punti.push({ i: p.i, k });
    } else if (idea.mese >= 0) {
      const re = reDateDelMese(idea.mese);
      let m;
      let n = 0;
      while (n++ < CONTA_MAX && (m = re.exec(t))) if (!amministrativa(t, m.index)) punti.push({ i: m.index, k });
    }
  });
  if (!punti.length) return conPeriodo(squarcio(t, '', lunghezza), t, perT, idee, 0, Math.min(t.length, lunghezza));
  punti.sort((a, b) => a.i - b.i);
  let migliore = { inizio: punti[0].i, idee: 0 };
  for (let a = 0; a < punti.length; a++) {
    const viste = new Set();
    for (let b = a; b < punti.length && punti[b].i - punti[a].i < lunghezza - 40; b++) viste.add(punti[b].k);
    if (viste.size > migliore.idee) migliore = { inizio: punti[a].i, idee: viste.size };
  }
  let inizio = Math.max(0, migliore.inizio - 30);
  // Lo squarcio comincia a inizio di parola: «…GIA SERVIZIO» non si legge.
  const spazio = t.lastIndexOf(' ', inizio);
  if (inizio > 0 && inizio - spazio < 25) inizio = spazio + 1;
  const fine = Math.min(t.length, inizio + lunghezza);
  return conPeriodo(`${inizio > 0 ? '…' : ''}${t.slice(inizio, fine)}${fine < t.length ? '…' : ''}`, t, perT, idee, inizio, fine);
}

// Chi sceglie fra due bollette vicine deve vedere il periodo che ognuna dichiara, anche se sta lontano dalle parole
// della richiesta: se la finestra non lo contiene, lo si accoda con le parole che lo introducono («Periodo di …»).
function conPeriodo(base, t, perT, idee, inizio, fine) {
  if (!perT.length || perT.some((p) => p.i >= inizio && p.fine <= fine)) return base;
  const mesi = idee.filter((x) => x.mese >= 0).map((x) => x.mese);
  const p = perT.find((x) => x.mesi.some((m) => mesi.includes(m))) || perT[0];
  let da = Math.max(0, p.i - 30);
  const spazio = t.lastIndexOf(' ', da);
  if (da > 0 && da - spazio < 25) da = spazio + 1;
  // Davanti solo parole: «8,00 Periodo di …» diventa «Periodo di …».
  const prima = t.slice(da, p.i).replace(/^(?:[^\p{L}\s]*\s+|\S*\d\S*\s+)+/u, '');
  return `${base.replace(/…$/, '')}… ${prima}${t.slice(p.i, p.fine)}${p.fine < t.length ? '…' : ''}`;
}

module.exports = { piano, concetti, ordina, squarcio, squarcioMigliore, conta, contaDateDelMese, periodi, SINONIMI, MESI };
