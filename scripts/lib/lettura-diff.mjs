// lettura-diff.mjs — il fascicolo della lettura del diff (#1363): il diff del lavoro senza le prove dei giri, le prove
// contate, la richiesta che dispatch (o verify-local) lascia per il lettore e la ricevuta che la registrazione della
// critica pretende. Non scrive mai nel repo. Regole: tests/unit/letturaDiff.test.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaConsegna } from './consegna-file.mjs';
import { assicuraStoria } from './unit-sulla-fusione.mjs';
import { PROVE_APP, PROVE_SERVER, contaProve } from './conta-prove.mjs';
import { ramoAccettabile } from './git-server.mjs';
import { MAIN_SERVER, punteDelRamo } from './ramo-server.mjs';

export const FILE_RICHIESTA = 'lettura-richiesta.json';
export const FILE_RICEVUTA = 'lettura-fatta.json';
export const FILE_DIFF = 'lettura-diff.patch';
export const FILE_DIFF_SERVER = 'lettura-diff-server.patch';
// Le prove dei giri le scrive chi verifica, anche mentre la lettura gira: non sono il lavoro, e non la fanno decadere.
export const FUORI_DAL_DIFF = 'tests/verifica/';

const primaRiga = (s) => String(s || '').split(/\r?\n/).find((r) => r.trim()) || '';

export function gitIn(root) {
  return (args, { grezzo = false, timeout = 120000 } = {}) => {
    try {
      const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30, timeout });
      return { ok: true, out: grezzo ? out : out.trim() };
    } catch (e) {
      return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message || e) };
    }
  };
}

/**
 * Base e punta del lavoro: la punta è HEAD (o `head`), la base il punto in cui il ramo si stacca dal main REMOTO
 * appena scaricato (o `base`, per ripassare un lavoro già chiuso). → { base, head } o { errore }.
 */
export function estremiDelLavoro(root, { base = '', head = '', main = 'main' } = {}) {
  const git = gitIn(root);
  const punta = git(['rev-parse', '--verify', '--quiet', `${head || 'HEAD'}^{commit}`]);
  if (!punta.ok) return { errore: `la punta ${head || 'HEAD'} non si trova` };
  if (base) {
    const b = git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
    return b.ok ? { base: b.out, head: punta.out } : { errore: `la base ${base} non si trova` };
  }
  const f = git(['fetch', '--quiet', 'origin', `+refs/heads/${main}:refs/remotes/origin/${main}`]);
  const m = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${main}^{commit}`]);
  if (!m.ok) return { errore: `non ho origin/${main} da usare come base${f.ok ? '' : `, e scaricarlo non riesce (${primaRiga(f.out)})`}` };
  const storia = assicuraStoria({ git, mainSha: m.out, punta: punta.out, main });
  if (storia.errore) return { errore: storia.errore };
  const comune = git(['merge-base', m.out, punta.out]);
  if (!comune.ok) return { errore: `il ramo e origin/${main} non hanno una base comune` };
  return { base: comune.out.split('\n')[0], head: punta.out, ...(f.ok ? {} : { avviso: `origin/${main} non si aggiorna (${primaRiga(f.out)}): base calcolata sull'ultima copia scaricata` }) };
}

// A differenza di solo-tolte, uno spostamento resta una voce sola col percorso di prima: la prova spostata si confronta
// con sé stessa, non conta come nuova. `git diff --name-status -M -z` → [{ stato, percorso, prima }]. PURA.
export function vociConPercorsoPrima(out) {
  const p = String(out || '').split('\u0000');
  const voci = [];
  for (let i = 0; i < p.length - 1;) {
    const stato = p[i];
    if (!stato) { i++; continue; }
    if (/^[RC]/.test(stato)) { voci.push({ stato: stato[0], prima: p[i + 1], percorso: p[i + 2] }); i += 3; } else { voci.push({ stato: stato[0], prima: p[i + 1], percorso: p[i + 1] }); i += 2; }
  }
  return voci;
}

