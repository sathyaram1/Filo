// Il testo di un pacchetto alla nascita: chi lavora riceve testo e allegati, mai le note, e si ferma solo sulle attese.
// Pura: niente rete né letture delle unite (quelle le controlla claude-feedback.mjs). Regole: tests/unit/specDelPacchetto.test.mjs.

import '../../src/shared/feedbackAttese.js';

const NUM = String.raw`#(\d{1,7}(?:\.\d{1,6})?)`;
const norm = (n) => globalThis.SN_FB_ATTESE.normalizzaNumero(n);

/** Le frasi di un testo: un punto davanti a una cifra (#663.2, 1.000) non la chiude. PURA. */
export function frasi(testo) {
  return String(testo || '').split(/[\n;!?]+|\.(?!\d)/).map((f) => f.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// I verbi in ogni persona e modo, non la frase di un caso: «vedi», «vedere», «consulta», «leggete» mandano tutti.
const LEGGERE = String.raw`(?:ved|legg|segu|guard|consult)(?:i|e|a|ere|ire|are|ete|ite|ate)`;
const SUBITO_ALLE_NOTE = new RegExp(String.raw`\b(?:${LEGGERE}\s+(?:(?:le|la|alle|nelle|nella)\s+)?(?:(?:sue|sua)\s+)?|spec\w*\s*:\s*(?:(?:le|la|nelle|nella)\s+)?|come\s+(?:da|(?:scritt|indicat|descritt|spiegat)[oa]\s+(?:nell[ae]|in))\s+)not[ae]\b`, 'i');
const NELLE_NOTE = /\b(?:nell[ae]|in|sulle|dalle|[tf]ra\s+le|nel\s+campo)\s+(?:(?:sue|sua)\s+)?not[ae]\b/i;
const COSA_FARE = /\b(?:spec\w*|dettagl\w*|istruzion\w*|indicazion\w*|piano|resto|tutto|tutta|lavoro|cosa\s+fare|da\s+seguire)\b/i;

/** Le frasi che mandano a leggere la spec nelle note. «Nelle note manca la data» parla delle note e non manda. PURA. */
export function rimandiAlleNote(testo) {
  return frasi(testo).filter((f) => SUBITO_ALLE_NOTE.test(f) || (NELLE_NOTE.test(f) && COSA_FARE.test(f)));
}

const PRIMA = [
  new RegExp(`${NUM}[^#]{0,40}?\\b(?:fond|fus|main|arriv)\\w*[^#]{0,25}?\\bprima\\b`, 'gi'),
  new RegExp(`\\bprima\\b[^#]{0,30}?\\b(?:fond|fus|main)\\w*[^#]{0,15}?${NUM}`, 'gi'),
  new RegExp(`\\bdopo\\s+(?:la\\s+fusione\\s+d\\w*\\s+|che\\s+)${NUM}`, 'gi'),
  new RegExp(`\\b(?:aspett(?:a|are|ando|i)|in\\s+attesa\\s+d\\w*|dipend\\w*\\s+da|richied\\w*)\\s+(?:che\\s+)?${NUM}`, 'gi'),
  // Senza la parola «prima»: «solo dopo #N», «quando #N è fuso», «#N deve essere già fuso». «Si rompe dopo #N» è cronaca.
  new RegExp(`\\b(?:solo|soltanto|non\\s+prima|lavorar\\w*|partire|parta|inizia\\w*|comincia\\w*|accend\\w*)\\s+(?:[^\\s#]+\\s+){0,2}?dopo\\s+(?:la\\s+fusione\\s+d\\w*\\s+|che\\s+)?${NUM}`, 'gi'),
  new RegExp(`\\bnon\\s+prima\\s+(?:d\\w*|che)\\s+${NUM}`, 'gi'),
  new RegExp(`\\b(?:quando|appena|finch[eé](?:\\s+non)?|una\\s+volta\\s+che)\\s+${NUM}\\s+(?:[^\\s#]+\\s+){0,3}?(?:fus[oa]|fond\\w*|su\\s+main|arriv\\w*)`, 'gi'),
  new RegExp(`\\buna\\s+volta\\s+(?:fus[oa]|arrivat[oa]\\s+su\\s+main)\\s+${NUM}`, 'gi'),
  new RegExp(`${NUM}\\s+(?:[^\\s#]+\\s+){0,2}?(?:dev\\w*|va|vada)\\s+(?:[^\\s#]+\\s+){0,3}?(?:fus[oa]|fondere|fuso|su\\s+main|arrivare)`, 'gi'),
];

/**
 * I feedback che il testo mette prima di sé («#1202 si fonde prima», «prerequisito: #1202», «dopo che #1202…») e che
 * non sono fra `escludi` (unite e attese già scritte). PURA. → [{ num, frase }], uno per numero.
 */
export function prerequisitiNelTesto(testo, escludi = []) {
  const fuori = new Set(escludi.map(norm));
  const visti = new Map();
  for (const f of frasi(testo)) {
    const numeri = /prerequisit/i.test(f)
      ? [...f.matchAll(new RegExp(NUM, 'g'))].map((m) => m[1])
      : PRIMA.flatMap((re) => [...f.matchAll(re)].map((m) => m[1]));
    for (const n of numeri.map(norm)) if (n && !fuori.has(n) && !visti.has(n)) visti.set(n, f);
  }
  return [...visti].map(([num, frase]) => ({ num, frase }));
}

/** Le unite che il testo non nomina mai (#812, o 812 da solo). PURA. */
export function uniteNonNominate(testo, unite = []) {
  const t = String(testo || '');
  return unite.map(norm).filter((n) => n && !new RegExp(`(?:^|[^\\d.])#?${n.replace('.', '\\.')}(?!\\d|\\.\\d)`).test(t));
}

const TIPO_TESTO = /^(?:text\/|application\/(?:json|x-yaml|yaml)\b)/i;

/** Il testo degli allegati leggibili come testo ({ type, dataUrl } di --allega): una spec allegata conta come scritta. PURA. */
export function testoDegliAllegati(allegati = []) {
  return allegati.filter((a) => a && TIPO_TESTO.test(String(a.type || '')))
    .map((a) => Buffer.from(String(a.dataUrl || '').split(',')[1] || '', 'base64').toString('utf8'));
}

const citazione = (f) => (f.length > 120 ? `${f.slice(0, 117)}...` : f);

/**
 * I feedback che il testo mette prima del pacchetto e che il pacchetto non aspetta. `ereditate`: i numeri delle attese
 * che il pacchetto prende dalle unite (#1903.1), che lo fermano quanto --aspetta; `aVuoto`: non sono state lette. PURA.
 */
export function prerequisitiMancanti(testo, { unite = [], aspetta = [], ereditate = [], aVuoto = false } = {}) {
  const prima = prerequisitiNelTesto(testo, [...unite, ...aspetta, ...ereditate]);
  const conTutti = [...aspetta.map(norm), ...prima.map((p) => p.num)].join(',');
  const nota = aVuoto ? ' A vuoto non leggo le attese delle unite: se una aspetta già quel feedback, il pacchetto lo prende da lei e l\'apertura vera non lo rifiuta.' : '';
  return prima.map(({ num, frase }) => `il testo mette #${num} prima del pacchetto («${citazione(frase)}»), ma il pacchetto non lo aspetta: il server lo darebbe da lavorare subito. Apri con --aspetta ${conTutti} (un feedback già su main non ferma niente), o riscrivi la frase se #${num} non deve fondersi prima${nota ? `.${nota}` : ''}`);
}

/**
 * Il testo di un pacchetto è la spec? I motivi del no, tutti insieme (vuoto = sì). `testo` comprende gli allegati di
 * testo; `unite` e `aspetta` sono i numeri di --pacchetto e --aspetta. Con `prerequisiti: false` i feedback messi prima
 * non si guardano: l'apertura li controlla dopo aver letto le attese delle unite (`prerequisitiMancanti`). PURA.
 */
export function difettiDellaSpec(testo, { unite = [], aspetta = [], prerequisiti = true, aVuoto = false } = {}) {
  const motivi = [];
  for (const f of rimandiAlleNote(testo)) {
    motivi.push(`il testo manda la spec nelle note («${citazione(f)}»): le note non arrivano a chi lavora il pacchetto, né a chi lo verifica. Scrivi la spec nel testo, o allegala con --allega spec.md; se la frase parla delle note come argomento, riscrivila senza mandare lì`);
  }
  const mancano = uniteNonNominate(testo, unite);
  if (mancano.length) {
    motivi.push(`la spec non nomina ${mancano.map((n) => `#${n}`).join(', ')}: per ogni segnalazione unita dice cosa cambia e come si verifica, nel testo o in un allegato di testo`);
  }
  if (prerequisiti) motivi.push(...prerequisitiMancanti(testo, { unite, aspetta, aVuoto }));
  return motivi;
}
