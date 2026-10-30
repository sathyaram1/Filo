// domanda.mjs — le domande all'owner (#1149, SPEC-DOMANDE.md §3). Col biglietto delle routine `chiedi` passa dal canale;
// il resto va a ownerDomande col segreto del biglietto locale (#1148, la fiducia), e chi stampa una non fidata si sporca.
// Le azioni di consenso e quelle `bulk:false` non partono da qui: solo dalla finestra di Filo (regola, non muro).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibile } from './routine-domanda.mjs';
import { absolutizeOutput } from './lib/tools-pin.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
require(join(HERE, '..', 'src', 'shared', 'domande.js'));
const D = globalThis.SN_DOMANDE;

const FUNZIONI = 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
const USO = [
  'Uso: node scripts/domanda.mjs <comando>',
  '  chiedi <file.json | ->                apre una domanda (JSON da file o da stdin): prima la smista un agente',
  '  registro <parole>                     cerca fra i principi delle domande chiuse: da guardare prima di chiedere',
  '  mostra D-n                            la domanda intera, con le note per gli agenti',
  '  elenco [--tutte]                      le domande aperte, in smistamento e in lavorazione, coi conteggi (--tutte: anche chiuse)',
  '  rispondi D-n [--scelta N] [--testo "…" | --testo -]   --scelta applica l\'opzione N, numerata come in «mostra»;',
  '                                        il testo da solo resta parole e non applica niente',
  '  consiglio D-1 [D-2 …]                 applica l\'opzione consigliata',
  '  archivia D-n | riapri D-n             la toglie senza applicare niente, o la rimette aperta',
  '',
  'Col biglietto del compito che gestisce una risposta (la domanda la dice il biglietto):',
  '  mostra                                rilegge la domanda, coi feedback che nomina e il registro',
  '  chiarimento --testo "…" | --testo -   chiede all\'owner un chiarimento: la domanda torna aperta',
  '  note --testo "…" | --testo -          riscrive le note per gli agenti (vuote: le toglie)',
  '  principio --testo "…" | --testo -     la regola generale che la risposta stabilisce',
  '  azione \'{"tipo":…}\' [--testo …]     applica riprendi, priorita o archivia su un feedback della domanda',
  '  chiudi --testo "…" | --testo - [--principio "…"]   il resoconto per l\'owner: la domanda si chiude',
  '',
  'Col biglietto del compito che gestisce una domanda appena nata (la domanda la dice il biglietto):',
  '  smista mostra                         rilegge la domanda, il feedback da cui viene e il registro',
  '  smista guasto --chiave "<strumento>: <prima riga del rifiuto>" --titolo "…" --testo "…" | - --resoconto "…"',
  '                                        è un guasto: feedback del difetto aperto o riusato, il lavoro fermo lo aspetta',
  '  smista ricevuti --richiesta fiducia|permesso --testo "…" | -   serve l\'owner: il lavoro va nei Ricevuti',
  '  smista automatica --scelta N --principio D-k --testo "…" | -   risponde il principio di D-k con l\'opzione N',
  '  smista pubblica <file.json | ->       la domanda riscritta per l\'owner: da lì la vede lui',
].join('\n');

// I comandi del compito «Gestisci la risposta» (#1152, SPEC-DOMANDE.md §3.5): passano dal canale delle routine.
const DEL_COMPITO = Object.freeze(['chiarimento', 'note', 'principio', 'azione', 'chiudi']);
const TESTO_SERVE = Object.freeze(['chiarimento', 'chiudi']);
// Quelli del compito «Gestisci la domanda» (#1790, §3.5): hanno un verbo loro, perché il biglietto non dice il ruolo.
const DELLO_SMISTAMENTO = Object.freeze({
  mostra: { ammesse: [], servono: [] },
  guasto: { ammesse: ['chiave', 'titolo', 'testo', 'resoconto'], servono: ['chiave', 'titolo', 'testo', 'resoconto'] },
  ricevuti: { ammesse: ['richiesta', 'testo'], servono: ['richiesta', 'testo'] },
  automatica: { ammesse: ['scelta', 'principio', 'testo'], servono: ['scelta', 'principio', 'testo'] },
  pubblica: { ammesse: [], servono: [] },
});
const RICHIESTE = Object.freeze(['fiducia', 'permesso']);
// Tetti dei campi del compito: oltre si rifiuta col numero (CLAUDE.md § Limiti); il testo lungo va da stdin.
const TETTI_SMISTA = Object.freeze({ chiave: 300, titolo: 200, resoconto: 1000, testo: 20000 });
export const MAX_PAROLE_REGISTRO = 200;