/** Le prove contate e il codice cambiato fuori dalla cartella delle prove, fra base e punta. */
export function contaDelLavoro(root, base, head, { prove = PROVE_APP } = {}) {
  const git = gitIn(root);
  const ns = git(['diff', '--name-status', '-M', '-z', base, head], { grezzo: true });
  if (!ns.ok) return { errore: `git diff non riesce (${primaRiga(ns.out)})` };
  const voci = vociConPercorsoPrima(ns.out);
  const leggi = (sha, p) => { const r = git(['show', `${sha}:${p}`], { grezzo: true }); return r.ok ? r.out : ''; };
  const file = voci.filter((v) => prove.tipo(v.percorso) || prove.tipo(v.prima)).map((v) => ({
    percorso: v.percorso,
    prima: v.stato === 'A' ? null : leggi(base, v.prima),
    dopo: v.stato === 'D' ? null : leggi(head, v.percorso),
  }));
  const num = git(['diff', '--numstat', '-M', '-z', base, head, '--', '.', `:(exclude)${prove.cartella}`], { grezzo: true });
  const codice = num.ok ? righeNumstat(num.out) : [];
  return { conto: contaProve(file, { prove }), codice };
}

/** `git diff --numstat -z` → [{ percorso, aggiunte, tolte }]; un binario conta 0. PURA. */
export function righeNumstat(out) {
  const p = String(out || '').split('\u0000');
  const righe = [];
  for (let i = 0; i < p.length; i++) {
    const r = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(p[i]);
    if (!r) continue;
    let percorso = r[3];
    // Uno spostamento con -z ha il nome vuoto qui e i due percorsi nei pezzi dopo.
    if (!percorso) { percorso = p[i + 2] || p[i + 1] || ''; i += 2; }
    righe.push({ percorso, aggiunte: r[1] === '-' ? 0 : Number(r[1]), tolte: r[2] === '-' ? 0 : Number(r[2]) });
  }
  return righe;
}

/** Il diff che si legge: tutto il lavoro, senza le prove dei giri di verifica. */
export function diffDelLavoro(root, base, head) {
  const r = gitIn(root)(['diff', '-M', base, head, '--', '.', `:(exclude)${FUORI_DAL_DIFF}`], { grezzo: true });
  return r.ok ? { diff: r.out } : { errore: `git diff non riesce (${primaRiga(r.out)})` };
}

/**
 * La parte del server di un lavoro server (#2049): il ramo omonimo nel repo di filo-security in `radice`, dalla base
 * comune col main del server che quel repo ha già. Non scarica niente: verso filo-security si va solo con git-server.
 * → { ramo, base, head, diff, conto, codice } | { ramo, vuoto } | { ramo, nonLetto }, gli ultimi due col perché.
 */
export function parteDelServer(radice, ramo) {
  const no = (nonLetto) => ({ ramo, nonLetto });
  if (!ramoAccettabile(ramo)) return no(`il ramo dell'app non ha un nome da cercare nel server («${ramo}»)`);
  if (!radice || !existsSync(radice)) return no(`il clone del server non c'è (${radice || 'nessuna cartella'})`);
  const git = gitIn(radice);
  if (!git(['rev-parse', '--git-dir']).ok) return no(`in ${radice} non c'è un repository git`);
  const { sha } = punteDelRamo(radice, ramo);
  if (!sha) return no(`in ${radice} il ramo ${ramo} non c'è, né locale né scaricato da origin`);
  const main = git(['rev-parse', '--verify', '--quiet', `${MAIN_SERVER}^{commit}`]);
  if (!main.ok) return no(`in ${radice} manca origin/main, la base del confronto`);
  const comune = git(['merge-base', main.out, sha]);
  if (!comune.ok) return no(`il ramo ${ramo} e il main del server non hanno una base comune in ${radice}`);
  const base = comune.out.split('\n')[0];
  if (base === sha) return { ramo, vuoto: `il ramo ${ramo} del server non ha commit fuori dal main del server` };
  const conta = contaDelLavoro(radice, base, sha, { prove: PROVE_SERVER });
  const diff = conta.errore ? conta : diffDelLavoro(radice, base, sha);
  if (diff.errore) return no(diff.errore);
  return { ramo, base, head: sha, diff: diff.diff, conto: conta.conto, codice: conta.codice };
}

const cartella = (root, dir) => dir || cartellaConsegna(root);

