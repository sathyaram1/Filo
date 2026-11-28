// Chiavi, password, codici e numeri di carta scritti in un campo non partono verso i modelli del correttore (#1446): al
// loro posto va un segnaposto e il resto si controlla lo stesso. Le forme le riconoscono guardianoStatico.js, urlExfil.js
// e riservatiNelTesto.js (quelle scritte a mano, le stesse del pavimento). Prove: tests/unit/correttoreRiservati.test.mjs.
'use strict';

const SEGNAPOSTO = '[dato riservato]';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const GRUPPI_DI_CARTA = /(?<![\p{L}\p{N}])\d{4}(?: \d{4})+(?![\p{L}\p{N}])/gu;
// Il testo sopra il campo che si legge: la domanda a cui il campo risponde sta lì (riservatiNelTesto.js, richiestaAperta).
const SOPRA_MAX = 1500;

const RT = () => globalThis.SN_RISERVATI_TESTO || require('../../shared/riservatiNelTesto.js');
const PAV = () => globalThis.SN_PAVIMENTO || require('../../shared/pavimento.js');

// Com'è la password, non qual è: «scade», «è sbagliata», «deve contenere», «resta segreta». Con NON_VALORE del pavimento.
const STATO = /^(?:scad(?:e|ono|rà|ut[aoie])|sbagliat[aoie]|errat[aoie]|corrett[aoie]|debol[ei]|fort[ei]|sicur[aoie]|valid[aoie]|bloccat[aoie]|dimenticat[aoie]|smarrit[aoie]|pers[aoie]|rinnovat[aoie]|resettat[aoie]|reimpostat[aoie]|modificat[aoie]|cambi(?:a|ano|erà|are|at[aoie])|stat[aoie]|funzion(?:a|ano|erà)|dett[aoie]|lung(?:a|o|he|hi)|cort[aoie]|troppo|spesso|essere|ricord(?:o|a|i|iamo|are)|trov(?:i|a|ate|ano)|recuper(?:a|ano|i)|prima|dopo|precedente|non|mai|va|vanno|obbligatori[aoie]|richiest[aoie]|facoltativ[aoie]|temporane[aoie]|provvisori[aoie]|segret[aoie]|divers[aoie]|salvat[aoie]|inserit[aoie]|scritt[aoie]|personal[ei]|unic[aoie]|privat[aoie]|nascost[aoie]|blocc(?:a|ano)|serv(?:e|ono|irà)|contien[ei]|conten(?:ere|gono)|avere|hanno|devono|possono|viene|vengono|rest(?:a|ano)|riman(?:e|gono)|divent(?:a|ano|erà)|entrare|accedere|inserir(?:e|la)|scriver(?:e|la)|usar(?:e|la)|sceglier(?:e|la)|digitar(?:e|la)|cambiarla|dirl[ao]|convien[ei]|tentativ[oi]|clicca|premi|tocca|click|tutto|tuttora|case|sensitive|expire[sd]?|wrong|incorrect|invalid|weak|strong|changed|forgotten|lost|works?|too|short|long|often|not|never|before|previous|required|must|contain)$/;
// I verbi di cambio («aggiornata», «rimasta», «became») sono quelli del guardiano, un elenco solo (#1403.67).
let cambio = null;
const CAMBIO = () => cambio || (cambio = ((G) => new RegExp(`^(?:${G.CAMBI}|${G.PARTICIPI}|${G.PASSATI})$`, 'iu'))(
  globalThis.SN_GUARDIANO_STATICO || (require('../../shared/guardianoStatico.js'), globalThis.SN_GUARDIANO_STATICO)));