/** Le parole della riga di comando. PURA. @returns {{ cmd, … } | { errore }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const cmd = a[0] || '';
  const idOk = (v) => D.numeroDi(v) !== null;
  if (cmd === 'chiedi') {
    return a.length === 2 && a[1] ? { cmd, file: a[1] } : { errore: `chiedi vuole un file JSON, o «-» per leggerlo da stdin.\n${USO}` };
  }
  if (cmd === 'mostra' && a.length === 1) return { cmd, delCompito: true };
  if (cmd === 'mostra' || cmd === 'archivia' || cmd === 'riapri') {
    return a.length === 2 && idOk(a[1]) ? { cmd, id: a[1].trim() } : { errore: `${cmd} vuole una domanda nella forma D-12.\n${USO}` };
  }
  if (DEL_COMPITO.includes(cmd)) return argomentiDelCompito(cmd, a.slice(1));
  if (cmd === 'smista') return argomentiDelloSmistamento(a.slice(1));
  if (cmd === 'registro') {
    const parole = a.slice(1).join(' ').trim();
    if (!parole) return { errore: `registro vuole le parole da cercare fra i principi (per esempio: registro crediti dichiarati).\n${USO}` };
    if (parole.length > MAX_PAROLE_REGISTRO) return { errore: `le parole da cercare sono ${parole.length} caratteri, il massimo è ${MAX_PAROLE_REGISTRO}: bastano poche parole chiave.` };
    return { cmd, parole };
  }
  if (cmd === 'elenco') {
    if (a.length === 1) return { cmd, tutte: false };
    return a.length === 2 && a[1] === '--tutte' ? { cmd, tutte: true } : { errore: `"${a[1].slice(0, 40)}" non vale qui.\n${USO}` };
  }
  if (cmd === 'rispondi') {
    if (!idOk(a[1])) return { errore: `rispondi vuole prima la domanda, nella forma D-12.\n${USO}` };
    const out = { cmd, id: a[1].trim() };
    for (let i = 2; i < a.length; i++) {
      const m = /^--(scelta|testo)(?:=(.*))?$/s.exec(a[i]);
      if (!m) return { errore: `"${a[i].slice(0, 40)}" non vale qui.\n${USO}` };
      const v = m[2] !== undefined ? m[2] : a[++i];
      if (v === undefined) return { errore: `--${m[1]} vuole un valore.` };
      if (m[1] === 'scelta') {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) return { errore: `--scelta vuole il numero dell'opzione (da 1), non "${String(v).slice(0, 20)}".` };
        out.scelta = n - 1;
      } else {
        out.testo = v;
      }
    }
    if (out.scelta === undefined && out.testo === undefined) return { errore: `rispondi vuole --scelta N, --testo "…" o tutti e due.\n${USO}` };
    return out;
  }
  if (cmd === 'consiglio') {
    const ids = a.slice(1);
    if (!ids.length) return { errore: `consiglio vuole almeno una domanda.\n${USO}` };
    const storti = ids.filter((x) => !idOk(x));
    if (storti.length) return { errore: `domande non valide: ${storti.map((x) => x.slice(0, 20)).join(', ')} (la forma è D-12).` };
    return { cmd, ids: [...new Set(ids.map((x) => x.trim()))] };
  }
  return { errore: USO };
}

/** Le opzioni di un comando del compito, controllate come le controlla il server. PURA. */
function argomentiDelCompito(cmd, resto) {
  const out = { cmd };
  const ammesse = cmd === 'chiudi' ? ['testo', 'principio'] : ['testo'];
  const lista = resto.slice();
  if (cmd === 'azione') {
    const json = lista.shift();
    if (json === undefined || json.startsWith('--')) return { errore: `azione vuole l'azione in JSON, per esempio '{"tipo":"riprendi","feedbackId":"…"}'.\n${USO}` };
    let azione;
    try { azione = JSON.parse(json); } catch (e) { return { errore: `l'azione non è JSON valido: ${String(e?.message || e).slice(0, 120)}.` }; }
    const vietata = D.vietataAlCompito(azione);
    if (vietata) return { errore: `${vietata.errore}: ${vietata.dettaglio}.` };
    out.azione = azione;
  }
  for (let i = 0; i < lista.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/s.exec(lista[i]);
    if (!m || !ammesse.includes(m[1])) return { errore: `"${lista[i].slice(0, 40)}" non vale con ${cmd}: ${ammesse.map((x) => `--${x}`).join(', ')}.\n${USO}` };
    const v = m[2] !== undefined ? m[2] : lista[++i];
    if (v === undefined) return { errore: `--${m[1]} vuole un valore (o «-» per leggerlo da stdin).` };
    out[m[1]] = v;
  }
  if (out.testo === undefined && cmd !== 'azione') return { errore: `${cmd} vuole --testo "…", o --testo - per leggerlo da stdin.\n${USO}` };
  if (out.principio === '-') return { errore: '--principio si scrive sulla riga: da stdin arriva solo --testo.' };
  return out;
}

/** Le opzioni di `smista <op>`, controllate prima del canale. PURA. */
function argomentiDelloSmistamento(resto) {
  const op = resto[0] || '';
  const spec = DELLO_SMISTAMENTO[op];
  if (!spec) return { errore: `smista vuole un'operazione fra ${Object.keys(DELLO_SMISTAMENTO).join(', ')}.\n${USO}` };
  const out = { cmd: 'smista', op };
  const lista = resto.slice(1);
  if (op === 'pubblica') {
    if (lista.length !== 1 || !lista[0] || (lista[0] !== '-' && lista[0].startsWith('--'))) return { errore: `smista pubblica vuole il file JSON della domanda riscritta, o «-» per leggerlo da stdin.\n${USO}` };
    out.file = lista[0];
    return out;
  }
  for (let i = 0; i < lista.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/s.exec(lista[i]);
    if (!m || !spec.ammesse.includes(m[1])) {
      return { errore: `"${lista[i].slice(0, 40)}" non vale con smista ${op}${spec.ammesse.length ? `: ${spec.ammesse.map((x) => `--${x}`).join(', ')}` : ', che non vuole altro'}.\n${USO}` };
    }
    const v = m[2] !== undefined ? m[2] : lista[++i];
    if (v === undefined) return { errore: `--${m[1]} vuole un valore.` };
    out[m[1]] = v;
  }
  const mancano = spec.servono.filter((k) => out[k] === undefined || (out[k] !== '-' && !String(out[k]).trim()));
  if (mancano.length) return { errore: `smista ${op} vuole ${mancano.map((k) => `--${k}`).join(', ')}.\n${USO}` };
  const daStdin = Object.keys(out).filter((k) => out[k] === '-');
  if (daStdin.some((k) => k !== 'testo')) return { errore: 'da stdin arriva solo --testo: gli altri campi si scrivono sulla riga.' };
  for (const [k, max] of Object.entries(TETTI_SMISTA)) {
    if (typeof out[k] === 'string' && out[k] !== '-' && out[k].length > max) return { errore: `--${k} è lungo ${out[k].length} caratteri, il massimo è ${max}.` };
  }
  if (op === 'ricevuti' && !RICHIESTE.includes(out.richiesta)) return { errore: `--richiesta è ${RICHIESTE.join(' o ')}: la fiducia da dare al lavoro, o un permesso (anche una chiave) che solo l'owner scrive.` };
  if (op === 'automatica') {
    const n = Number(out.scelta);
    if (!Number.isInteger(n) || n < 1) return { errore: `--scelta vuole il numero dell'opzione (da 1), non "${String(out.scelta).slice(0, 20)}".` };
    out.scelta = n - 1;
    if (D.numeroDi(out.principio) === null) return { errore: `--principio vuole la domanda chiusa da cui viene il principio, nella forma D-12.` };
    out.principio = out.principio.trim();
  }
  return out;
}