function scriviJson(f, o) {
  mkdirSync(join(f, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(f, JSON.stringify(o, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return f;
}

function leggiJson(f) {
  try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch (_) { return null; }
}

/**
 * La richiesta per il lettore, accanto ai pezzi della consegna: `richiesta` è il payload del verificatore (feedback,
 * decisioni, provvisorie, immagini) o, in locale, il testo. La sua presenza dice che la lettura è attesa.
 * `radiceServer`: il repo di filo-security di un lavoro server, che la lettura deve leggere insieme all'app.
 */
export function scriviRichiesta(root, { ramo = '', richiesta, radiceServer = '' } = {}, { dir = '' } = {}) {
  return scriviJson(join(cartella(root, dir), FILE_RICHIESTA), {
    ramo: String(ramo || ''), scritta: new Date().toISOString(), richiesta, ...(radiceServer ? { radiceServer: String(radiceServer) } : {}),
  });
}

/** Dal payload del verificatore, la sola richiesta: la serie delle critiche passate al lettore non serve. PURA. */
export function richiestaDalPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const campi = ['id', 'num', 'feedback', 'decisioni', 'provvisorie', 'immagini'];
  const out = Object.fromEntries(campi.filter((k) => p[k] !== undefined && p[k] !== null).map((k) => [k, p[k]]));
  const esterni = Object.entries((p.fileEsterni && typeof p.fileEsterni === 'object') ? p.fileEsterni : {})
    .filter(([k]) => campi.includes(k.split('.')[0]));
  return esterni.length ? { ...out, fileEsterni: Object.fromEntries(esterni) } : out;
}

/** La richiesta di questo ramo, o null: quella lasciata da un altro ramo (una verifica locale vecchia) non vale. */
export function leggiRichiesta(root, { ramo = '', dir = '' } = {}) {
  const r = leggiJson(join(cartella(root, dir), FILE_RICHIESTA));
  if (!r || typeof r !== 'object' || !('richiesta' in r)) return null;
  return !ramo || !r.ramo || r.ramo === ramo ? r : null;
}

// Un giro che la lettura non la chiede (la chiusura, in locale dove niente svuota la cartella) toglie quella vecchia.
export function togliRichiesta(root, { dir = '' } = {}) {
  rmSync(join(cartella(root, dir), FILE_RICHIESTA), { force: true });
}

export function scriviRicevuta(root, ricevuta, { dir = '' } = {}) {
  return scriviJson(join(cartella(root, dir), FILE_RICEVUTA), { ...ricevuta, fatta: new Date().toISOString() });
}

export function leggiRicevuta(root, { dir = '' } = {}) {
  return leggiJson(join(cartella(root, dir), FILE_RICEVUTA));
}

export function ramoCorrente(root) {
  const r = gitIn(root)(['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok && r.out !== 'HEAD' ? r.out : '';
}

/**
 * '' se la critica si può registrare, altrimenti il perché. La lettura è attesa solo se c'è la richiesta di questo
 * ramo (verifica piena); vale la ricevuta di una lettura fatta su questo codice, prove dei giri a parte.
 */
export function letturaMancante(root, head, { ramo = ramoCorrente(root), dir = '' } = {}) {
  if (!leggiRichiesta(root, { ramo, dir })) return '';
  const comando = 'lancia il sotto-agente della lettura (il passo «La lettura del diff» del tuo ruolo) e aspetta il suo testo';
  const r = leggiRicevuta(root, { dir });
  if (!r || !r.head) return `critica non registrata: manca la lettura del diff, che nella verifica piena viene dopo il tuo verdetto e prima della registrazione. ${comando}; poi rilancia lo stesso comando.`;
  if (r.ramo && ramo && r.ramo !== ramo) return `critica non registrata: la lettura del diff è stata fatta sul ramo ${r.ramo}, non su questo. ${comando}.`;
  if (!head || r.head === head) return '';
  const cambiati = gitIn(root)(['diff', '--name-only', r.head, head]);
  if (!cambiati.ok) return `critica non registrata: non riesco a confrontare il codice letto (${String(r.head).slice(0, 8)}) con quello di adesso (${primaRiga(cambiati.out)}). ${comando}.`;
  const fuori = cambiati.out.split('\n').filter((p) => p && !p.startsWith(FUORI_DAL_DIFF));
  if (!fuori.length) return '';
  return `critica non registrata: la lettura del diff è stata fatta su ${String(r.head).slice(0, 8)}, e da allora è cambiato il codice (${fuori.slice(0, 5).join(', ')}${fuori.length > 5 ? ` e altri ${fuori.length - 5}` : ''}). ${comando}.`;
}
