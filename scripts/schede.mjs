// Le schede dei feedback aperti per il manutentore (SPEC-RIDISEGNO-LAVORO.md § 2): Haiku le scrive col ruolo scheda.md, Opus
// rilegge chi toglie lavoro e un campione. Si salvano nel feedback; la cartella fuori dal repo è la copia di lavoro. Due strade
// (#1785): il server col biglietto in una routine, il token dell'owner in locale. Test: tests/unit/schede.test.mjs.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { espandiInclusioni } from './lib/role-text.mjs';
import './lib/freno-letture.mjs';
import '../src/shared/schede.js';
import { RIFIUTI_DEFINITIVI } from './lib/feedback-cloud.mjs';

const SS = globalThis.SN_SCHEDE;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CARTELLA_PREDEFINITA = resolve(ROOT, '..', 'filo-schede');
export const INDICE = 'indice.json';

export const { STATI_CHIUSI, VALIDI, TIPI, AREE, validaScheda } = SS;
export const CAMPI_LETTI = ['seq', 'subSeq', 'status', 'priority', 'updatedAt', 'waitsFor', 'unisce'];
// In più, sulla strada locale: la scheda salvata nel feedback e il giudizio che dice se si può dare (come fa il server).
const CAMPI_SCHEDA = ['scheda', 'schedaAt', 'pipeline'];

const RILETTURA = [
  'RILETTURA. La scheda che trovi nel file l\'ha scritta un modello più piccolo. Rifai i controlli dei passi 1-3 e',
  'correggi i campi sbagliati, con le stesse regole; poi aggiungi alla scheda il campo "riletta" con una riga su cosa',
  'hai cambiato ("confermata" se niente). Riscrivi il file intero, e rispondi con la riga del passo 4.',
].join(' ');