/** Un rifiuto della validazione comune, col campo davanti: chi l'ha scritto sa dove guardare. PURA. */
function rifiutoDomanda(v) {
  return `${v.errore}${v.campo ? ` (campo «${v.campo}»)` : ''}: ${v.dettaglio}. Non ho mandato niente.`;
}

/** Il JSON di una domanda, controllato come lo controlla il server, prima di chiamarlo. PURA. */
export function leggiDomandaJson(testo, { conOrigine = true, formaOwner = false } = {}) {
  let grezza;
  try {
    grezza = JSON.parse(String(testo ?? ''));
  } catch (e) {
    return { errore: `JSON malformato: ${String(e?.message || e).slice(0, 200)}. Non ho mandato niente.` };
  }
  const v = D.validaDomanda(grezza, { conOrigine });
  if (!v.ok) return { errore: rifiutoDomanda(v) };
  // La riscrittura del compito «Gestisci la domanda» ha in più la forma corta per l'owner (§3.5).
  const forma = formaOwner ? D.controllaFormaOwner(v.domanda) : null;
  if (forma) return { errore: rifiutoDomanda(forma) };
  return { domanda: v.domanda };
}

/** Un'azione che una sessione non applica: di consenso, o da fare una per una. PURA. */
export function soloDaFilo(azione) {
  const spec = azione && D.TIPI[azione.tipo];
  return !spec || spec.consenso === true || spec.bulk === false;
}

/** Il motivo di un errore della callable. PURA. */
export function messaggioErrore(status, body) {
  const b = body || {};
  const err = b.error || {};
  const res = b.result && b.result.ok === false ? b.result : null;
  const msg = err.message || (res && (res.detail || res.reason))
    || (status === 404 ? 'la funzione ownerDomande non esiste sul server (non ancora pubblicata?)' : `errore ${status}`);
  return visibile(msg);
}

/**
 * Cosa ha applicato il server a una risposta, detto a chi l'ha mandata. Senza scelta le parole non applicano niente
 * (SPEC-DOMANDE §3.4): un'azione partita lo stesso è il difetto di #1598, e si dice forte. PURA.
 */
export function esitoRisposta(esito, riferimenti = {}, { conScelta = false } = {}) {
  const e = esito && typeof esito === 'object' ? esito : {};
  if (!e.azione) return { riga: 'risposta a parole, nessuna azione applicata', avviso: '' };
  const azione = D.etichettaAzione(e.azione, riferimenti) || `l'azione «${visibile(e.azione.tipo || '?')}»`;
  if (e.ok === false) return { riga: `non applicata: ${azione}${e.errore ? ` (${visibile(e.errore)})` : ''}`, avviso: '' };
  // «Riprendi» rimette in coda solo un lavoro fermo (#1482): sugli altri la decisione si accoda e lo stato non cambia.
  if (e.accodata) {
    const num = riferimenti?.[e.azione.feedbackId]?.num || 'il lavoro';
    const stato = typeof e.statoLavoro === 'string' && e.statoLavoro ? `: è ${visibile(e.statoLavoro)}` : '';
    return { riga: `accodata: ${azione} (${visibile(num)} non era fermo${stato}, la decisione resta accodata per il giro dopo)`, avviso: '' };
  }
  const avviso = conScelta ? ''
    : `ATTENZIONE: non hai scelto un'opzione, eppure il server ha applicato ${azione}. Le parole da sole non dovrebbero applicare niente: segnalalo.`;
  return { riga: `applicata: ${azione}`, avviso };
}

function dataOra(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '?';
}
const inSmistamento = (r) => (r && (r.stato === 'in_smistamento' || r.domanda?.stato === 'in_smistamento') ? ': prima di arrivare all\'owner la smista un agente' : '');
const rientro = (s, pre = '  ') => pre + visibile(s).replace(/\n/g, `\n${pre}`);
const fiduciaDetta = (f) => (f === 'fidato' ? 'fidata' : 'non fidata');

