// Il testo di un pacchetto alla nascita: chi lavora riceve testo e allegati, mai le note, e si ferma solo sulle attese.
// Pura: niente rete né letture delle unite (quelle le controlla claude-feedback.mjs). Regole: tests/unit/specDelPacchetto.test.mjs.

import '../../src/shared/feedbackAttese.js';

const NUM = String.raw`#(\d{1,7}(?:\.\d{1,6})?)`;
const norm = (n) => globalThis.SN_FB_ATTESE.normalizzaNumero(n);

/** Le frasi di un testo: un punto davanti a una cifra (#663.2, 1.000) non la chiude. PURA. */
export function frasi(testo) {
  return String(testo || '').split(/[\n;!?]+|\.(?!\d)/).map((f) => f.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const SUBITO_ALLE_NOTE = /\b(?:vedi|leggi|segui|guarda)\s+(?:(?:le|la)\s+)?(?:(?:sue|sua)\s+)?not[ae]\b/i;
const NELLE_NOTE = /\b(?:nell[ae]|in|sulle|dalle)\s+(?:(?:sue|sua)\s+)?not[ae]\b/i;
const COSA_FARE = /\b(?:spec\w*|dettagl\w*|istruzion\w*|piano|resto|da\s+seguire)\b/i;

/** Le frasi che mandano a leggere la spec nelle note. «Nelle note manca la data» parla delle note e non manda. PURA. */
export function rimandiAlleNote(testo) {
  return frasi(testo).filter((f) => SUBITO_ALLE_NOTE.test(f) || (NELLE_NOTE.test(f) && COSA_FARE.test(f)));
}

const PRIMA = [
  new RegExp(`${NUM}[^#]{0,40}?\\b(?:fond|fus|main|arriv)\\w*[^#]{0,25}?\\bprima\\b`, 'gi'),
  new RegExp(`\\bprima\\b[^#]{0,30}?\\b(?:fond|fus|main)\\w*[^#]{0,15}?${NUM}`, 'gi'),
  new RegExp(`\\bdopo\\s+(?:la\\s+fusione\\s+d\\w*\\s+|che\\s+)${NUM}`, 'gi'),
  new RegExp(`\\b(?:aspett(?:a|are|ando|i)|in\\s+attesa\\s+d\\w*|dipend\\w*\\s+da|richied\\w*)\\s+(?:che\\s+)?${NUM}`, 'gi'),
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
 * Il testo di un pacchetto è la spec? I motivi del no, tutti insieme (vuoto = sì). `testo` comprende gli allegati di
 * testo; `unite` e `aspetta` sono i numeri di --pacchetto e --aspetta. PURA.
 */
export function difettiDellaSpec(testo, { unite = [], aspetta = [] } = {}) {
  const motivi = [];
  for (const f of rimandiAlleNote(testo)) {
    motivi.push(`il testo manda la spec nelle note («${citazione(f)}»): le note non arrivano a chi lavora il pacchetto, né a chi lo verifica. Scrivi la spec nel testo, o allegala con --allega spec.md; se la frase parla delle note come argomento, riscrivila senza mandare lì`);
  }
  const mancano = uniteNonNominate(testo, unite);
  if (mancano.length) {
    motivi.push(`la spec non nomina ${mancano.map((n) => `#${n}`).join(', ')}: per ogni segnalazione unita dice cosa cambia e come si verifica, nel testo o in un allegato di testo`);
  }
  for (const { num, frase } of prerequisitiNelTesto(testo, [...unite, ...aspetta])) {
    motivi.push(`il testo mette #${num} prima del pacchetto («${citazione(frase)}»), ma il pacchetto non lo aspetta: il server lo darebbe da lavorare subito. Aggiungi --aspetta ${num} (se è già su main l'attesa è già sciolta), o riscrivi la frase se #${num} non deve fondersi prima`);
  }
  return motivi;
}
