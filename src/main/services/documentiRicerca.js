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

// Le date col numero del mese: 01/03/2026, 1.3.26, 03/2026, 2026-03-15. Sul testo vero, prima che i segni spariscano.
function contaDateDelMese(testo, mese) {
  const m = mese + 1;
  const mm = `0?${m}`;
  const re = new RegExp(`(?:\\b\\d{1,2}[/.\\-]${mm}[/.\\-](?:\\d{4}|\\d{2})\\b)|(?:\\b${mm}[/.\\-](?:19|20)\\d{2}\\b)|(?:\\b(?:19|20)\\d{2}[/.\\-]${mm}(?:[/.\\-]\\d{1,2})?\\b)`, 'g');
  let n = 0;
  const s = String(testo || '');
  while (n < CONTA_MAX && re.exec(s)) n += 1;
  return n;
}

/**
 * Il punteggio di ogni documento per la richiesta, e i primi `limite`. PURA.
 * `documenti`: [{ id, nome, testo, testoPiano?, nomePiano? }]. → [{ id, punteggio, trovati: [nomi], primo: forma }]
 */
function ordina(documenti, richiesta, { limite = 8 } = {}) {
  const idee = concetti(richiesta);
  if (!idee.length) return [];
  const docs = documenti.map((d) => ({
    d,
    testoPiano: d.testoPiano != null ? d.testoPiano : piano(d.testo),
    nomePiano: d.nomePiano != null ? d.nomePiano : piano(d.nome),
  }));
  // Quanti documenti contengono ogni idea: un'idea che hanno tutti (l'anno, «fattura» in una cartella di fatture)
  // distingue poco, una rara distingue molto.
  const presenze = idee.map(() => 0);
  const misure = docs.map(({ d, testoPiano, nomePiano }) => idee.map((idea, k) => {
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
    if (idea.mese >= 0) nelTesto += contaDateDelMese(d.testo, idea.mese);
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
    risultati.push({ id: docs[i].d.id, punteggio, trovati, copertura, primo: primo ? primo.r.forma : '' });
  });
  risultati.sort((a, b) => b.punteggio - a.punteggio);
  return risultati.slice(0, limite);
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
  concetti(richiesta).forEach((idea, k) => {
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
    if (idea.mese >= 0) {
      const mm = `0?${idea.mese + 1}`;
      const re = new RegExp(`\\b\\d{1,2}[/.\\-]${mm}[/.\\-](?:\\d{4}|\\d{2})\\b|\\b${mm}[/.\\-](?:19|20)\\d{2}\\b`, 'g');
      let m;
      let n = 0;
      while (n++ < CONTA_MAX && (m = re.exec(t))) punti.push({ i: m.index, k });
    }
  });
  if (!punti.length) return squarcio(t, '', lunghezza);
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
  return `${inizio > 0 ? '…' : ''}${t.slice(inizio, fine)}${fine < t.length ? '…' : ''}`;
}

module.exports = { piano, concetti, ordina, squarcio, squarcioMigliore, conta, contaDateDelMese, SINONIMI, MESI };