/** La domanda intera per il terminale: ogni testo d'agente coi caratteri di controllo resi visibili. PURA. */
export function formattaDomanda(d, riferimenti = {}, { quando = dataOra } = {}) {
  const x = d || {};
  const righe = [`${visibile(x.id || '?')} · ${visibile(x.priorita || '?')} · ${visibile(x.stato || '?')} · ${fiduciaDetta(x.fiducia)}`];
  righe.push(visibile(x.titolo || '(senza titolo)'));
  righe.push(`creata il ${quando(x.creataIl)} · modificata il ${quando(x.modificataIl)}${x.gruppo ? ` · gruppo «${visibile(x.gruppo)}»` : ''}`);
  if (x.origine && x.origine.tipo) righe.push(`origine: ${visibile(x.origine.tipo)} ${visibile(x.origine.id || '')}`.trimEnd());
  if (x.stato === 'in_smistamento') righe.push('la sta smistando un agente: arriva all\'owner riscritta, o si chiude da sola se è un guasto o se un principio la copre');
  if (x.smistamento === 'fallito') righe.push('non riscritta: il compito che la smista non ci è riuscito, ed è uscita come l\'aveva scritta chi chiedeva');
  if (x.legata) righe.push(`${x.blocca ? 'ferma' : 'non ferma'} il lavoro di ${visibile(riferimenti?.[x.legata]?.num || x.legata)}`);
  if (Array.isArray(x.collegamenti) && x.collegamenti.length) {
    righe.push(`collegamenti: ${x.collegamenti.map((c) => `${visibile(c.tipo)} ${visibile(c.id)}`).join(', ')}`);
  }
  if (x.contesto) righe.push('', 'Contesto', rientro(x.contesto));
  if (x.problema) righe.push('', 'Problema', rientro(x.problema));
  const opzioni = Array.isArray(x.opzioni) ? x.opzioni : [];
  if (opzioni.length) {
    righe.push('', 'Opzioni');
    opzioni.forEach((o, i) => {
      const etichetta = D.etichettaAzione(o.azione, riferimenti);
      const segni = [etichetta ? `pulsante: ${etichetta}` : 'nessun pulsante: azione non applicabile'];
      if (soloDaFilo(o.azione)) segni.push('solo dalla finestra di Filo');
      if (x.consiglio && x.consiglio.opzione === i) segni.push('consigliata');
      righe.push(`  ${i + 1}. ${visibile(o.testo)}  [${segni.join(' · ')}]`);
      if (o.pro) righe.push(rientro(`Pro: ${o.pro}`, '     '));
      if (o.contro) righe.push(rientro(`Contro: ${o.contro}`, '     '));
    });
  }
  if (x.consiglio && Number.isInteger(x.consiglio.opzione)) {
    righe.push('', `Consiglio: opzione ${x.consiglio.opzione + 1}`, rientro(x.consiglio.perche || ''));
  }
  const turni = Array.isArray(x.conversazione) ? x.conversazione : [];
  if (turni.length) {
    righe.push('', 'Conversazione');
    for (const t of turni) {
      const a = t.autore || {};
      const chi = `${visibile(a.tipo || '?')}${a.ruolo ? ` ${visibile(a.ruolo)}` : ''} (${fiduciaDetta(a.fiducia)})`;
      const scelta = Number.isInteger(t.scelta) ? `, opzione ${t.scelta + 1}${t.consiglio ? ' (il consiglio)' : ''}` : '';
      righe.push(`  ${quando(t.ora)} ${chi} · ${visibile(t.tipo || '')}${scelta}`);
      if (t.testo) righe.push(rientro(t.testo, '    '));
    }
  }
  if (x.esito && typeof x.esito === 'object') {
    const e = x.esito;
    const cosa = e.azione ? (D.etichettaAzione(e.azione, riferimenti) || visibile(e.azione.tipo || '')) : 'risposta a parole';
    righe.push('', `Esito: ${cosa} · ${e.ok ? 'applicato' : `non applicato${e.errore ? ` (${visibile(e.errore)})` : ''}`}`
      + `${e.compito ? ` · compito ${visibile(e.compito.stato || '')}` : ''}`
      + `${e.automatica ? ' · risposta automatica' : ''}${e.smistata ? ` · smistata: ${visibile(e.smistata)}` : ''}`);
  }
  if (x.principio) righe.push('', 'Principio', rientro(x.principio));
  if (x.notePerAgenti) righe.push('', 'Note per gli agenti', rientro(x.notePerAgenti));
  if (x.stato === 'aperta') {
    righe.push('', `Per rispondere: node scripts/domanda.mjs rispondi ${visibile(x.id || 'D-n')} --scelta N [--testo "…"] | --testo "…"`
      + ' (senza --scelta solo parole: nessuna azione)');
  }
  return righe.join('\n');
}

/** Il registro delle decisioni (§3.6) per il terminale: un principio per domanda chiusa. PURA. */
export function formattaRegistro(r, { titolo = 'Registro delle decisioni', vuoto = 'nessun principio ancora' } = {}) {
  const x = r || {};
  const voci = Array.isArray(x.voci) ? x.voci : [];
  const righe = [`${titolo} (${voci.length}${x.altre ? `, e altre ${x.altre} più vecchie` : ''})`];
  for (const v of voci) {
    // Un principio che l'owner ha contestato riaprendo una risposta automatica non si riusa finché non risponde.
    const segni = [v.contestato || v.principioContestato ? 'contestato: non riusarlo' : '', v.fiducia && v.fiducia !== 'fidato' ? 'non fidato' : ''].filter(Boolean);
    righe.push(`  ${visibile(v.id)} ${visibile(v.titolo || '')}${segni.length ? `  [${segni.join(' · ')}]` : ''}`, rientro(v.principio || '', '    '));
  }
  if (x.assente) righe.push(`  ${visibile(x.assente)}`);
  else if (!voci.length) righe.push(`  ${vuoto}`);
  if (x.nonFidateTolte) righe.push(`  (${x.nonFidateTolte} di domande non fidate non ti arrivano: il tuo biglietto è pulito)`);
  if (x.errore) righe.push(`  ${visibile(x.errore)}`);
  return righe.join('\n');
}

/** Il fascicolo del compito per il terminale: la domanda, poi il registro delle decisioni. PURA. */
export function formattaFascicolo(f) {
  const x = f || {};
  if (x.affidata === false) {
    return `La risposta non è più affidata a te${x.motivo ? ` (${visibile(x.motivo)})` : ''}: non c'è niente da fare, rilascia il biglietto.`;
  }
  return [formattaDomanda(x.domanda, x.riferimenti), '', formattaRegistro(x.registro)].join('\n');
}

