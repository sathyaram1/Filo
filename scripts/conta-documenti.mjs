// conta-documenti.mjs — quanti documenti ha ogni raccolta di un database Firestore, sottoraccolte comprese: il conto da
// rifare prima dell'export e dopo l'import di un trasloco (#1763). Solo lettura, con l'account attivo di gcloud.
// Uso: npm run db:conta -- --aiuto. Prove: tests/unit/contaDocumenti.test.mjs.

import './lib/freno-letture.mjs';
import { createRequire } from 'node:module';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRitentato } from './lib/rete.mjs';
import { contatoreLetture } from './lib/letture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROGETTO_FILO = createRequire(import.meta.url)(resolve(ROOT, 'src', 'main', 'auth', 'config.js')).firebaseProjectId;
export const FIRESTORE_V1 = 'https://firestore.googleapis.com/v1';
export const FORMATO = 'filo-conta-documenti/1';
// Solo nomi: cinquemila stanno in un MB di risposta.
export const PAGINA = 5000;
// L'id più basso che una raccolta possa avere: l'intervallo [raccolta/ID_MINIMO, raccolta\0/ID_MINIMO) prende la
// raccolta e tutti i suoi discendenti, anche quelli sotto un documento che non esiste. È la domanda di firebase-tools
// quando svuota un database: il percorso provato dal server vero.
export const ID_MINIMO = '__id-9223372036854775808__';
const RITENTABILI = new Set([429, 500, 502, 503, 504]);
const ATTESE_MS = [1000, 2000, 4000, 8000, 16000];
// Le sole due domande che lo strumento fa: tutt'e due leggono. Qualunque altra richiesta si ferma prima della rete.
const LETTURE = /\/documents(?:\/[^:]*)?:(?:runQuery|listCollectionIds)$/;

export const USO = [
  'Uso: npm run db:conta -- [opzioni]',
  '  --progetto <id>          il progetto Google Cloud (di serie quello di Filo)',
  '  --database <id>          il database (di serie "(default)")',
  '  --confronta              confronta con l\'ultimo conteggio salvato dello stesso progetto e database',
  '  --confronta <prima.json> confronta con quel conteggio',
  '  --confronta <a> <b>      confronta due conteggi salvati, senza leggere il database',
  '  --salva <file>           salva il conteggio lì invece che nella cartella dei conteggi',
  '  --dettaglio              raccolta per raccolta invece che per gruppo',
].join('\n');

const proprio = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const perNome = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Le parole della riga di comando. PURA. */
export function leggiArgomenti(argv, { progetto = PROGETTO_FILO } = {}) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const o = { progetto, database: '(default)', confronta: null, salva: '', dettaglio: false, aiuto: false };
  const libero = (i) => a[i] !== undefined && !a[i].startsWith('--');
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '--progetto' || x === '--database' || x === '--salva') {
      if (!libero(i + 1) || !a[i + 1].trim()) return { errore: `${x} vuole un valore.\n${USO}` };
      o[x.slice(2)] = a[++i].trim();
    } else if (x === '--confronta') {
      o.confronta = [];
      while (o.confronta.length < 2 && libero(i + 1)) o.confronta.push(a[++i]);
    } else if (x === '--dettaglio') o.dettaglio = true;
    else if (x === '--aiuto' || x === '--help' || x === '-h') o.aiuto = true;
    else return { errore: `"${x}" non vale qui.\n${USO}` };
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(o.progetto)) return { errore: `"${o.progetto}" non è l'id di un progetto Google Cloud (minuscole, cifre e trattini, da 6 a 30).` };
  if (o.database !== '(default)' && !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(o.database)) {
    return { errore: `"${o.database}" non è l'id di un database Firestore: "(default)" o minuscole, cifre e trattini.` };
  }
  return o;
}