const numeriDi = (lista) => (Array.isArray(lista) ? lista : []).map((w) => String((w && w.num) || '').replace(/^#/, '')).filter(Boolean);

/** Uno stato che non si è decifrato (manca la chiave, o è sbagliata): con lui non si sa chi è aperto. PURA. */
export function statoIllegibile(r) {
  const st = String((r && r.status) || '').trim();
  return st !== '' && !/^[a-z_]+$/.test(st);
}

/**
 * Le righe lette (già decifrate) → i feedback aperti dell'indice, dal numero più basso. `segnalati`: id → il motivo per
 * cui il lettore non lo dà (attacco, file sospetto), che l'indice porta in `segnalato`. PURA.
 */
export function apertiDaRighe(righe, { segnalati = new Map() } = {}) {
  const num = (r) => {
    const s = Number(r.seq); const sub = Number(r.subSeq);
    return Number.isInteger(s) && s > 0 ? (Number.isInteger(sub) && sub > 0 ? `${s}.${sub}` : String(s)) : '';
  };
  return (Array.isArray(righe) ? righe : [])
    .map((r) => ({
      id: String(r._id || ''), num: num(r), stato: String(r.status || '').trim(),
      // Il server dà null per una priorità mai scritta, la strada locale non dà il campo: tutte e due «senza», non 0.
      priorita: r.priority !== null && r.priority !== undefined && String(r.priority).trim() !== '' && Number.isInteger(Number(r.priority)) ? Number(r.priority) : null,
      aggiornato: String(r.updatedAt || r._updateTime || ''),
      attese: numeriDi(r.waitsFor), unisce: numeriDi(r.unisce),
      ...(segnalati.get(String(r._id || '')) ? { segnalato: String(segnalati.get(String(r._id || ''))) } : {}),
    }))
    .filter((f) => f.id && f.num && f.stato && !STATI_CHIUSI.includes(f.stato))
    .sort((a, b) => Number(a.num) - Number(b.num));
}

/** La scheda va (ri)scritta? Manca, non è buona o non ha la stessa fonte del feedback di adesso. PURA. */
export function daScrivere(f, scheda) {
  if (!scheda || validaScheda(scheda, f.num).length) return true;
  const fonte = scheda._fonte || {};
  return fonte.id !== f.id || fonte.stato !== f.stato || fonte.aggiornato !== f.aggiornato;
}

/** Cosa non va nella scheda dopo il giro di un agente: non riscritta, non buona, o una rilettura senza «riletta». PURA. */
export function difettiDopoAgente({ riscritta, scheda, num, rilettura = false }) {
  if (!riscritta) return ['l\'agente non ha riscritto la scheda'];
  return [...validaScheda(scheda, num), ...(rilettura && !String((scheda && scheda.riletta) || '').trim() ? ['manca «riletta»'] : []),
    ...troppoGrande(scheda)];
}

// Quanto il server aggiunge alla scheda salvandola (stato, ore, modello, autore): stimato largo.
const MARGINE_SALVATAGGIO = 1024;

/** Oltre la misura che il server salva la scheda va rifatta qui, non scoperta al salvataggio. PURA. */
export function troppoGrande(scheda) {
  if (!scheda || typeof scheda !== 'object') return [];
  const byte = Buffer.byteLength(JSON.stringify(SS.perIlDocumento(SS.campiDellAgente(scheda))), 'utf8') + MARGINE_SALVATAGGIO;
  return byte > SS.MAX_BYTE ? [`la scheda è di circa ${byte} byte, il server ne salva al più ${SS.MAX_BYTE}: va accorciata`] : [];
}

/** La scheda di un feedback che per regola non si legge: senza agente, col motivo, e non va al server. PURA. */
export function schedaDelSegnalato(f, at = new Date().toISOString()) {
  const motivo = String(f.segnalato || 'segnalato').slice(0, 900);
  return {
    numero: f.num, stato: f.stato, mittente: 'altro', titolo_breve: 'Segnalato, non letto',
    riassunto: `Per regola nessuna sessione lo legge: ${motivo}. Lo decide l'owner dai Ricevuti.`,
    tipo: 'sicurezza', area: 'altro', file_probabili: [], urgente: false, valido: 'non letto', prova: motivo,
    risolto_su_main: null, doppione_di: [], parole_chiave: [], note: '',
    _fonte: { id: f.id, stato: f.stato, aggiornato: f.aggiornato, at, modello: '' }, [SEGNALATA]: true,
  };
}

/** Il campione stabile: lo stesso numero cade sempre dalla stessa parte. PURA. */
export function nelCampione(num, quota) {
  const h = createHash('sha256').update(String(num)).digest().readUInt32BE(0);
  return h / 0x100000000 < quota;
}

/**
 * Le schede da far rileggere a Opus: tutte quelle che tolgono lavoro (non valido, doppione) e un campione delle altre,
 * mai una già riletta sulla stessa fonte. PURA.
 */
export function daRileggere(schede, { quota = 0.1 } = {}) {
  return (Array.isArray(schede) ? schede : []).filter((s) => {
    if (!s || s._riletta || s[SEGNALATA]) return false;
    const toglie = s.valido === 'no' || (Array.isArray(s.doppione_di) && s.doppione_di.length > 0);
    return toglie || nelCampione(String(s.numero || '').replace(/^#/, ''), quota);
  });
}

/** Il testo per l'agente: il ruolo della scheda, e in coda i dati di questo giro. PURA rispetto ai suoi ingressi. */
export function promptScheda(ruolo, { num, cartella, radice, rilettura = false }) {
  return [
    ruolo.trim(), '',
    `Feedback: ${num}`,
    `Cartella delle schede: ${cartella}`,
    `Radice del repo: ${radice}`,
    ...(rilettura ? ['', `${RILETTURA} Il file: ${join(cartella, `${num}.json`)}`] : []),
  ].join('\n');
}

function leggiJson(f) {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return null; }
}
const fileScheda = (cartella, num) => join(cartella, `${num}.json`);

/** Le schede che ci sono nella cartella, lette. */
export function leggiSchede(cartella) {
  if (!existsSync(cartella)) return [];
  return readdirSync(cartella).filter((n) => /^\d+(\.\d+)?\.json$/.test(n)).map((n) => leggiJson(join(cartella, n))).filter(Boolean);
}

/** Riassunto per `stato`. PURA. */
export function riepilogo(indice, schede) {
  const per = (k) => schede.reduce((m, s) => ({ ...m, [s[k] ?? '?']: (m[s[k] ?? '?'] || 0) + 1 }), {});
  const mappa = new Map(schede.map((s) => [String(s.numero || '').replace(/^#/, ''), s]));
  const daFare = (indice || []).filter((f) => daScrivere(f, mappa.get(f.num)));
  return {
    aperti: (indice || []).length, schede: schede.length, daScrivere: daFare.length, daRileggere: daRileggere(schede).length,
    nonSalvate: schede.filter((s) => s && s[NON_SALVATA] === true).length, valido: per('valido'), area: per('area'),
  };
}

// «Centinaia di aperti e nessuna scheda» (#2181): sotto questa soglia di mancanti riscriverle costa poco e può essere un
// inizio vero. Il conto è sulla copertura, non su «almeno una»: una scheda scritta con --solo non è un censimento.
export const SOGLIA_CENSIMENTO = 50;

/**
 * Quante schede vere ha la cartella sugli aperti dell'indice; `scarsa` = mancano tante e coprono meno di metà. È l'unica
 * regola del censimento mancante: la usano l'avviso di elenca e il fermo di stato e scrivi. PURA.
 */
export function copertura({ indice, schede }) {
  const nums = new Set((indice || []).filter((f) => f && !f.segnalato).map((f) => String(f.num)));
  const coperti = new Set((schede || []).filter((s) => s && !s[SEGNALATA]).map((s) => String(s.numero || '').replace(/^#/, '')).filter((n) => nums.has(n)));
  const aperti = nums.size;
  const vere = coperti.size;
  return { aperti, vere, mancano: aperti - vere, scarsa: aperti - vere >= SOGLIA_CENSIMENTO && vere * 2 < aperti };
}

const quanteSchede = (vere) => (vere ? `solo ${vere} ${vere === 1 ? 'scheda' : 'schede'}` : 'nessuna scheda');

/**
 * In una routine, una cartella con poche schede su tanti aperti vuol dire censimento che non sta nei feedback, non
 * schede da riscrivere: Haiku le rifarebbe tutte alla cieca. → '' se si può andare avanti, altrimenti il motivo. PURA.
 */
export function censimentoMancante({ via, indice, schede }) {
  if (via !== 'cloud') return '';
  const c = copertura({ indice, schede });
  if (!c.scarsa) return '';
  return [
    `FERMO: la lettura dal server ha portato ${quanteSchede(c.vere)} su ${c.aperti} feedback aperti: il censimento non sta nei feedback`,
    '(se elenca ne ha contate di illeggibili, è la lettura a non andare).',
    'Il censimento si porta nei feedback dalla macchina dell\'owner (elenca, poi scrivi: le schede della sua cartella si salvano senza agente);',
    `riscriverle tutte da qui (${c.mancano} agenti) si fa solo deciso, con --da-zero. Intanto si decide sui titoli, e lo si dice nel recap;`,
    'una scheda sola si scrive con scrivi --solo N.',
  ].join(' ');
}

/**
 * Le schede della cartella buone e fresche che il feedback non ha (il censimento della fase 0, o un salvataggio perso):
 * si segnano da mandare, e il prossimo `scrivi` le salva senza agente. `salvate`: i numeri che la lettura ha portato con
 * la scheda. → quante segnate.
 */
export function segnaNonSalvate(cartella, indice, salvate) {
  const perNum = new Map((indice || []).filter((f) => f && !f.segnalato).map((f) => [f.num, f]));
  let segnate = 0;
  for (const s of leggiSchede(cartella)) {
    const num = String(s.numero || '').replace(/^#/, '');
    const f = perNum.get(num);
    if (!f || salvate.has(num) || s[NON_SALVATA] || s[RIFIUTATA] || s[SEGNALATA] || daScrivere(f, s)) continue;
    writeFileSync(fileScheda(cartella, num), `${JSON.stringify({ ...s, [NON_SALVATA]: true }, null, 1)}\n`);
    segnate += 1;
  }
  return segnate;
}

/** Lancia gli agenti al più `paralleli` alla volta; `lavora(voce)` → esito. */
export async function aGruppi(voci, paralleli, lavora) {
  const esiti = new Array(voci.length);
  let prossimo = 0;
  const operaio = async () => {
    while (prossimo < voci.length) {
      const i = prossimo; prossimo += 1;
      // eslint-disable-next-line no-await-in-loop
      esiti[i] = await lavora(voci[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(paralleli, voci.length)) }, operaio));
  return esiti;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function opzione(argv, nome) {
  const i = argv.findIndex((a) => a === nome || a.startsWith(`${nome}=`));
  if (i < 0) return undefined;
  return argv[i].includes('=') ? argv[i].slice(nome.length + 1) : argv[i + 1];
}

/**
 * Le schede salvate nei feedback, dalle righe della strada locale (già decifrate, `scheda` ancora cifrata): solo dei
 * feedback aperti e leggibili, come le dà il server. `apri(v)` → l'oggetto in chiaro o null; `vietato(stato, giudizio)`
 * è la regola del lettore. → [scheda nella forma dei file]
 */
export async function schedeDaRighe(righe, { apri, vietato, illeggibili = [] }) {
  const out = [];
  for (const r of Array.isArray(righe) ? righe : []) {
    const stato = String(r.status || '').trim();
    if (!r.scheda || !r._id || STATI_CHIUSI.includes(stato) || vietato(stato, r.pipeline)) continue;
    const s = SS.dalDocumento(await apri(r.scheda), { id: String(r._id), aggiornato: String(r.schedaAt || '') });
    if (s) out.push(s);
    else illeggibili.push(String(r._id));
  }
  return out;
}

/**
 * Le schede del feedback nella cartella: una manca, non è buona o è più vecchia di quella salvata (`_fonte.at`) → si
 * scrive quella salvata. Una scritta qui dopo resta. → quante scritte.
 */
export function importaSchede(cartella, schede) {
  let scritte = 0;
  for (const s of schede) {
    const num = String(s.numero || '').replace(/^#/, '');
    if (!/^\d+(\.\d+)?$/.test(num)) continue;
    const qui = leggiJson(fileScheda(cartella, num));
    const piuNuova = qui && !validaScheda(qui, num).length && String((qui._fonte || {}).at || '') > String((s._fonte || {}).at || '');
    if (piuNuova) continue;
    writeFileSync(fileScheda(cartella, num), `${JSON.stringify(s, null, 1)}\n`);
    scritte += 1;
  }
  return scritte;
}

/**
 * Righe e schede dalla strada locale: token e chiave dell'owner. `dip` (le prove): `leggiRighe()` → { rows già decifrate,
 * complete }, `apri(v)` → la scheda in chiaro. → { ok, righe, schede, segnalati, complete }
 */
export async function letturaLocale(dip = {}) {
  const { vietatoLeggere } = await import('./leggi-feedback.mjs');
  let { leggiRighe, apri } = dip;
  if (!leggiRighe || !apri) {
    const { acquireBearer } = await import('./lib/firestore-auth.mjs');
    // La pubblica prima della cifratura, come in claude-feedback.mjs.
    for (const m of ['feedbackThread.js', 'feedbackPublicKey.js', 'feedbackCrypto.js', 'feedback.js']) await import(`../src/shared/${m}`);
    const { decryptFeedbackList, decryptJsonField } = await import('./lib/decrypt-feedback-fields.mjs');
    leggiRighe = leggiRighe || (async () => {
      const r = await globalThis.SN_FEEDBACK.listAllPaged({ idToken: await acquireBearer(), fields: [...CAMPI_LETTI, ...CAMPI_SCHEDA] });
      return { rows: await decryptFeedbackList(r.rows), complete: r.complete };
    });
    apri = apri || ((v) => decryptJsonField(v));
  }
  const r = await leggiRighe();
  const righe = r.rows;
  const illeggibili = [];
  const schede = await schedeDaRighe(righe, { apri, vietato: vietatoLeggere, illeggibili });
  const segnalati = new Map(righe.map((x) => [String(x._id || ''), vietatoLeggere(String(x.status || '').trim(), x.pipeline)]).filter(([id, m]) => id && m));
  return { ok: true, righe, schede, segnalati, complete: r.complete !== false, illeggibili: illeggibili.length };
}

/** Righe e schede dal server, col biglietto della routine. `opz` passa a leggiDalServer (le prove ci mettono la rete finta). */
export async function letturaCloud(ticket, opz = {}) {
  const { leggiDalServer } = await import('./lib/feedback-cloud.mjs');
  const r = await leggiDalServer(ticket, { numeri: 'aperti', schede: true, testi: false }, opz);
  if (!r.ok) return { ok: false, codice: r.guasto ? 4 : 3, motivo: r.motivo };
  return {
    ok: true, righe: r.voci.filter((v) => v.riga).map((v) => v.riga), schede: r.voci.filter((v) => v.scheda).map((v) => v.scheda),
    segnalati: new Map(r.voci.filter((v) => v.riga && v.rifiutato).map((v) => [String(v.riga._id || v.id || ''), String(v.rifiutato)])), complete: true,
    illeggibili: r.voci.filter((v) => v.schedaIllegibile).length,
  };
}

async function strada() {
  const { stradaDelGiro } = await import('./lib/feedback-cloud.mjs');
  return stradaDelGiro(ROOT);
}

/** `lettura` (le prove): la lettura già scelta, al posto di quella della strada del giro. */
export async function elenca(cartella, dryRun, { lettura = null } = {}) {
  let r;
  if (lettura) r = await lettura();
  else {
    const { via, ticket } = await strada();
    r = via === 'cloud' ? await letturaCloud(ticket) : await letturaLocale();
  }
  if (!r.ok) { console.error(`${r.codice === 4 ? 'GUASTO' : 'RIFIUTATO'}: ${r.motivo}. Indice non scritto.`); return r.codice; }
  const { righe } = r;
  // Un indice sbagliato è peggio di uno vecchio: chi lo legge non lo distingue da uno buono.
  if (r.complete === false) { console.error(`RIFIUTATO: la lettura non è completa (${righe.length} documenti): indice non scritto, rilancia.`); return 1; }
  const illeggibili = righe.filter(statoIllegibile).length;
  if (illeggibili) { console.error(`RIFIUTATO: lo stato di ${illeggibili} feedback su ${righe.length} non si decifra (manca la chiave privata, o è un'altra): senza non so chi è aperto, indice non scritto.`); return 1; }
  const indice = apertiDaRighe(righe, { segnalati: r.segnalati });
  let scritte = 0;
  let segnate = 0;
  if (!dryRun) {
    mkdirSync(cartella, { recursive: true });
    writeFileSync(join(cartella, INDICE), `${JSON.stringify(indice, null, 1)}\n`);
    scritte = importaSchede(cartella, r.schede);
    segnate = segnaNonSalvate(cartella, indice, new Set(r.schede.map((s) => String(s.numero || '').replace(/^#/, ''))));
    scriviSegnalati(cartella, indice);
  }
  const nonSiAprono = r.illeggibili ? `, ${r.illeggibili} illeggibili (da riscrivere)` : '';
  const mandare = segnate ? `; ${segnate} schede della cartella mancano nel feedback: scrivi le salva senza agente` : '';
  const salvate = `${r.schede.length} schede salvate nei feedback${nonSiAprono}${dryRun ? '' : `, ${scritte} copiate nella cartella`}${mandare}`;
  console.log(`${indice.length} feedback aperti su ${righe.length} letti${dryRun ? ' (prova a vuoto: indice non scritto)' : `: indice in ${join(cartella, INDICE)}`}; ${salvate}.`);
  const c = copertura({ indice, schede: r.schede });
  if (c.scarsa) {
    const chi = c.vere ? `Solo ${c.vere} dei ${c.aperti} aperti ${c.vere === 1 ? 'ha' : 'hanno'}` : `Nessuno dei ${c.aperti} aperti ha`;
    const perche = r.illeggibili ? `, e ${r.illeggibili} non si leggono: è la lettura a non andare` : ': la lettura è andata, sono i feedback a non averne';
    console.log(`${chi} una scheda salvata nel feedback${perche}. In una routine stato e scrivi si fermano.`);
  }
  return 0;
}

/** La scheda nel feedback, sulla strada del giro. → { ok, scheda?, aggiornato? } | { ok:false, motivo } */
async function salvaNelFeedback(dati, { via, ticket }) {
  const { salvaSchedaDalServer, salvaSchedaDaOwner } = await import('./lib/feedback-cloud.mjs');
  try {
    return await (via === 'cloud' ? salvaSchedaDalServer(ticket, dati) : salvaSchedaDaOwner(dati));
  } catch (e) {
    return { ok: false, guasto: true, motivo: String((e && e.message) || e).slice(0, 200) };
  }
}

/** L'indice col nuovo aggiornamento dei feedback appena toccati dalle schede: senza, le si darebbe per vecchie. PURA. */
export function indiceAggiornato(indice, aggiornati) {
  return (indice || []).map((f) => (aggiornati.has(f.num) ? { ...f, aggiornato: aggiornati.get(f.num) } : f));
}

// Il segno di una scheda della cartella che il feedback non ha: fresca per l'agente, ma da mandare al prossimo giro.
export const NON_SALVATA = '_nonSalvata';
// Il server l'ha rifiutata per un motivo che rimandarla non cambia: resta nella cartella finché il feedback non cambia.
export const RIFIUTATA = '_rifiutata';
// La scheda di un segnalato, scritta senza agente: il server per regola non la salva, quindi non gli si manda.
export const SEGNALATA = '_segnalata';

/**
 * Cosa resta nella cartella dopo il salvataggio: la scheda del feedback; quella dell'agente col motivo del no, se il no
 * è definitivo; altrimenti col segno da rimandare. PURA.
 */
export function schedaDopoSalvataggio(stampata, salvata) {
  if (salvata && salvata.ok && salvata.scheda) return salvata.scheda;
  const { [NON_SALVATA]: _n, [RIFIUTATA]: _r, ...base } = stampata;
  if (salvata && !salvata.guasto && RIFIUTI_DEFINITIVI.includes(salvata.reason)) return { ...base, [RIFIUTATA]: String(salvata.motivo || salvata.reason) };
  return { ...base, [NON_SALVATA]: true };
}

/** Scrive senza agente la scheda dei segnalati dell'indice che non ne hanno una fresca. → quante scritte. */
export function scriviSegnalati(cartella, indice) {
  let scritte = 0;
  for (const f of indice || []) {
    if (!f || !f.segnalato || !f.num) continue;
    const qui = leggiJson(fileScheda(cartella, f.num));
    if (qui && qui[SEGNALATA] && !daScrivere(f, qui)) continue;
    writeFileSync(fileScheda(cartella, f.num), `${JSON.stringify(schedaDelSegnalato(f), null, 1)}\n`);
    scritte += 1;
  }
  return scritte;
}

/**
 * Manda al feedback le schede della cartella rimaste fuori (segnate NON_SALVATA) e ancora fresche: senza agente, solo il
 * salvataggio. Quelle vecchie le riscrive l'agente. `salva(dati)` → come salvaNelFeedback. → { mandate, restano, aggiornati }
 */
export async function rimandaNonSalvate(cartella, indice, { salva }) {
  const perNum = new Map((indice || []).map((f) => [f.num, f]));
  const aggiornati = new Map();
  let mandate = 0;
  let restano = 0;
  let rifiutate = 0;
  for (const s of leggiSchede(cartella)) {
    if (!s || s[NON_SALVATA] !== true) continue;
    const num = String(s.numero || '').replace(/^#/, '');
    const f = perNum.get(num);
    if (!f || daScrivere(f, s)) continue;
    const modello = String(((s._riletta || s._fonte) || {}).modello || '');
    const salvata = await salva({ numero: num, scheda: SS.campiDellAgente(s), rilettura: Boolean(s._riletta), modello });
    const daTenere = schedaDopoSalvataggio(s, salvata);
    writeFileSync(fileScheda(cartella, num), `${JSON.stringify(daTenere, null, 1)}\n`);
    if (daTenere[RIFIUTATA]) {
      rifiutate += 1;
      console.error(`#${num}: il server non salva la scheda (${daTenere[RIFIUTATA]}): resta solo nella cartella.`);
    } else if (daTenere[NON_SALVATA]) {
      restano += 1;
      console.error(`#${num}: scheda ancora fuori dal feedback (${(salvata && salvata.motivo) || 'risposta vuota'}).`);
    } else {
      if (salvata.aggiornato) aggiornati.set(num, salvata.aggiornato);
      mandate += 1;
    }
  }
  return { mandate, restano, rifiutate, aggiornati };
}

async function lanciaAgenti(voci, { cartella, modello, paralleli, rilettura, dryRun }) {
  if (!voci.length) { console.log('Niente da fare.'); return 0; }
  if (dryRun) { console.log(`(prova a vuoto) ${voci.length} agenti ${modello}, ${paralleli} alla volta: ${voci.map((v) => `#${v.num}`).join(', ')}`); return 0; }
  const { trovaClaude, argomentiClaude, leggiUscitaClaude, envFiglio, accessoDaStatus, SENZA_ACCESSO, esegui } = await import('./orchestratore-locale.mjs');
  const bin = trovaClaude();
  if (!bin) { console.error('Non trovo Claude Code da riga di comando (FILO_CLAUDE_BIN, o `claude` nel PATH). Non ho lanciato niente.'); return 3; }
  const env = envFiglio(process.env, { cwd: ROOT });
  const auth = await esegui(bin, ['auth', 'status'], { env, timeoutMs: 60_000 });
  if (!accessoDaStatus(auth.stdout)) { console.error(SENZA_ACCESSO); return 3; }
  const dirRuoli = join(ROOT, 'routines', 'roles');
  const ruolo = espandiInclusioni(readFileSync(join(dirRuoli, 'scheda.md'), 'utf8'), dirRuoli);
  let costo = 0;
  let falliti = 0;
  let nonSalvate = 0;
  let rifiutate = 0;
  const giro = await strada();
  const aggiornati = new Map();
  await aGruppi(voci, paralleli, async (v) => {
    const args = argomentiClaude({ model: modello, effort: '', nome: `scheda #${v.num}`, addDirs: [cartella] });
    // Una scheda vecchia che l'agente non riscrive resterebbe buona e verrebbe timbrata come nuova: conta l'ora del file.
    const prima = existsSync(fileScheda(cartella, v.num)) ? statSync(fileScheda(cartella, v.num)).mtimeMs : 0;
    const out = await esegui(bin, args, { cwd: ROOT, env, input: promptScheda(ruolo, { num: v.num, cartella, radice: ROOT, rilettura }), timeoutMs: 15 * 60_000 });
    const u = leggiUscitaClaude(out.stdout, out.stderr, out.code);
    costo += u.costo;
    const riscritta = existsSync(fileScheda(cartella, v.num)) && statSync(fileScheda(cartella, v.num)).mtimeMs > prima;
    const scheda = riscritta ? leggiJson(fileScheda(cartella, v.num)) : null;
    const male = difettiDopoAgente({ riscritta, scheda, num: v.num, rilettura });
    if (!u.ok || male.length) {
      falliti += 1;
      console.error(`#${v.num}: ${u.ok ? `scheda non buona (${male.join('; ')})` : `agente fallito (${u.errore.split('\n')[0]})`}: resta da rifare.`);
      return;
    }
    const { _riletta: _vecchia, ...nuova } = scheda;
    const stampata = { ...nuova, _fonte: { id: v.id, stato: v.stato, aggiornato: v.aggiornato, at: new Date().toISOString(), modello } };
    if (rilettura) stampata._riletta = { at: new Date().toISOString(), modello };
    writeFileSync(fileScheda(cartella, v.num), `${JSON.stringify(stampata, null, 1)}\n`);
    // La fonte è il feedback: la cartella è la copia di lavoro, e il manutentore in cloud legge solo da lì.
    const salvata = await salvaNelFeedback({ numero: v.num, scheda: SS.campiDellAgente(nuova), rilettura, modello }, giro);
    const daTenere = schedaDopoSalvataggio(stampata, salvata);
    writeFileSync(fileScheda(cartella, v.num), `${JSON.stringify(daTenere, null, 1)}\n`);
    if (daTenere[RIFIUTATA]) {
      rifiutate += 1;
      console.error(`#${v.num}: il server non salva la scheda (${daTenere[RIFIUTATA]}): resta solo nella cartella.`);
    } else if (daTenere[NON_SALVATA]) {
      nonSalvate += 1;
      console.error(`#${v.num}: scheda nella cartella ma non nel feedback (${salvata.motivo || 'risposta vuota'}).`);
    } else if (salvata.aggiornato) aggiornati.set(v.num, salvata.aggiornato);
    console.log(u.testo.split('\n').find((r) => r.trim()) || `#${v.num}: fatta`);
  });
  if (aggiornati.size) {
    const indice = leggiJson(join(cartella, INDICE));
    if (Array.isArray(indice)) writeFileSync(join(cartella, INDICE), `${JSON.stringify(indiceAggiornato(indice, aggiornati), null, 1)}\n`);
  }
  const salvate = `${nonSalvate ? `, ${nonSalvate} non salvate nel feedback (rilancia lo stesso comando)` : ''}${rifiutate ? `, ${rifiutate} rifiutate dal server (restano nella cartella)` : ''}`;
  console.log(`${voci.length - falliti} schede su ${voci.length}${falliti ? `, ${falliti} da rifare (rilancia lo stesso comando)` : ''}${salvate}. Costo dichiarato dagli agenti: ${costo.toFixed(2)} $.`);
  return falliti || nonSalvate ? 3 : 0;
}

export async function main(argv) {
  const [cmd] = argv;
  const cartella = resolve(opzione(argv, '--cartella') || CARTELLA_PREDEFINITA);
  const dentro = relative(ROOT, cartella);
  if (!dentro || (!dentro.startsWith('..') && !isAbsolute(dentro))) {
    console.error('Le schede contengono il testo dei feedback: dentro il repo pubblico non le scrivo. Scegli una --cartella fuori.');
    return 1;
  }
  const dryRun = argv.includes('--dry-run');
  const paralleli = Math.max(1, Math.min(20, Number(opzione(argv, '--paralleli')) || 6));
  let indice = leggiJson(join(cartella, INDICE));
  if (cmd === 'elenca') return elenca(cartella, dryRun);
  if (!['scrivi', 'rileggi', 'stato'].includes(cmd)) {
    console.error('Uso: npm run feedback:schede -- elenca | scrivi [--solo 812,815] [--paralleli 6] [--da-zero] | rileggi [--quota 0.1] | stato [--cartella <dir>] [--dry-run]');
    return 1;
  }
  if (!Array.isArray(indice)) { console.error(`Manca l'indice in ${join(cartella, INDICE)}: prima npm run feedback:schede -- elenca.`); return 1; }
  const soloChiesti = Boolean(String(opzione(argv, '--solo') || '').trim());
  if ((cmd === 'stato' || (cmd === 'scrivi' && !soloChiesti)) && !argv.includes('--da-zero')) {
    const fermo = censimentoMancante({ via: (await strada()).via, indice, schede: leggiSchede(cartella) });
    if (fermo) { console.error(fermo); return 1; }
  }
  if (cmd === 'stato') { console.log(JSON.stringify(riepilogo(indice, leggiSchede(cartella)), null, 1)); return 0; }
  let restano = 0;
  if (!dryRun) {
    const giro = await strada();
    const r = await rimandaNonSalvate(cartella, indice, { salva: (dati) => salvaNelFeedback(dati, giro) });
    if (r.aggiornati.size) {
      indice = indiceAggiornato(indice, r.aggiornati);
      writeFileSync(join(cartella, INDICE), `${JSON.stringify(indice, null, 1)}\n`);
    }
    if (r.mandate || r.restano || r.rifiutate) {
      console.log(`Schede rimaste fuori dal feedback: ${r.mandate} salvate adesso${r.restano ? `, ${r.restano} ancora fuori (rilancia lo stesso comando)` : ''}${r.rifiutate ? `, ${r.rifiutate} rifiutate dal server (restano nella cartella)` : ''}.`);
    }
    restano = r.restano;
    scriviSegnalati(cartella, indice);
  }
  const schede = leggiSchede(cartella);
  // Un segnalato non va all'agente: non lo può leggere, e la sua scheda il server non la salva.
  const perNum = new Map(indice.filter((f) => !f.segnalato).map((f) => [f.num, f]));
  if (cmd === 'scrivi') {
    const solo = String(opzione(argv, '--solo') || '').split(/[\s,]+/).map((n) => n.replace(/^#/, '')).filter(Boolean);
    const segnalati = solo.filter((n) => indice.some((f) => f.num === n && f.segnalato));
    if (segnalati.length) console.log(`Segnalati, senza agente: ${segnalati.map((n) => `#${n}`).join(', ')} (scheda «non letto» col motivo).`);
    const ignoti = solo.filter((n) => !perNum.has(n) && !segnalati.includes(n));
    if (ignoti.length) { console.error(`Non sono fra gli aperti dell'indice: ${ignoti.map((n) => `#${n}`).join(', ')}. Rilancia elenca se sono nuovi.`); return 1; }
    const mappa = new Map(schede.map((s) => [String(s.numero || '').replace(/^#/, ''), s]));
    const voci = solo.length ? solo.filter((n) => perNum.has(n)).map((n) => perNum.get(n)) : [...perNum.values()].filter((f) => daScrivere(f, mappa.get(f.num)));
    return (await lanciaAgenti(voci, { cartella, modello: opzione(argv, '--modello') || 'haiku', paralleli, rilettura: false, dryRun })) || (restano ? 3 : 0);
  }
  const quota = Math.max(0, Math.min(1, Number(opzione(argv, '--quota') ?? 0.1)));
  const voci = daRileggere(schede, { quota }).map((s) => perNum.get(String(s.numero).replace(/^#/, ''))).filter(Boolean);
  return (await lanciaAgenti(voci, { cartella, modello: opzione(argv, '--modello') || 'opus', paralleli, rilettura: true, dryRun })) || (restano ? 3 : 0);
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(await main(process.argv.slice(2)));