/** Il feedback da cui viene la domanda, per il compito che la smista: testi d'agente e d'utente resi visibili. PURA. */
export function formattaFeedbackOrigine(fb, { quando = dataOra } = {}) {
  const x = fb || {};
  if (!x.num && !x.id) return 'Feedback d\'origine: nessuno (la domanda non viene da un lavoro).';
  const righe = [`Feedback d'origine: ${visibile(x.num || x.id)} · ${visibile(x.stato || '?')}${x.motivo ? ` (${visibile(x.motivo)})` : ''}${Number.isInteger(x.priorita) ? ` · priorità ${x.priorita}` : ''}`];
  if (x.nome) righe.push(rientro(`Titolo: ${x.nome}`));
  if (x.testo) righe.push('  Testo:', rientro(x.testo, '    '));
  if (x.note) righe.push('  Note:', rientro(x.note, '    '));
  const turni = Array.isArray(x.conversazione) ? x.conversazione : [];
  if (turni.length) {
    righe.push('  Conversazione:');
    for (const t of turni) {
      righe.push(`    ${quando(t.ora)} ${visibile(t.chi || t.autore?.tipo || '?')}`);
      if (t.testo) righe.push(rientro(t.testo, '      '));
    }
  }
  return righe.join('\n');
}

/** Il fascicolo del compito «Gestisci la domanda»: la domanda, il feedback d'origine, il registro. PURA. */
export function formattaFascicoloSmistamento(f) {
  const x = f || {};
  if (x.affidata === false) {
    return `La domanda non è più affidata a te${x.motivo ? ` (${visibile(x.motivo)})` : ''}: non c'è niente da fare, rilascia il biglietto.`;
  }
  return [formattaDomanda(x.domanda, x.riferimenti), '', formattaFeedbackOrigine(x.feedback), '', formattaRegistro(x.registro)].join('\n');
}

/** Cosa stampa un'operazione dello smistamento andata a buon fine. PURA. */
export function testoDelloSmistamento(op, reply = {}) {
  const r = reply || {};
  const fine = ' Hai finito: rilascia il biglietto.';
  if (op === 'guasto') {
    const difetto = r.difetto ? `${visibile(r.difetto)} ${r.riusato ? '(riusato)' : '(aperto ora)'}` : 'il feedback del difetto';
    const fermo = r.fermo ? `${visibile(r.fermo)} lo aspetta e riparte da solo quando si fonde` : 'nessun lavoro fermo da far aspettare';
    return `OK: guasto smistato, ${difetto}; ${fermo}. La domanda è chiusa e all'owner non arriva.${fine}`;
  }
  if (op === 'ricevuti') return `OK: ${r.fermo ? visibile(r.fermo) : 'il lavoro'} va nei Ricevuti con la richiesta per l'owner; la domanda è chiusa.${fine}`;
  if (op === 'automatica') {
    const azione = r.etichetta ? `, applicata: ${visibile(r.etichetta)}` : '';
    return `OK: risposta automatica col principio di ${visibile(r.principio || '?')}${azione}. L'owner la vede fra le risposte automatiche e può riaprirla.${fine}`;
  }
  if (op === 'pubblica') return `OK: ${visibile(r.id || 'la domanda')} è aperta all'owner, riscritta; il testo di chi l'aveva chiesta resta nelle note per gli agenti.${fine}`;
  return 'OK.';
}

/** Cosa stampa un'operazione del compito andata a buon fine. PURA. */
export function testoDelCompito(cmd, reply = {}) {
  if (cmd === 'chiarimento') return 'OK: chiarimento scritto, la domanda torna all\'owner. Hai finito: rilascia il biglietto.';
  if (cmd === 'chiudi') return 'OK: risposta gestita, la domanda è chiusa. Hai finito: rilascia il biglietto.';
  if (cmd === 'note') return 'OK: note per gli agenti scritte.';
  if (cmd === 'principio') return 'OK: principio scritto.';
  const dove = reply.accodata ? ' (il lavoro era già in coda o in mano a qualcuno: la prende il prossimo giro)' : reply.rimandata ? ' (il lavoro torna in verifica)' : '';
  return `OK: ${visibile(reply.azione || 'azione')} applicata${dove}. Quando hai finito, chiudi o chiedi un chiarimento.`;
}

/** I numeri delle schede (§3.5, §3.6): dal server se li manda, altrimenti contati sull'elenco ricevuto. PURA. */
export function conteggiDi(domande, dalServer) {
  const nomi = ['da_rispondere', 'in_smistamento', 'in_lavorazione', 'risposte_automatiche', 'non_riscritte'];
  const c = dalServer && typeof dalServer === 'object' ? dalServer : null;
  if (c && nomi.every((k) => c[k] == null || Number.isInteger(c[k]))) return Object.fromEntries(nomi.map((k) => [k, Number.isInteger(c[k]) ? c[k] : null]));
  const lista = Array.isArray(domande) ? domande.filter((d) => d && typeof d === 'object') : [];
  const conta = (f) => lista.filter(f).length;
  return {
    da_rispondere: conta((d) => d.stato === 'aperta'),
    in_smistamento: conta((d) => d.stato === 'in_smistamento'),
    in_lavorazione: conta((d) => d.stato === 'in_lavorazione'),
    // Le automatiche sono chiuse: senza --tutte l'elenco non le porta, e il numero non si sa.
    risposte_automatiche: lista.some((d) => d.stato === 'chiusa' || d.stato === 'superata') ? conta((d) => D.schedaDi(d) === 'risposte_automatiche') : null,
    non_riscritte: conta((d) => d.smistamento === 'fallito'),
  };
}

/** I conteggi in una riga. PURA. */
export function formattaConteggi(c) {
  const x = c || {};
  const voce = (n, nome) => `${Number.isInteger(n) ? n : '?'} ${nome}`;
  const pezzi = [voce(x.da_rispondere, 'da rispondere'), voce(x.in_smistamento, 'in smistamento'), voce(x.in_lavorazione, 'in lavorazione'),
    voce(x.risposte_automatiche, 'risposte automatiche')];
  if (x.non_riscritte) pezzi.push(`${x.non_riscritte} non riscritte (il compito non ci è riuscito: escono come le aveva scritte chi chiedeva)`);
  return pezzi.join(' · ');
}