/** Come si chiede il token a gcloud su questo sistema. PURA. */
export function comandoToken(sistema = process.platform) {
  // Su Windows gcloud è un .cmd, e Node lancia un .cmd solo passando da cmd.exe.
  if (sistema === 'win32') return { riga: 'gcloud auth print-access-token', shell: true };
  return { file: 'gcloud', argomenti: ['auth', 'print-access-token'], shell: false };
}

/** Il token dell'account attivo di gcloud. `esegui(comando)` ne restituisce l'uscita. */
export function tokenDaGcloud({ sistema = process.platform, esegui = null } = {}) {
  const comando = comandoToken(sistema);
  const opzioni = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, windowsHide: true };
  const lancia = esegui || ((c) => (c.shell ? execSync(c.riga, opzioni) : execFileSync(c.file, c.argomenti, opzioni)));
  let uscita;
  try {
    uscita = lancia(comando);
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new Error('gcloud non c\'è su questa macchina: installa Google Cloud SDK e accedi con «gcloud auth login».');
    const detto = String((e && e.stderr) || (e && e.message) || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
    throw new Error(`gcloud non ha dato il token${detto ? ` (${detto})` : ''}. Accedi con «gcloud auth login» e rilancia.`);
  }
  const token = String(uscita || '').trim().split(/\r?\n/).pop().trim();
  if (!token) throw new Error('gcloud non ha dato il token (uscita vuota). Accedi con «gcloud auth login» e rilancia.');
  return token;
}

/** Ferma, prima della rete, tutto quello che non è una delle due letture. PURA. */
export function soloLettura(url, init = {}) {
  const metodo = String((init && init.method) || 'GET').toUpperCase();
  let percorso = '';
  try { percorso = decodeURIComponent(new URL(String(url)).pathname); } catch (_) { percorso = ''; }
  if (metodo !== 'POST' || !LETTURE.test(percorso)) {
    throw new Error(`richiesta rifiutata, lo strumento legge e basta: ${metodo} ${url}`);
  }
}

/** La pagina di nomi dopo `dopo` dentro la raccolta di primo livello `id`, discendenti compresi. PURA. */
export function corpoPagina(radice, id, dopo = '', quanti = PAGINA) {
  const filtro = (op, nome) => ({ fieldFilter: { field: { fieldPath: '__name__' }, op, value: { referenceValue: nome } } });
  const structuredQuery = {
    from: [{ allDescendants: true }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          filtro('GREATER_THAN_OR_EQUAL', `${radice}/${id}/${ID_MINIMO}`),
          filtro('LESS_THAN', `${radice}/${id}\u0000/${ID_MINIMO}`),
        ],
      },
    },
    select: { fields: [{ fieldPath: '__name__' }] },
    orderBy: [{ field: { fieldPath: '__name__' } }],
    limit: quanti,
  };
  if (dopo) structuredQuery.startAt = { values: [{ referenceValue: dopo }], before: false };
  return { structuredQuery };
}

function messaggioGoogle(testo) {
  try {
    const e = JSON.parse(testo).error || {};
    return [e.status, e.message].filter(Boolean).join(': ');
  } catch (_) {
    return String(testo || '').trim().slice(0, 300);
  }
}

function erroreHttp(status, testo, progetto, database) {
  const detto = messaggioGoogle(testo);
  const coda = detto ? ` Risposta: ${detto}` : '';
  if (status === 401) {
    return new Error(`Firestore non riconosce le credenziali di gcloud (401): accedi di nuovo con «gcloud auth login» e rilancia.${coda}`);
  }
  if (status === 403) {
    return new Error(`Firestore ha detto no (403) sul progetto ${progetto}: l'account attivo di gcloud non può leggerlo, `
      + `o l'API di Firestore lì non è attiva. «gcloud auth list» dice quale account è attivo.${coda}`);
  }
  if (status === 404) return new Error(`il database ${database} del progetto ${progetto} non esiste (404).${coda}`);
  return new Error(`Firestore ha risposto ${status}.${coda}`);
}