// Quando e quanto, oltre a quelle del pavimento: «domani», «due volte», «una maiuscola», «un numero».
const QUANDO = /^(?:domani|dopodomani|stamattina|stasera|stanotte|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|volt[ae]|tomorrow|times?|maiuscol[aei]|minuscol[aei]|numer[oi]|simbol[oi]|spazi[o]?|uppercase|lowercase|numbers?)$/;
// Dove sta («sul retro del router», «nel portachiavi») e di chi è («del conto», «dell'email»): una parola sola dopo,
// così «sul retro gattonero» lascia fuori il valore. «in», «a», «con» no: «cambiata in gattonero» lo presenta.
const LUOGO = /^(?:sul|sullo|sulla|sui|sugli|sulle|su|nel|nello|nella|nei|negli|nelle|dal|dallo|dalla|dai|dagli|dalle|sotto|sopra|dietro|dentro|presso|per|ogni|on|under|behind|inside|near|every)$/;
const DI = /^(?:del|dello|della|dei|degli|delle|di|of)$/;
const DETERMINA = /^(?:il|lo|la|i|gli|le|un|uno|una|ogni|tutti|tutte|mio|mia|tuo|tua|suo|sua|the|an?|my|your|each)$/;
const APOSTROFATA = /^(?:dell|nell|sull|dall|all|l)['’]\p{L}+$/u;
const pulita = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// Una parola che spiega copre solo sé stessa, non il valore accanto («è gattonero ma scade a giugno»); le vicine le
// copre solo un luogo o il nome di chi è la password, per una parola. Una data da sola dopo l'annuncio è il valore.
const coperteDi = new WeakMap();
function coperte(parole) {
  if (coperteDi.has(parole)) return coperteDi.get(parole);
  const S = PAV().SPIEGA;
  const presenta = RT().PRESENTA_DATO;
  const p = parole.map((w) => pulita(w).toLowerCase());
  const annuncio = (i) => presenta.has(p[i]) || (i > 0 && /[:=：]$/.test(parole[i - 1]));
  const out = p.map(() => false);
  // Dopo `i`, saltati gli articoli, una parola: con «di …» dietro, anche quella («sul retro del router»).
  const copriFrase = (i) => {
    let j = i + 1;
    for (;;) {
      while (j < p.length && DETERMINA.test(p[j])) out[j++] = true;
      if (j >= p.length || annuncio(j)) return j;
      out[j++] = true;
      if (j < p.length && DI.test(p[j]) && !annuncio(j)) { out[j++] = true; continue; }
      return j;
    }
  };
  const pezzoDi = [];
  const lunghezza = new Map();
  for (let i = 0, da = null; i < p.length; i++) {
    if (presenta.has(p[i])) { da = i + 1; continue; }
    if (annuncio(i)) da = i;
    pezzoDi[i] = da;
    if (da !== null) lunghezza.set(da, (lunghezza.get(da) || 0) + 1);
  }
  let catena = 0;
  for (let i = 0; i < p.length; i++) {
    if (presenta.has(p[i])) { out[i] = true; catena = -1; continue; }
    if (annuncio(i)) catena = -1;
    const w = p[i];
    const sola = pezzoDi[i] !== null && lunghezza.get(pezzoDi[i]) === 1;
    if (STATO.test(w) || CAMBIO().test(w) || (S &&(S.descrive.test(w) || S.nonValore.test(w)))
      || (!sola && (QUANDO.test(w) || (S && (S.tempo.test(w) || S.misura.test(w)))))) out[i] = true;
    if (APOSTROFATA.test(w) && (i === catena || !/^l['’]/.test(w))) { out[i] = true; if (i === catena) catena = i + 1; continue; }
    if (LUOGO.test(w) || (DI.test(w) && (i === catena || (i > 0 && S && S.descrive.test(p[i - 1]))))) {
      out[i] = true;
      const fine = copriFrase(i);
      if (i === catena) catena = fine;
      i = fine - 1;
    }
  }
  coperteDi.set(parole, out);
  return out;
}
function spiega(parole, k) {
  if (!PAV().SPIEGA || !RT().PRESENTA_DATO) return false;
  return coperte(parole)[k];
}

function riservati(grezzo) {
  // L'enfasi e i segni di blocco del Markdown e i tag HTML fra etichetta e valore («__Password:__ …», «- …» sotto
  // l'etichetta) si leggono come spazi, e un commento HTML in due letture, come nel pavimento.
  return RT().vistePerLeRegole(grezzo).flatMap(riservatiIn);
}

function riservatiIn(testo) {
  const G = globalThis.SN_GUARDIANO_STATICO;
  const X = globalThis.SN_URL_EXFIL;
  const out = [];
  const l = testo.toLowerCase();
  try { if (G && G.segretiNelTesto) out.push(...G.segretiNelTesto(testo)); } catch (_) {}
  // Anche col nome o il verbo scritti con un refuso e con un inciso fra i due, come nel pavimento (#2678.21).
  for (const t of [l, ...RT().lettureDelNome(testo).map((x) => x.toLowerCase())]) {
    try { if (X && X.segretiDetti) out.push(...X.segretiDetti(t, { spiega })); } catch (_) {}
  }
  // Una carta mentre la si scrive: due gruppi da quattro cifre sono già metà numero, e il resto arriva al controllo dopo.
  for (const m of testo.matchAll(GRUPPI_DI_CARTA)) out.push({ valore: m[0].replace(/ /g, '') });
  const valori = [...RT().lunghi(out), ...RT().trova(testo)];
  // Quello che il pavimento toglie al cancello dei modelli (un CVV di tre cifre, «login_password: …») qui non parte.
  try { valori.push(...PAV().trova(testo).map((x) => String(x.valore))); } catch (_) {}
  // Una password con gli spazi fra virgolette vale intera, come nel pavimento.
  try { valori.push(...RT().lunghi(PAV().interiFraVirgolette(testo, valori))); } catch (_) {}
  return valori;
}

// Un numero di carta si scrive anche a gruppi («4111 1111 …»): fra una cifra e l'altra può stare uno spazio o un trattino;
// in un numero corto anche il separatore delle cifre scandite («4.8.2.1», riservatiNelTesto.js).
// Una parola di sole lettere vale intera: il «camera» di una risposta non tocca «cameraman». Così un numero corto (CVV,
// PIN): «123» non tocca l'ordine «81234». Uno lungo no, perché nei pezzi incollati due carte stanno attaccate.
function formaDi(valore) {
  if (/^\d{1,7}$/.test(valore)) return new RegExp(`(?<![\\p{L}\\p{N}])${valore.split('').join(`(?:\\s|${RT().SEPARA_CIFRE})?`)}(?![\\p{L}\\p{N}])`, 'giu');
  if (/^\d+$/.test(valore)) return new RegExp(valore.split('').join('[\\s-]?'), 'gi');
  if (/^\p{L}+$/u.test(valore)) return new RegExp(`(?<![\\p{L}\\p{N}])${valore}(?![\\p{L}\\p{N}])`, 'giu');
  return new RegExp(esc(valore), 'gi');
}
const valoriDi = (testo) => [...new Set(riservati(testo))].sort((a, b) => b.length - a.length);

function oscura(testo, valori = null) {
  let v = String(testo == null ? '' : testo);
  if (!v.trim()) return v;
  for (const valore of valori || valoriDi(v)) v = v.replace(formaDi(valore), SEGNAPOSTO);
  return v;
}

// Il campo è il messaggio sotto il testo sopra: i codici il pavimento li legge lì, come il cancello dei modelli nella
// conversazione intera, così la risposta a «mi dici il puk?» non parte nemmeno con la domanda fuori dal campo (#2692.5).
// La password no: la risposta sotto chi la chiede la legge richiestaAperta, che sa quando il legame è finito (#1723).
function codiciSottoLaDomanda(sopra, campo) {
  try {
    return PAV().trova(/\n\s*$/.test(sopra) ? sopra + campo : `${sopra}\n${campo}`).filter((x) => x.regola === 'codice').map((x) => String(x.valore));
  } catch (_) { return []; }
}

// I pezzi contigui del campo (prima, nuovo, dopo), oscurati sul campo intero: la parola che presenta una password, o
// metà di un numero di carta, può stare in un pezzo diverso dal valore, o fuori dai pezzi. `campo` e `campoDa` (dove
// comincia il primo pezzo) li manda la pagina; se non tornano coi pezzi vale il loro testo unito.
function pezziOscurati(pezzi, campo, campoDa, sopra = '') {
  const R = RT();
  const unito = pezzi.join('');
  const daCampo = typeof campo === 'string' && Number.isInteger(campoDa) && campoDa >= 0
    && campo.slice(campoDa, campoDa + unito.length) === unito;
  const base = daCampo ? campo : unito;
  const scarto = daCampo ? campoDa : 0;
  // Sopra il campo stanno la domanda a cui risponde e il messaggio che ha già detto il dato.
  const s = typeof sopra === 'string' ? sopra.slice(-SOPRA_MAX) : '';
  const aperta = s ? R.richiestaAperta(s) : null;
  // Anche pezzo per pezzo: due pezzi incollati possono fondere due numeri in uno che non è più una carta.
  const valori = [...new Set([
    ...[base, ...pezzi].flatMap(valoriDi),
    ...(s ? valoriDi(s) : []),
    ...(s ? codiciSottoLaDomanda(s, base) : []),
    ...(aperta ? R.lunghi(R.valoriRisposta(R.minuscolo(base.slice(0, R.RISPOSTA_MAX)),aperta.tipo, aperta.chiesta, aperta.data)) : []),
  ])].sort((x, y) => y.length - x.length);
  const coperti = [];
  for (const valore of valori) for (const m of base.matchAll(formaDi(valore))) coperti.push([m.index - scarto, m.index - scarto + m[0].length]);
  let a = 0;
  const out = pezzi.map((pezzo) => {
    const da = a;
    a += pezzo.length;
    const qui = coperti.map(([x, y]) => [Math.max(x, da) - da, Math.min(y, a) - da]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
    const uniti = [];
    for (const [x, y] of qui) {
      const ultimo = uniti[uniti.length - 1];
      if (ultimo && x <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], y); else uniti.push([x, y]);
    }
    let v = '';
    let i = 0;
    for (const [x, y] of uniti) { v += pezzo.slice(i, x) + SEGNAPOSTO; i = y; }
    return v + pezzo.slice(i);
  });
  return { pezzi: out, valori };
}

// Le parti di una richiesta del correttore che portano testo: quello del campo, i candidati, la pagina intorno. Il campo
// intero e il testo sopra servono solo qui: non partono.
function richiestaSenzaRiservati(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = { ...p };
  delete out.campo;
  delete out.campoDa;
  delete out.sopra;
  // Il testo sopra lo legge la pagina a ogni richiesta; senza, vale quello che parte con lei.
  const sopra = [p.sopra, p.contesto && p.contesto.prima, p.luogo && p.luogo.conversazione].find((t) => typeof t === 'string') || '';
  const chiavi = ['prima', 'nuovo', 'dopo'];
  const { pezzi, valori } = pezziOscurati(chiavi.map((k) => (typeof p[k] === 'string' ? p[k] : '')), p.campo, p.campoDa, sopra);
  chiavi.forEach((k, i) => { if (typeof p[k] === 'string') out[k] = pezzi[i]; });
  const delCampo = (t) => oscura(oscura(t, valori));
  if (Array.isArray(p.candidati)) out.candidati = p.candidati.map((c) => (c && typeof c === 'object' ? { ...c, pezzo: delCampo(c.pezzo) } : c));
  if (p.luogo && typeof p.luogo === 'object') {
    out.luogo = { ...p.luogo };
    for (const k of ['titolo', 'conversazione']) if (typeof p.luogo[k] === 'string') out.luogo[k] = delCampo(p.luogo[k]);
  }
  if (p.contesto && typeof p.contesto === 'object') {
    out.contesto = { ...p.contesto };
    for (const k of ['prima', 'dopo']) if (typeof p.contesto[k] === 'string') out.contesto[k] = delCampo(p.contesto[k]);
  }
  // Le date da giudicare portano il pezzo del campo e le righe della pagina (o del titolo) che dicono l'anno.
  const testo = (t) => (typeof t === 'string' ? delCampo(t) : '');
  if (Array.isArray(p.date)) {
    out.date = p.date.filter((d) => d && typeof d === 'object').map((d) => ({
      ...d, pezzo: testo(d.pezzo),
      anni: (Array.isArray(d.anni) ? d.anni : []).map((a) => (a && typeof a === 'object' ? { ...a, riga: testo(a.riga) } : a)),
    }));
  }
  return out;
}

const formeLibere = (testo) => RT().formeLibere(testo);

module.exports = { SEGNAPOSTO, oscura, pezziOscurati, richiestaSenzaRiservati, formeLibere };