/** L'elenco nell'ordine della §3.7, a blocchi. PURA. */
export function formattaElenco(domande) {
  const blocchi = D.raggruppa(domande);
  if (!blocchi.length) return 'Nessuna domanda.';
  const out = [];
  let prima = '';
  for (const b of blocchi) {
    if (b.priorita !== prima) { out.push(`${out.length ? '\n' : ''}${b.priorita || 'priorità ignota'}`); prima = b.priorita; }
    if (b.gruppo) out.push(`  gruppo «${visibile(b.gruppo)}»`);
    for (const d of b.domande) {
      const segni = [visibile(d.stato || '?'), fiduciaDetta(d.fiducia)];
      if (d.smistamento === 'fallito') segni.push('non riscritta');
      if (D.schedaDi(d) === 'risposte_automatiche') segni.push('automatica');
      out.push(`${b.gruppo ? '    ' : '  '}${visibile(d.id || '?')}  ${visibile(d.titolo || '')}  [${segni.join(' · ')}]`);
    }
  }
  return out.join('\n');
}

export async function chiamaOwner(data) {
  const { findAdminRefreshToken, mintIdToken } = await import('./lib/firestore-auth.mjs');
  const refresh = findAdminRefreshToken();
  if (!refresh) throw new Error('Non trovo le credenziali del proprietario (FILO_ADMIN_REFRESH_TOKEN): mostra, elenco, rispondi e consiglio le vogliono.');
  const idToken = await mintIdToken(refresh);
  const res = await fetch(INDIRIZZO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.result && body.result.ok === false)) throw new Error(`Non riuscito: ${messaggioErrore(res.status, body)}`);
  return body.result || {};
}

async function bigliettoDelGiro() {
  const { readTicket } = await import('./lib/routine-ticket.mjs');
  const { pinnedRepoRoot } = await import('./lib/tools-pin.mjs');
  const root = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : (pinnedRepoRoot() || resolve(HERE, '..'));
  return readTicket(root);
}

async function consegnaDomanda(biglietto, domanda) {
  const { deliver } = await import('./routine-channel.mjs');
  return deliver(biglietto, 'domanda', { domanda });
}

async function consegnaRisposta(biglietto, data) {
  const { deliver } = await import('./routine-channel.mjs');
  return deliver(biglietto, 'risposta', data);
}

async function consegnaSmistamento(biglietto, data) {
  const { deliver } = await import('./routine-channel.mjs');
  return deliver(biglietto, 'smistamento', data);
}

// Il registro è testo di altre domande, riservato (§5.1): col biglietto lo dà il server solo a chi può leggerlo.
async function consegnaRegistro(biglietto, data) {
  const { deliver } = await import('./routine-channel.mjs');
  return deliver(biglietto, 'registro', data);
}

/** Il segreto del biglietto della sessione (il più sporco se più d'uno), '' senza: il server allora la fa non fidata. */
async function segretoLocale() {
  const { trovaBiglietto } = await import('./lib/biglietto-locale.mjs');
  const b = await trovaBiglietto().catch(() => null);
  return b && typeof b.ticket === 'string' ? b.ticket : '';
}

async function sporcaSessione(cosa, motivi) {
  const { rigaSporco } = await import('./lib/biglietto-locale.mjs');
  return rigaSporco(cosa, motivi);
}

/** Gli id delle domande il cui testo non è fidato (fiducia assente compresa). PURA. */
export function nonFidate(domande) {
  return (Array.isArray(domande) ? domande : []).filter((d) => d && d.fiducia !== 'fidato').map((d) => String(d.id || '?'));
}

/** Il motivo per cui chi stampa queste domande si sporca, entro i 300 caratteri del server. PURA. */
export function motivoNonFidate(ids) {
  const primi = ids.slice(0, 10).map((x) => visibile(x).slice(0, 20));
  return `${ids.length === 1 ? 'testo di una domanda non fidata' : `testo di ${ids.length} domande non fidate`} (${primi.join(', ')}${ids.length > primi.length ? ', …' : ''})`;
}

async function leggiStdin() {
  if (process.stdin.isTTY) return '';
  const pezzi = [];
  for await (const p of process.stdin) pezzi.push(p);
  return Buffer.concat(pezzi).toString('utf8');
}

/**
 * Il comando intero, con l'I/O iniettabile per le prove. @returns {Promise<number>} il codice d'uscita
 * (0 fatto, 1 rifiutato prima di chiamare o dal server, 3 canale delle routine giù).
 */