const attesaVera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Le due letture su un database, coi tentativi e il conto di quanto si paga. `token({ nuovo })` dà il bearer. */
export function clienteFirestore({
  progetto, database = '(default)', token, fetchImpl = fetch, attendi = attesaVera,
  letture = contatoreLetture(), base = FIRESTORE_V1,
}) {
  const radice = `projects/${progetto}/databases/${database}/documents`;
  let bearer = '';
  async function posta(percorso, corpo) {
    const url = `${base}/${percorso}`;
    const init = { method: 'POST', body: JSON.stringify(corpo) };
    soloLettura(url, init);
    let rinnovato = false;
    for (let tentativo = 0; ; tentativo++) {
      if (!bearer) bearer = await token({ nuovo: rinnovato });
      // Con le credenziali di una persona alcune API vogliono sapere a quale progetto addebitare la quota.
      init.headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, 'x-goog-user-project': progetto };
      const res = await fetchRitentato(url, init, { fetchImpl });
      if (res.ok) return res.json();
      const testo = await res.text().catch(() => '');
      // Un giro lungo può durare più del token (un'ora): se ne chiede uno nuovo, una volta.
      if (res.status === 401 && !rinnovato) { rinnovato = true; bearer = ''; continue; }
      if (RITENTABILI.has(res.status) && tentativo < ATTESE_MS.length) { await attendi(ATTESE_MS[tentativo]); continue; }
      throw erroreHttp(res.status, testo, progetto, database);
    }
  }
  return {
    progetto, database, radice, letture,
    async raccolteRadice() {
      const ids = [];
      let pageToken = '';
      do {
        const r = await posta(`${radice}:listCollectionIds`, Object.assign({ pageSize: 1000 }, pageToken ? { pageToken } : {}));
        letture.aggiungi(1, 'elenchi delle raccolte');
        for (const id of Array.isArray(r && r.collectionIds) ? r.collectionIds : []) ids.push(String(id));
        const prossimo = String((r && r.nextPageToken) || '');
        if (prossimo && prossimo === pageToken) throw new Error('Firestore ripete la stessa pagina dell\'elenco delle raccolte');
        pageToken = prossimo;
      } while (pageToken);
      return ids;
    },
    async pagina(id, dopo = '', quanti = PAGINA) {
      const righe = await posta(`${radice}:runQuery`, corpoPagina(radice, id, dopo, quanti));
      const nomi = [];
      for (const r of Array.isArray(righe) ? righe : []) {
        if (r && r.error) throw new Error(`Firestore ha interrotto la lettura di ${id}: ${messaggioGoogle(JSON.stringify(r))}`);
        if (r && r.document && r.document.name) nomi.push(String(r.document.name));
      }
      // Una domanda che non trova niente si paga comunque una lettura.
      letture.aggiungi(Math.max(1, nomi.length), 'documenti');
      return nomi;
    },
  };
}

/** La raccolta che contiene il documento `nome`, relativa alla radice. PURA. */
export function raccoltaDi(nome, radice) {
  const n = String(nome);
  if (!n.startsWith(`${radice}/`)) throw new Error(`documento fuori dal database: ${n}`);
  const pezzi = n.slice(radice.length + 1).split('/');
  if (pezzi.length < 2 || pezzi.length % 2 || pezzi.some((p) => !p)) throw new Error(`nome di documento inatteso: ${n}`);
  return pezzi.slice(0, -1).join('/');
}

// feedback/abc/note → feedback/*/note: le sottoraccolte con lo stesso nome sotto lo stesso genere di documento. PURA.
export function gruppoDi(raccolta) {
  return String(raccolta).split('/').map((p, i) => (i % 2 ? '*' : p)).join('/');
}

function ordinato(voci) {
  return Object.fromEntries([...voci].sort((x, y) => perNome(x[0], y[0])));
}

