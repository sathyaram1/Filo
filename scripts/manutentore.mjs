// Il contesto del manutentore (SPEC-RIDISEGNO-LAVORO.md § 2): il suo ruolo, tutte le schede in una riga ciascuna e i rami
// in corso coi loro file, da git e senza modello; scrive solo l'ordine da accendere, che il pacemaker legge. Regole:
// tests/unit/manutentore.test.mjs. Uso: npm run manutentore -- contesto | rami | incroci <N> | ordine | accendi <N,M,…>|--niente

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { espandiInclusioni } from './lib/role-text.mjs';
import { incroci, ramiInCorso } from './lib/su-main.mjs';
import { CARTELLA_PREDEFINITA, INDICE, leggiSchede, validaScheda } from './schede.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Lo stesso tetto del server (functions/src/routine/accensioni.js, ORDINE_MAX): oltre si rifiuta col numero.
export const ORDINE_MAX = 2000;

/** «812, #815,815.2» → { ok, numeri } senza doppioni nell'ordine dato, o { ok:false, motivo }. PURA. */
export function leggiOrdine(testo) {
  const pezzi = String(testo || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  if (!pezzi.length) return { ok: false, motivo: 'accendi vuole i numeri in ordine (accendi 812,815) o --niente per svuotare l\'ordine' };
  const storti = pezzi.filter((x) => !/^#?[1-9]\d{0,6}(?:\.[1-9]\d{0,3})?$/.test(x));
  if (storti.length) return { ok: false, motivo: `non sono numeri di feedback: ${storti.slice(0, 5).join(', ')}` };
  const numeri = [...new Set(pezzi.map((x) => x.replace(/^#/, '')))];
  if (numeri.length > ORDINE_MAX) return { ok: false, motivo: `${numeri.length} numeri, il massimo è ${ORDINE_MAX}` };
  return { ok: true, numeri };
}

/** Il corpo REST del documento `config/manutentore`. PURA. */
export function corpoOrdine(numeri, adesso = new Date()) {
  return { fields: {
    ordine: { arrayValue: { values: numeri.map((n) => ({ stringValue: n })) } },
    at: { timestampValue: adesso.toISOString() },
  } };
}

// Nello stesso documento il server tiene anche N, sveglia e account del manutentore (#1961): si scrivono solo i campi propri.
export const MASCHERA_ORDINE = '?updateMask.fieldPaths=ordine&updateMask.fieldPaths=at';

async function documentoOrdine(metodo, corpo) {
  const { acquireBearer, FIRESTORE_BASE } = await import('./lib/firestore-auth.mjs');
  const bearer = await acquireBearer();
  const res = await fetch(`${FIRESTORE_BASE}/config/manutentore${metodo === 'PATCH' ? MASCHERA_ORDINE : ''}`, {
    method: metodo, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  if (metodo === 'GET' && res.status === 404) return { ok: true, numeri: [] };
  if (!res.ok) return { ok: false, motivo: `Firestore ha risposto ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const j = await res.json();
  return { ok: true, numeri: ((j.fields?.ordine?.arrayValue?.values) || []).map((v) => v.stringValue).filter(Boolean) };
}

// Ogni campo di una scheda viene dal testo di un feedback: una riga per scheda è ciò che lo tiene un dato.
const unaRiga = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/**
 * Quanto ci si può fidare della scheda, in parole, o '' se è buona: non buona, scritta su una versione vecchia del
 * feedback, o un «toglie lavoro» che la rilettura non ha confermato. PURA.
 */
export function avvisoScheda(s, f = {}) {
  const num = unaRiga(s.numero).replace(/^#/, '');
  const fonte = s._fonte || {};
  const toglie = s.valido === 'no' || (Array.isArray(s.doppione_di) && s.doppione_di.length > 0);
  return [
    validaScheda(s, num).length ? 'SCHEDA NON BUONA, da rifare' : '',
    // L'aggiornamento cambia a ogni modifica del feedback, stato compreso.
    f && f.id && (fonte.id !== f.id || fonte.aggiornato !== f.aggiornato) ? 'SCHEDA VECCHIA, il feedback è cambiato' : '',
    toglie && !s._riletta ? 'non riletta: non togliere lavoro su questa' : '',
  ].filter(Boolean).join(' · ');
}

/** Una scheda in una riga, con stato, priorità e attese dall'indice. PURA. */
export function rigaScheda(s, f = {}) {
  const num = unaRiga(s.numero).replace(/^#/, '');
  const numeri = (l) => (Array.isArray(l) ? l : []).map((n) => `#${unaRiga(n).replace(/^#/, '')}`).join(', ');
  const pezzi = [
    `#${num}`,
    avvisoScheda(s, f),
    `[${unaRiga(s.area) || '?'}/${unaRiga(s.tipo) || '?'}]`,
    unaRiga(f.stato || s.stato) || '?',
    Number.isInteger(f.priorita) ? `p${f.priorita}` : 'p?',
    s.urgente ? 'URGENTE' : '',
    `valido ${unaRiga(s.valido) || '?'}`,
    s.risolto_su_main ? `risolto? ${unaRiga(s.risolto_su_main).slice(0, 60)}` : '',
    Array.isArray(s.doppione_di) && s.doppione_di.length ? `doppione di ${s.doppione_di.map((n) => `#${unaRiga(n).replace(/^#/, '')}`).join(', ')}` : '',
    f && Array.isArray(f.unisce) && f.unisce.length ? `pacchetto di ${numeri(f.unisce)}` : '',
    f && Array.isArray(f.attese) && f.attese.length ? `aspetta ${numeri(f.attese)}` : '',
  ].filter(Boolean).join(' · ');
  const file = Array.isArray(s.file_probabili) && s.file_probabili.length ? ` | file: ${s.file_probabili.map(unaRiga).join(', ')}` : '';
  return `${pezzi} — ${unaRiga(s.titolo_breve)}: ${unaRiga(s.riassunto)}${file}`;
}

/** I rami dei worker (`worker/<id del feedback>-<ora>`) prendono il numero dall'indice, davanti ai citati. PURA. */
export function conNumeri(rami, indice) {
  const perId = new Map((indice || []).map((f) => [f.id, f.num]));
  return (rami || []).map((r) => {
    const n = perId.get((/^worker\/([A-Za-z0-9]+)-\d{8}T\d{6}Z$/.exec(r.ramo) || [])[1]);
    return n ? { ...r, feedback: [n, ...(r.feedback || []).filter((x) => x !== n)] } : r;
  });
}

/**
 * Toglie i rami i cui feedback citati sono tutti chiusi secondo l'indice (arrivati su main da un altro ramo, o
 * archiviati): non arriveranno su main. Un numero oltre l'ultimo dell'indice può essere nato dopo: resta. Senza indice
 * non si sa, e restano tutti. `fuori.chiusi` riceve i tolti. PURA.
 */
export function senzaChiusi(rami, indice, fuori = {}) {
  const aperti = new Set((indice || []).map((f) => String(f.num)));
  fuori.chiusi = [];
  if (!aperti.size) return rami || [];
  const ultimo = Math.max(...[...aperti].map((n) => Number(String(n).split('.')[0]) || 0));
  return (rami || []).filter((r) => {
    const fb = (r.feedback || []).map(String);
    if (!fb.length || fb.some((n) => aperti.has(n) || Number(n.split('.')[0]) > ultimo)) return true;
    fuori.chiusi.push(r.ramo);
    return false;
  });
}

/** Un ramo in corso in una riga. PURA. */
export function rigaRamo(r) {
  const altri = r.feedback && r.feedback.length > 3 ? ` e altri ${r.feedback.length - 3}` : '';
  const fb = r.feedback && r.feedback.length ? ` (${r.feedback.slice(0, 3).map((n) => `#${n}`).join(', ')}${altri})` : '';
  return `${r.ramo}${fb}, ${r.avanti} commit, ${String(r.data).slice(0, 10)}: ${r.file.join(', ') || '(nessun file)'}`;
}

/** Cosa l'elenco dei rami lascia fuori (ramiInCorso, `fuori`), in una riga; '' se niente. PURA. */
export function rigaFuori(fuori, giorni) {
  const f = fuori || {};
  const pezzi = [
    f.vecchi ? `${f.vecchi} rami fermi da più di ${giorni} giorni (--giorni N per vederli, --giorni 0 tutti)` : '',
    f.altri && f.altri.length ? `${f.altri.length} rami che non sono di lavoro (${f.altri.slice(0, 5).join(', ')}${f.altri.length > 5 ? ', …' : ''})` : '',
    f.chiusi && f.chiusi.length ? `${f.chiusi.length} rami di feedback già chiusi, non arriveranno su main (${f.chiusi.slice(0, 5).join(', ')}${f.chiusi.length > 5 ? ', …' : ''})` : '',
  ].filter(Boolean);
  return pezzi.length ? `Non elencati: ${pezzi.join('; ')}.` : '';
}

/** L'ordine con lo stato di ogni numero secondo l'indice: chi non è fra gli aperti il server lo salta. PURA. */
export function rigaOrdine(numeri, indice) {
  if (!numeri.length) return 'Nessun ordine: il pacemaker accende per priorità, come ripiego.';
  const perNum = new Map((indice || []).map((f) => [String(f.num), f]));
  const conIndice = (indice || []).length > 0;
  const voce = (n) => (!conIndice ? `#${n}` : perNum.has(n) ? `#${n} (${perNum.get(n).stato || 'aperto'})` : `#${n} (non fra gli aperti)`);
  const vivi = conIndice ? numeri.filter((n) => perNum.has(n)).length : numeri.length;
  const coda = !conIndice ? ' Senza l\'indice delle schede non so quali sono ancora aperti.'
    : vivi ? (numeri.length - vivi ? ` Fuori dagli aperti: ${numeri.length - vivi}, il server li salta.` : '')
    : ' Nessuno è fra gli aperti: il server fa come senza ordine, per priorità.';
  return `Ordine da accendere (${numeri.length}): ${numeri.map(voce).join(', ')}. Il pacemaker accende una sessione per ciascuno che ha lavoro, una priorità 3 fuori ordine davanti; un ordine senza feedback aperti vale come nessun ordine.${coda}`.trim();
}

const STATI_CHE_FERMANO = Object.freeze({ aperta: 'aspetta l\'owner', in_smistamento: 'in smistamento' });

/**
 * Le domande aperte o in smistamento che fermano un feedback aperto (#1790), una riga ciascuna, prima quelle dei
 * feedback dell'ordine: il manutentore le vede, non le smista (lo fa il compito «Gestisci la domanda»). PURA.
 */
export function righeDomandeFerme(domande, { indice = [], ordine = [], quando = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') } = {}) {
  const numDi = new Map((indice || []).map((f) => [f.id, String(f.num)]));
  const nellOrdine = new Set((ordine || []).map(String));
  const voci = [];
  for (const d of Array.isArray(domande) ? domande : []) {
    if (!d || !STATI_CHE_FERMANO[d.stato] || d.blocca === false || !d.legata) continue;
    const num = numDi.get(d.legata);
    if (!num) continue;
    const da = Number.isFinite(Number(d.creataIl)) && Number(d.creataIl) > 0 ? ` dal ${quando(Number(d.creataIl))}` : '';
    const ordine = nellOrdine.has(num) ? ' · nell\'ordine' : '';
    voci.push({ prima: nellOrdine.has(num) ? 0 : 1, num: Number(num.split('.')[0]) || 0,
      riga: `${unaRiga(d.id)} «${unaRiga(d.titolo)}» ferma #${num}${da} (${STATI_CHE_FERMANO[d.stato]}${ordine})` });
  }
  return voci.sort((a, b) => a.prima - b.prima || a.num - b.num).map((v) => v.riga);
}

/** Il contesto intero, in testo. PURA rispetto ai suoi ingressi. `ferme`: le righe di righeDomandeFerme, o il motivo per cui mancano. */
export function testoContesto({ ruolo, schede, indice, rami, fuori = null, giorni = 30, indiceDel = '', ferme = null }) {
  const numero = (s) => String(s.numero).replace(/^#/, '');
  const perNum = new Map((indice || []).map((f) => [f.num, f]));
  // Con l'indice valgono solo le schede dei feedback ancora aperti: le altre sono di feedback chiusi da allora.
  const aperte = indice && indice.length ? schede.filter((s) => perNum.has(numero(s))) : schede;
  const ordinate = [...aperte].sort((a, b) => Number(numero(a)) - Number(numero(b)));
  const senza = (indice || []).filter((f) => !schede.some((s) => numero(s) === f.num));
  const chiuse = schede.length - aperte.length;
  return [
    ruolo.trim(), '',
    `## Schede (${aperte.length})`, '',
    ...(indiceDel ? [`Aperti secondo l'indice del ${indiceDel}: un feedback nato dopo non c'è (npm run feedback:schede -- elenca).`, ''] : []),
    ...ordinate.map((s) => rigaScheda(s, perNum.get(numero(s)))),
    ...(senza.length ? ['', `Senza scheda (${senza.length}): ${senza.map((f) => `#${f.num}`).join(', ')}. Si scrivono con npm run feedback:schede -- scrivi.`] : []),
    ...(chiuse ? ['', `Fuori: ${chiuse} schede di feedback che l'indice non ha più fra gli aperti.`] : []),
    ...(ferme ? ['', `## Domande che fermano un feedback (${Array.isArray(ferme) ? ferme.length : '?'})`, '',
      ...(Array.isArray(ferme) ? (ferme.length ? ferme : ['Nessuna: nessun feedback aperto aspetta una domanda.']) : [String(ferme)]),
      'Le smista il compito «Gestisci la domanda»: tu non le rispondi, ma un feedback fermo non si accende.'] : []),
    '', `## Rami in corso (${rami.length})`, '',
    ...rami.map(rigaRamo),
    ...(rigaFuori(fuori, giorni) ? ['', rigaFuori(fuori, giorni)] : []),
    '', '## Spesa', '',
    'Questo strumento non la sa: chiedi all\'owner il consumo della settimana dell\'account (Gestione → Automazioni), non la somma dei biglietti.',
  ].join('\n');
}

/**
 * Le righe delle domande che fermano un feedback, dal server; il motivo in parole se non si leggono: il contesto esce
 * lo stesso. Il titolo di una domanda non fidata è testo d'altri: la sessione si sporca prima di stamparlo.
 */
async function domandeFerme(indice) {
  try {
    const { chiamaOwner, nonFidate, motivoNonFidate } = await import('./domanda.mjs');
    const r = await chiamaOwner({ op: 'elenco' });
    const ordine = await documentoOrdine('GET').catch(() => ({ ok: false }));
    const righe = righeDomandeFerme(r.domande, { indice, ordine: ordine.ok ? ordine.numeri : [] });
    const ferme = (r.domande || []).filter((d) => d && righe.some((x) => x.startsWith(`${unaRiga(d.id)} `)));
    const nf = nonFidate(ferme);
    if (nf.length) {
      const { rigaSporco } = await import('./lib/biglietto-locale.mjs');
      console.error(await rigaSporco('contesto del manutentore', [motivoNonFidate(nf)]));
    }
    return righe;
  } catch (e) {
    return `Non so quali domande fermano un feedback: ${unaRiga(e && e.message ? e.message : e).slice(0, 200)}.`;
  }
}

const CON_VALORE = ['--cartella', '--giorni'];

/** Gli argomenti di `accendi` che sono numeri: né le opzioni né i loro valori. PURA. */
export function numeriDiAccendi(args) {
  const out = [];
  for (let i = 0; i < (args || []).length; i++) {
    const a = String(args[i]);
    if (a.startsWith('--')) { if (CON_VALORE.includes(a)) i += 1; continue; }
    out.push(a);
  }
  return out;
}

function opzione(argv, nome) {
  const i = argv.findIndex((a) => a === nome || a.startsWith(`${nome}=`));
  if (i < 0) return undefined;
  return argv[i].includes('=') ? argv[i].slice(nome.length + 1) : argv[i + 1];
}

export async function main(argv, { root = ROOT } = {}) {
  const [cmd, arg] = argv;
  if (!['contesto', 'rami', 'incroci', 'ordine', 'accendi'].includes(cmd) || (cmd === 'incroci' && !arg)) {
    console.error('Uso: npm run manutentore -- contesto | rami | incroci <N> | ordine | accendi <N,M,…>|--niente  [--cartella <dir delle schede>] [--giorni 30] [--senza-fetch]');
    return 1;
  }
  // L'ordine da accendere: il pacemaker accende una sessione per ciascun feedback che ha lavoro, in quest'ordine.
  const cartella = resolve(opzione(argv, '--cartella') || CARTELLA_PREDEFINITA);
  let indice = [];
  let indiceDel = '';
  try {
    indice = JSON.parse(readFileSync(join(cartella, INDICE), 'utf8'));
    indiceDel = statSync(join(cartella, INDICE)).mtime.toISOString().slice(0, 16).replace('T', ' ');
  } catch (_) { /* senza indice niente stato, priorità né numeri dei worker */ }
  if (cmd === 'ordine' || cmd === 'accendi') {
    let numeri = [];
    if (cmd === 'accendi' && arg !== '--niente') {
      const o = leggiOrdine(numeriDiAccendi(argv.slice(1)).join(','));
      if (!o.ok) { console.error(`RIFIUTATO: ${o.motivo}. Non ho scritto niente.`); return 1; }
      numeri = o.numeri;
    }
    const r = cmd === 'ordine' ? await documentoOrdine('GET') : await documentoOrdine('PATCH', corpoOrdine(numeri));
    if (!r.ok) { console.error(`RIFIUTATO: ${r.motivo}`); return 2; }
    console.log(rigaOrdine(r.numeri, indice));
    return 0;
  }
  const g = opzione(argv, '--giorni');
  const giorni = g !== undefined && Number.isFinite(Number(g)) && Number(g) >= 0 ? Number(g) : 30;
  if (!argv.includes('--senza-fetch')) {
    try { execFileSync('git', ['-C', root, 'fetch', 'origin', '--prune', '--quiet'], { stdio: 'ignore', timeout: 120_000 }); } catch (e) {
      console.error(`AVVISO: git fetch non è riuscito (${String(e.message).split('\n')[0]}): i rami sono quelli dell'ultima volta.`);
    }
  }
  const fuori = {};
  const rami = senzaChiusi(conNumeri(ramiInCorso(root, { giorni, fuori }), indice), indice, fuori);
  if (cmd === 'rami') { console.log([rami.map(rigaRamo).join('\n') || 'Nessun ramo in corso.', rigaFuori(fuori, giorni)].filter(Boolean).join('\n')); return 0; }
  const schede = leggiSchede(cartella);
  if (cmd === 'incroci') {
    const num = String(arg).replace(/^#/, '');
    const s = schede.find((x) => String(x.numero).replace(/^#/, '') === num);
    if (!s) { console.error(`Nessuna scheda per #${num} in ${cartella}: npm run feedback:schede -- scrivi --solo ${num}.`); return 1; }
    const comuni = incroci(rami, s.file_probabili);
    console.log(comuni.length
      ? comuni.map((c) => `${c.ramo}${c.feedback.length ? ` (#${c.feedback[0]})` : ''}: ${c.comuni.join(', ')}`).join('\n')
      : `Nessun ramo in corso tocca i file probabili di #${num} (${(s.file_probabili || []).join(', ') || 'nessuno indicato'}).`);
    return 0;
  }
  if (!schede.length) console.error(`AVVISO: nessuna scheda in ${cartella}: npm run feedback:schede -- elenca, poi scrivi.`);
  const dirRuoli = join(ROOT, 'routines', 'roles');
  const ruolo = espandiInclusioni(readFileSync(join(dirRuoli, 'manutentore.md'), 'utf8'), dirRuoli);
  const ferme = await domandeFerme(indice);
  console.log(testoContesto({ ruolo, schede, indice, rami, fuori, giorni, indiceDel, ferme }));
  return 0;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(await main(process.argv.slice(2)));