export async function esegui(argv, io = {}) {
  const {
    chiama = chiamaOwner, consegna = consegnaDomanda, risposta = consegnaRisposta, smistamento = consegnaSmistamento,
    registroCanale = consegnaRegistro, biglietto = bigliettoDelGiro,
    bigliettoLocale = segretoLocale, sporca = sporcaSessione,
    leggiFile = (p) => readFileSync(p, 'utf8'), stdin = leggiStdin,
    scrivi = (s) => console.log(s), errore = (s) => console.error(s),
  } = io;
  if (argv.some((x) => x === '--help' || x === '-h')) { scrivi(USO); return 0; }
  const a = leggiArgomenti(argv);
  if (a.errore) { errore(`RIFIUTATO: ${a.errore}`); return 1; }
  try {
    if (a.cmd === 'chiedi') {
      let testo;
      try { testo = a.file === '-' ? await stdin() : leggiFile(a.file); } catch (e) {
        errore(`RIFIUTATO: non leggo ${visibile(a.file)} (${visibile(e?.code || e?.message || e)}). Non ho mandato niente.`); return 1;
      }
      const t = await biglietto();
      const letta = leggiDomandaJson(testo, { conOrigine: !t });
      if (letta.errore) { errore(`RIFIUTATO: ${letta.errore}`); return 1; }
      if (t) {
        const r = await consegna(t, letta.domanda);
        if (r.outcome === 'ok') { scrivi(`OK: domanda ${visibile(r.num || r.id || '')} aperta${inSmistamento(r.reply)}.`); return 0; }
        if (r.outcome === 'refused') { errore(`RIFIUTATO dal server: ${visibile(r.reason)}${r.detail ? `: ${visibile(r.detail)}` : ''}`); return 1; }
        errore(`guasto del canale delle routine (${visibile(r.reason)}): la domanda non è partita.`); return 3;
      }
      const segreto = await bigliettoLocale();
      const r = await chiama(Object.assign({ op: 'chiedi', domanda: letta.domanda }, segreto ? { biglietto: segreto } : {}));
      scrivi(`OK: domanda ${visibile(r.id || '')} aperta (${fiduciaDetta(r.fiducia)})${inSmistamento(r)}.`);
      return 0;
    }
    // Il compito che gestisce una risposta (#1152): la domanda la dice il biglietto, e il server lo sporca se serve.
    if (a.delCompito || DEL_COMPITO.includes(a.cmd)) {
      const t = await biglietto();
      if (!t) {
        errore(`RIFIUTATO: ${a.delCompito ? '«mostra» senza domanda' : `«${a.cmd}»`} vale col biglietto del compito che gestisce una risposta, e qui non ce n'è uno. Fuori da quel compito: mostra D-n, rispondi D-n.`);
        return 1;
      }
      const data = { op: a.delCompito ? 'mostra' : a.cmd };
      if (a.testo !== undefined) data.testo = a.testo === '-' ? await stdin() : a.testo;
      if (a.principio !== undefined) data.principio = a.principio;
      if (a.azione) data.azione = a.azione;
      if (TESTO_SERVE.includes(a.cmd) && !String(data.testo || '').trim()) { errore(`RIFIUTATO: ${a.cmd} vuole un testo che non sia vuoto. Non ho mandato niente.`); return 1; }
      const r = await risposta(t, data);
      if (r.outcome === 'ok') { scrivi(a.delCompito ? formattaFascicolo(r.reply) : testoDelCompito(a.cmd, r.reply || {})); return 0; }
      if (r.outcome === 'refused') { errore(`RIFIUTATO dal server: ${visibile(r.reason)}${r.detail ? `: ${visibile(r.detail)}` : ''}`); return 1; }
      errore(`guasto del canale delle routine (${visibile(r.reason)}): non è arrivato niente.`); return 3;
    }
    // Il compito che smista una domanda appena nata (#1790): come quello della risposta, la domanda la dice il biglietto.
    if (a.cmd === 'smista') {
      const t = await biglietto();
      if (!t) {
        errore('RIFIUTATO: «smista» vale col biglietto del compito che gestisce una domanda appena nata, e qui non ce n\'è uno.');
        return 1;
      }
      const data = { op: a.op };
      if (a.op === 'pubblica') {
        let testo;
        try { testo = a.file === '-' ? await stdin() : leggiFile(a.file); } catch (e) {
          errore(`RIFIUTATO: non leggo ${visibile(a.file)} (${visibile(e?.code || e?.message || e)}). Non ho mandato niente.`); return 1;
        }
        const letta = leggiDomandaJson(testo, { conOrigine: false, formaOwner: true });
        if (letta.errore) { errore(`RIFIUTATO: ${letta.errore}`); return 1; }
        data.domanda = letta.domanda;
        // Su una domanda che non ferma, l'opzione riscritta che il lavoro ha già fatto (#1790 r2): la validazione la ignora.
        const p = JSON.parse(testo).provvisoria;
        if (p !== undefined) {
          if (!Number.isInteger(p) || p < 0 || p >= letta.domanda.opzioni.length) {
            errore(`RIFIUTATO: «provvisoria» è l'indice (da 0 a ${letta.domanda.opzioni.length - 1}) dell'opzione che il lavoro ha già fatto. Non ho mandato niente.`); return 1;
          }
          data.provvisoria = p;
        }
      }
      for (const k of ['chiave', 'titolo', 'resoconto', 'richiesta', 'scelta', 'principio']) if (a[k] !== undefined) data[k] = a[k];
      if (a.testo !== undefined) data.testo = a.testo === '-' ? await stdin() : a.testo;
      if (data.testo !== undefined && !String(data.testo).trim()) { errore(`RIFIUTATO: smista ${a.op} vuole un testo che non sia vuoto. Non ho mandato niente.`); return 1; }
      if (typeof data.testo === 'string' && data.testo.length > TETTI_SMISTA.testo) {
        errore(`RIFIUTATO: il testo è lungo ${data.testo.length} caratteri, il massimo è ${TETTI_SMISTA.testo}. Non ho mandato niente.`); return 1;
      }
      const r = await smistamento(t, data);
      if (r.outcome === 'ok') { scrivi(a.op === 'mostra' ? formattaFascicoloSmistamento(r.reply) : testoDelloSmistamento(a.op, r.reply || {})); return 0; }
      if (r.outcome === 'refused') { errore(`RIFIUTATO dal server: ${visibile(r.reason)}${r.detail ? `: ${visibile(r.detail)}` : ''}`); return 1; }
      errore(`guasto del canale delle routine (${visibile(r.reason)}): non è arrivato niente.`); return 3;
    }
    // Il registro (§3.6): col biglietto delle routine passa dal canale, che lo dà solo a chi lo può leggere.
    if (a.cmd === 'registro') {
      const t = await biglietto();
      if (t) {
        const r = await registroCanale(t, { parole: a.parole });
        if (r.outcome === 'ok') { scrivi(formattaRegistro(r.reply, { titolo: `Principi per «${visibile(a.parole)}»`, vuoto: 'nessun principio copre queste parole' })); return 0; }
        if (r.outcome === 'refused') { errore(`RIFIUTATO dal server: ${visibile(r.reason)}${r.detail ? `: ${visibile(r.detail)}` : ''}`); return 1; }
        errore(`guasto del canale delle routine (${visibile(r.reason)}): non è arrivato niente.`); return 3;
      }
      const r = await chiama({ op: 'registro', parole: a.parole });
      const nf = nonFidate(r.voci);
      if (nf.length) errore(await sporca(`registro per «${visibile(a.parole).slice(0, 60)}»`, [motivoNonFidate(nf)]));
      scrivi(formattaRegistro(r, { titolo: `Principi per «${visibile(a.parole)}»`, vuoto: 'nessun principio copre queste parole' }));
      return 0;
    }
    // Il testo di una domanda non fidata è testo esterno: la sessione si sporca PRIMA di stamparlo (#1148).
    if (a.cmd === 'mostra') {
      const r = await chiama({ op: 'mostra', id: a.id });
      const nf = nonFidate([r.domanda]);
      if (nf.length) errore(await sporca(`letta ${visibile(a.id)}`, [motivoNonFidate(nf)]));
      scrivi(formattaDomanda(r.domanda, r.riferimenti));
      return 0;
    }
    if (a.cmd === 'elenco') {
      const r = await chiama(a.tutte ? { op: 'elenco', tutte: true } : { op: 'elenco' });
      const nf = nonFidate(r.domande);
      if (nf.length) errore(await sporca('elenco delle domande', [motivoNonFidate(nf)]));
      scrivi(formattaConteggi(conteggiDi(r.domande, r.conteggi)));
      scrivi('');
      scrivi(formattaElenco(r.domande));
      if (r.altre) scrivi(`\nCe ne sono altre oltre le prime ${(r.domande || []).length}: il server non le ha mandate tutte.`);
      return 0;
    }
    // Col token del proprietario il server non distingue una sessione dall'owner: la sessione lo dice, col suo biglietto,
    // e le sue parole prendono la fiducia del biglietto invece di valere come dell'owner.
    const daSessione = async () => {
      const s = await bigliettoLocale();
      return s ? { sessione: true, biglietto: s } : { sessione: true };
    };
    if (a.cmd === 'archivia' || a.cmd === 'riapri') {
      const r = await chiama(Object.assign({ op: a.cmd, id: a.id }, await daSessione()));
      scrivi(`OK: ${a.id} è ${visibile((r.domanda && r.domanda.stato) || '?')}.`);
      return 0;
    }
    if (a.cmd === 'rispondi') {
      if (a.testo === '-') a.testo = await stdin();
      const conTesto = typeof a.testo === 'string' && a.testo.trim() !== '';
      if (a.scelta === undefined && !conTesto) { errore(`RIFIUTATO: il testo per ${a.id} è vuoto e non hai scelto un'opzione. Non ho risposto.`); return 1; }
      let riferimenti = {};
      if (a.scelta !== undefined) {
        const m = await chiama({ op: 'mostra', id: a.id });
        const o = m.domanda && Array.isArray(m.domanda.opzioni) ? m.domanda.opzioni[a.scelta] : null;
        if (!o) { errore(`RIFIUTATO: ${a.id} non ha l'opzione ${a.scelta + 1}. Non ho risposto.`); return 1; }
        if (soloDaFilo(o.azione)) {
          errore(`RIFIUTATO: l'opzione ${a.scelta + 1} di ${a.id} vale solo dalla finestra di Filo (Gestione, Domande): da qui non la applico.`);
          return 1;
        }
        riferimenti = m.riferimenti || {};
      }
      const data = Object.assign({ op: 'rispondi', id: a.id }, await daSessione());
      if (a.scelta !== undefined) data.scelta = a.scelta;
      if (conTesto) data.testo = a.testo;
      const r = await chiama(data);
      const detto = esitoRisposta(r.esito, Object.assign({}, riferimenti, r.riferimenti), { conScelta: a.scelta !== undefined });
      const stato = (r.domanda && r.domanda.stato) || '?';
      scrivi(`OK: ${a.id} è ${visibile(stato)}; ${detto.riga}.`);
      if (stato === 'aperta' && a.scelta === undefined) scrivi(`Le opzioni restano da scegliere: node scripts/domanda.mjs rispondi ${a.id} --scelta N (queste parole arrivano a chi riprende il lavoro).`);
      if (detto.avviso) errore(detto.avviso);
      return 0;
    }
    if (a.cmd === 'consiglio') {
      const daMandare = [];
      let rifiutate = 0;
      for (const id of a.ids) {
        const { domanda } = await chiama({ op: 'mostra', id });
        const c = domanda && domanda.consiglio;
        const o = c && Array.isArray(domanda.opzioni) ? domanda.opzioni[c.opzione] : null;
        if (!o) { errore(`${id}: nessun consiglio da applicare.`); rifiutate++; continue; }
        if (soloDaFilo(o.azione)) { errore(`${id}: il consiglio vale solo dalla finestra di Filo (Gestione, Domande).`); rifiutate++; continue; }
        daMandare.push(id);
      }
      if (!daMandare.length) { errore('RIFIUTATO: nessun consiglio applicabile da qui.'); return 1; }
      const r = await chiama(Object.assign({ op: 'consiglio', ids: daMandare }, await daSessione()));
      for (const e of Array.isArray(r.esiti) ? r.esiti : []) {
        scrivi(`${visibile(e.id)}: ${e.ok ? `fatto${e.etichetta ? `, ${visibile(e.etichetta)}` : ''}` : `non applicato (${visibile(e.errore || '?')})`}`);
      }
      return rifiutate ? 1 : 0;
    }
  } catch (e) {
    errore(visibile(e?.message || e));
    return 1;
  }
  errore(USO);
  return 1;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  // Le ricette dei worker lo nominano (#1241): i comandi che stampa portano alla copia fissata degli strumenti.
  absolutizeOutput(process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : '');
  esegui(process.argv.slice(2)).then((code) => process.exit(code));
}