// Si visita ogni documento, solo il nome: è l'unico modo di trovare tutte le sottoraccolte, e la visita è già il conto.
// Un COUNT per raccolta in più costerebbe senza dire niente di nuovo.
export async function contaRaccolte(cliente, { quanti = PAGINA, avanzamento = () => {} } = {}) {
  const raccolte = new Map();
  let totale = 0;
  for (const id of await cliente.raccolteRadice()) {
    let dopo = '';
    let visti = 0;
    for (;;) {
      const nomi = await cliente.pagina(id, dopo, quanti);
      if (!nomi.length) break;
      for (const nome of nomi) {
        const r = raccoltaDi(nome, cliente.radice);
        if (r !== id && !r.startsWith(`${id}/`)) throw new Error(`Firestore ha risposto con un documento fuori da ${id}: ${nome}`);
        raccolte.set(r, (raccolte.get(r) || 0) + 1);
      }
      visti += nomi.length;
      totale += nomi.length;
      const ultimo = nomi[nomi.length - 1];
      if (ultimo === dopo) throw new Error(`Firestore ripete la stessa pagina di ${id}`);
      dopo = ultimo;
      avanzamento({ id, visti, totale, finita: false });
    }
    avanzamento({ id, visti, totale, finita: true });
  }
  return { totale, raccolte: ordinato(raccolte) };
}

/** I conti per gruppo: documenti e quante raccolte ci sono dietro. PURA. */
export function perGruppo(raccolte) {
  const g = new Map();
  for (const [r, n] of Object.entries(raccolte || {})) {
    const k = gruppoDi(r);
    const v = g.get(k) || { documenti: 0, raccolte: 0 };
    v.documenti += n;
    v.raccolte += 1;
    g.set(k, v);
  }
  return ordinato(g);
}

const raccolteParola = (n) => `${n} ${n === 1 ? 'raccolta' : 'raccolte'}`;

/** L'elenco da confrontare: stesse raccolte, stesse righe, nello stesso ordine su qualunque macchina. PURA. */
export function righeElenco(conto, { dettaglio = false } = {}) {
  const voci = dettaglio
    ? Object.entries(conto.raccolte).map(([k, n]) => [k, n, ''])
    : Object.entries(perGruppo(conto.raccolte)).map(([k, v]) => [k, v.documenti, k.includes('/') ? `  (${raccolteParola(v.raccolte)})` : '']);
  const largo = String(conto.totale).length;
  return [...voci.map(([k, n, coda]) => `${String(n).padStart(largo)}  ${k}${coda}`), `${String(conto.totale).padStart(largo)}  totale`];
}

const somma = (raccolte) => Object.values(raccolte || {}).reduce((s, n) => s + n, 0);

/** Raccolta per raccolta: che cosa non torna fra `prima` e `dopo`. PURA. */
export function confronta(prima, dopo) {
  const a = (prima && prima.raccolte) || {};
  const b = (dopo && dopo.raccolte) || {};
  const chiavi = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(perNome);
  const diverse = [];
  // Raccolta per raccolta, non dai totali: dieci mancanti e dieci in più altrove danno lo stesso totale.
  let mancano = 0;
  let inPiu = 0;
  for (const k of chiavi) {
    const x = proprio(a, k) ? a[k] : 0;
    const y = proprio(b, k) ? b[k] : 0;
    if (x === y) continue;
    diverse.push({ raccolta: k, prima: x, dopo: y });
    if (x > y) mancano += x - y;
    else inPiu += y - x;
  }
  return { uguale: diverse.length === 0, diverse, raccolte: chiavi.length, mancano, inPiu, totalePrima: somma(a), totaleDopo: somma(b) };
}

function differenza({ prima, dopo }) {
  if (!dopo) return `manca (prima ${prima})`;
  if (!prima) return `in più (${dopo}, prima non c'era)`;
  const d = dopo - prima;
  return `${prima} → ${dopo} (${d > 0 ? '+' : ''}${d})`;
}

/** Il verdetto del confronto: per gruppo, poi le sottoraccolte una per una. PURA. */
export function righeConfronto(esito, { dettaglio = false, max = 30 } = {}) {
  if (esito.uguale) return [`UGUALE: ${raccolteParola(esito.raccolte)}, ${esito.totaleDopo} documenti, nessuna differenza.`];
  const mancano = esito.mancano === 1 ? 'manca 1 documento' : `mancano ${esito.mancano} documenti`;
  const n = esito.diverse.length;
  const righe = [`DIVERSO: ${raccolteParola(n)} su ${esito.raccolte} non ${n === 1 ? 'torna' : 'tornano'}: ${mancano}, ${esito.inPiu} in più `
    + `(${esito.totalePrima} prima, ${esito.totaleDopo} dopo).`];
  const gruppi = new Map();
  for (const d of esito.diverse) {
    const k = gruppoDi(d.raccolta);
    const g = gruppi.get(k) || { prima: 0, dopo: 0, raccolte: 0 };
    g.prima += d.prima;
    g.dopo += d.dopo;
    g.raccolte += 1;
    gruppi.set(k, g);
  }
  for (const [k, g] of [...gruppi].sort((x, y) => perNome(x[0], y[0]))) {
    righe.push(`  ${k}: ${differenza(g)}${k.includes('/') ? `, in ${raccolteParola(g.raccolte)}` : ''}`);
  }
  const sotto = esito.diverse.filter((d) => d.raccolta.includes('/'));
  const mostrate = dettaglio ? sotto : sotto.slice(0, max);
  if (mostrate.length) righe.push('Le sottoraccolte che non tornano:');
  for (const d of mostrate) righe.push(`  ${d.raccolta}: ${differenza(d)}`);
  if (mostrate.length < sotto.length) righe.push(`  … e altre ${sotto.length - mostrate.length}: --dettaglio le mostra tutte.`);
  return righe;
}

/** Quello che si scrive su disco. PURA. */
export function documentoDaSalvare(conto, { progetto, database, ora = new Date() }) {
  return { formato: FORMATO, progetto, database, contatoIl: ora.toISOString(), totale: conto.totale, raccolte: conto.raccolte };
}

/** Un conteggio salvato, controllato. */
export function leggiConteggio(file, { leggi = readFileSync } = {}) {
  let j;
  try {
    j = JSON.parse(String(leggi(file, 'utf8')).replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`${file} non si legge come conteggio: ${String((e && e.message) || e)}`);
  }
  if (!j || j.formato !== FORMATO || !j.raccolte || typeof j.raccolte !== 'object' || Array.isArray(j.raccolte)) {
    throw new Error(`${file} non è un conteggio salvato da questo strumento.`);
  }
  for (const [k, n] of Object.entries(j.raccolte)) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`${file}: il numero della raccolta ${k} non è un conteggio (${JSON.stringify(n)}).`);
  }
  return Object.assign(j, { totale: somma(j.raccolte) });
}

export function cartellaConteggi(casa = homedir()) {
  return join(casa, 'filo-conteggi-firestore');
}

/** I nomi in ordine alfabetico sono in ordine di tempo: i due punti non stanno nei nomi di file di Windows. PURA. */
export function nomeFile(progetto, database, ora = new Date()) {
  return `${progetto}_${database}_${ora.toISOString().replace(/[:.]/g, '-')}.json`;
}

/** L'ultimo conteggio salvato dello stesso progetto e database, o null. */
export function ultimoSalvato(cartella, progetto, database, { elenca = readdirSync, esiste = existsSync } = {}) {
  if (!esiste(cartella)) return null;
  const testa = `${progetto}_${database}_`;
  const nomi = elenca(cartella).map(String).filter((n) => n.startsWith(testa) && n.endsWith('.json')).sort(perNome);
  return nomi.length ? join(cartella, nomi[nomi.length - 1]) : null;
}

function quando(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '?');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function intestazioneConfronto(prima, dopo, filePrima) {
  const di = (c) => `${c.progetto}, database ${c.database}, contato il ${quando(c.contatoIl)}`;
  return `Confronto: prima ${di(prima)}${filePrima ? ` (${filePrima})` : ''}; dopo ${di(dopo)}.`;
}

function avanzamentoSu(err) {
  const riga = (id, n) => `  ${id}: ${n} ${n === 1 ? 'documento' : 'documenti'}, sottoraccolte comprese`;
  return ({ id, visti, finita }) => {
    if (err.isTTY) err.write(`\r${riga(id, visti)}${finita ? '\n' : '…'}`);
    else if (finita) err.write(`${riga(id, visti)}\n`);
  };
}

/** Il comando. Le dipendenze si passano per provarlo senza rete né gcloud. @returns {Promise<number>} il codice d'uscita */
export async function main(argv = process.argv.slice(2), {
  out = (r) => console.log(r), err = process.stderr, casa = homedir(), fetchImpl = fetch,
  token = () => tokenDaGcloud(), attendi = attesaVera, ora = () => new Date(),
} = {}) {
  const avvisa = (r) => err.write(`${r}\n`);
  const o = leggiArgomenti(argv);
  if (o.errore) { avvisa(o.errore); return 2; }
  if (o.aiuto) { out(USO); return 0; }
  const cartella = cartellaConteggi(casa);

  if (o.confronta && o.confronta.length === 2) {
    const [prima, dopo] = o.confronta.map((f) => leggiConteggio(f));
    const esito = confronta(prima, dopo);
    out(intestazioneConfronto(prima, dopo, ''));
    for (const r of righeConfronto(esito, { dettaglio: o.dettaglio })) out(r);
    return esito.uguale ? 0 : 1;
  }
  let base = null;
  if (o.confronta) {
    const file = o.confronta[0] ? resolve(o.confronta[0]) : ultimoSalvato(cartella, o.progetto, o.database);
    if (!file) {
      avvisa(`Nessun conteggio salvato di ${o.progetto} (database ${o.database}) in ${cartella}: lancia prima il conteggio senza --confronta, o dai il file da confrontare.`);
      return 2;
    }
    base = { file, conto: leggiConteggio(file) };
  }

  avvisa(`Conto i documenti di ${o.progetto}, database ${o.database}, con l'account attivo di gcloud. Solo lettura.`);
  const cliente = clienteFirestore({ progetto: o.progetto, database: o.database, token, fetchImpl, attendi });
  const inizio = ora();
  let conto;
  try {
    conto = await contaRaccolte(cliente, { avanzamento: avanzamentoSu(err) });
  } catch (e) {
    avvisa(`\nConteggio interrotto: ${String((e && e.message) || e)}\nNiente salvato: rilancia.`);
    avvisa(cliente.letture.riga());
    return 1;
  }
  for (const r of righeElenco(conto, { dettaglio: o.dettaglio })) out(r);
  const doc = documentoDaSalvare(conto, { progetto: o.progetto, database: o.database, ora: inizio });
  const file = o.salva ? resolve(o.salva) : join(cartella, nomeFile(o.progetto, o.database, inizio));
  let salvato = true;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    avvisa(`Conteggio salvato in ${file}`);
  } catch (e) {
    salvato = false;
    avvisa(`Conteggio NON salvato in ${file}: ${String((e && e.message) || e)}`);
  }
  avvisa(cliente.letture.riga());
  if (!base) return salvato ? 0 : 1;
  const esito = confronta(base.conto, doc);
  out(intestazioneConfronto(base.conto, doc, base.file));
  for (const r of righeConfronto(esito, { dettaglio: o.dettaglio })) out(r);
  return esito.uguale && salvato ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`conta-documenti: ${String((e && e.message) || e)}`); process.exitCode = 1; });
}
