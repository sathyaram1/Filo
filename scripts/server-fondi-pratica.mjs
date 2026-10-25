// Il lavoro locale sul server con la sua pratica (#908): la controlla, la prende in carico, lancia server:fondi di
// filo-security e a fusione riuscita la chiude solo se la parte dell'app è già su main o con --solo-server (#915).
// Regole: tests/unit/serverFondiPratica.test.mjs. Uso: npm run server:fondi -- claude/<ramo> --feedback <N>

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estraiOpzioneFeedback, risolviFeedback } from './lib/pratica-locale.mjs';
import { argomentiDaNpm } from './lib/argomenti.mjs';
import { FINESTRA_PARTE_TARDIVA_MS, NOME_PARTE, RAMO_RE, parteTardiva, riaperturaConAltraInArrivo } from './lib/parti-lavoro.mjs';
import { cartellaDelServer } from './lib/ramo-server.mjs';

export { cartellaDelServer };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Lo legge server:fondi di filo-security: senza, si rifiuta e rimanda qui.
export const PRATICA_ENV = 'FILO_SERVER_PRATICA';
// I lavori server delle routine hanno su filo-security il nome del ramo dell'app, `worker/<id>-<ora>` (#1159).
export const RAMO_ROUTINE_RE = /^worker\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const USO = 'Uso, dal repo Filo: npm run server:fondi -- claude/<ramo> --feedback <N> [--solo-server] [--dry-run]';

export const SENZA_PRATICA = [
  'Questo lavoro sul server non ha la sua pratica, e ogni lavoro locale ne ha una: in Gestione è il registro di cosa fa ogni sessione.',
  'Aprila, se non c’è ancora, e rilancia col suo numero:',
  '  npm run feedback:apri -- "<titolo>" "<cosa fa il lavoro>" --locale',
  '  npm run server:fondi -- <ramo> --feedback <N>',
  'Non ho toccato niente.',
].join('\n');

/** Ramo, pratica, «solo server» e prova a vuoto, anche quando npm si è preso le opzioni. PURA. */
export function leggiArgomenti(argv, env = {}) {
  const daNpm = argomentiDaNpm(env, { opzioni: ['--feedback', '--dry-run', '--solo-server'], conValore: ['--feedback'] });
  if (daNpm.errore) return { errore: daNpm.errore };
  const f = estraiOpzioneFeedback([...(Array.isArray(argv) ? argv : []), ...daNpm.args]);
  if (f.errore) return { errore: f.errore };
  const dryRun = f.resto.includes('--dry-run');
  const soloServer = f.resto.includes('--solo-server');
  const altri = f.resto.filter((a) => a !== '--dry-run' && a !== '--solo-server');
  const sconosciute = altri.filter((a) => /^-/.test(a));
  if (sconosciute.length) return { errore: `argomenti non capiti (${sconosciute.join(' ')})` };
  if (altri.length > 1) return { errore: `un ramo solo, non ${altri.length} (${altri.join(' ')})` };
  const ramo = ramoCanonico(altri[0]);
  if (ramo && (!(RAMO_RE.test(ramo) || RAMO_ROUTINE_RE.test(ramo)) || /\.\.|\.lock$|\.$|\/\./.test(ramo))) {
    return { errore: `porto su main solo rami claude/<nome>, o worker/<nome> delle routine: «${altri[0]}» no` };
  }
  return { ramo, pratica: f.valore, dryRun, soloServer, nota: daNpm.nota };
}

/**
 * Il nome come lo legge lo strumento del server (origin/…, refs/heads/… valgono il ramo): il verdetto si cerca e il
 * server riceve questo, mai la forma scritta, così il nome cercato è quello che si fonde (#1062). PURA.
 */
export function ramoCanonico(r) {
  return String(r || '').trim().replace(/^refs\/heads\//, '').replace(/^(refs\/remotes\/)?origin\//, '');
}

export const notaInizio = (ramo) => `Lavoro sul server: porto ${ramo} su main di filo-security (npm run server:fondi).`;
export const notaFine = (ramo, sha, daGitHub = false) => `Fuso su main di filo-security: ${ramo}${sha ? ` a ${sha.slice(0, 9)}` : ''}. ${daGitHub
  ? 'In produzione lo porta GitHub (deploy.yml).'
  : 'In produzione va col deploy, npm run server:pubblica.'}`;
// Con deploy.yml su main la spinta appena fatta la pubblica GitHub: un server:pubblica adesso correrebbe insieme al suo.
export const perIlDeploy = (daGitHub) => (daGitHub
  ? 'Il deploy lo fa GitHub (deploy.yml) per questa spinta: niente server:pubblica adesso. Se la corsa è rossa, rilanciala, o npm run server:pubblica a corsa finita.'
  : 'Per il deploy: npm run server:pubblica, da filo-security/functions.');

/**
 * I rami dell'app legati alla pratica (verify-local start --feedback, in ogni worktree del repo), ancora esistenti e non ancora su
 * origin/main: un lavoro che tocca app e server lo chiude la fusione dell'app, che salta L5 solo a pratica aperta.
 * `ramoGemello`: il ramo dell'app con lo stesso nome di quello del server conta anche senza start, se non è di un'altra pratica.
 */
export function ramiApertiDellaPratica(id, { radice = ROOT, git = gitIn, leggi = leggiJson, ramoGemello = '' } = {}) {
  const lista = git(radice, ['worktree', 'list', '--porcelain']);
  if (lista === null) return [];
  // Il ramo appena fuso dal server (npm run finish) è dentro origin/main solo dopo un fetch; se non riesce, si resta prudenti.
  git(radice, ['fetch', '--quiet', 'origin', 'main']);
  const cartelle = lista.split('\n').filter((r) => r.startsWith('worktree ')).map((r) => r.slice('worktree '.length).trim());
  const rami = new Set();
  const altrui = new Set();
  for (const c of cartelle) {
    const stato = leggi(join(c, '.claude', 'verify-local.json')) || {};
    for (const [ramo, e] of Object.entries(stato)) {
      if (e && e.feedbackId && e.feedbackId !== id) altrui.add(ramo);
      if (!e || e.feedbackId !== id) continue;
      // Un ramo legato e poi cancellato non è una parte che può ancora arrivare: contato, terrebbe aperta la pratica per sempre.
      if (git(radice, ['rev-parse', '--verify', '--quiet', `refs/heads/${ramo}`]) === null) continue;
      if (git(radice, ['merge-base', '--is-ancestor', ramo, 'refs/remotes/origin/main']) === null) rami.add(ramo);
    }
  }
  const g = String(ramoGemello || '');
  if (/^claude\/[A-Za-z0-9._\/-]+$/.test(g) && !/\.\./.test(g) && !rami.has(g) && !altrui.has(g)
    && git(radice, ['rev-parse', '--verify', '--quiet', `refs/heads/${g}`]) !== null
    && git(radice, ['merge-base', '--is-ancestor', g, 'refs/remotes/origin/main']) === null) rami.add(g);
  return [...rami];
}

function gitIn(cwd, args) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { return null; }
}

function leggiJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function lanciaServer(cartella, args, env) {
  const r = spawnSync(process.execPath, [join('tools', 'server-fondi.js'), ...args], { cwd: cartella, stdio: 'inherit', env });
  return typeof r.status === 'number' ? r.status : 1;
}

/** Il ramo usa-e-getta che contiene solo lo sha verificato di `ramo`: lo crea solo server:fondi, quindi nessuno lo muove. PURA. */
export const nomeRamoFisso = (ramo, sha) => `${ramo}-verificato-${String(sha).slice(0, 12)}`;

function ramoFisso(cartella, ramo, sha) {
  const radice = dirname(cartella);
  const nome = nomeRamoFisso(ramo, sha);
  const fatto = gitEsito(radice, ['push', '--quiet', 'origin', `${sha}:refs/heads/${nome}`]);
  if (!fatto.ok) return { ok: false, motivo: fatto.out };
  return {
    ok: true,
    ramo: nome,
    togli: () => {
      const via = gitEsito(radice, ['push', '--quiet', 'origin', `:refs/heads/${nome}`]);
      gitIn(radice, ['update-ref', '-d', `refs/remotes/origin/${nome}`]);
      return via;
    },
  };
}

/**
 * Lo strumento del server fonde la punta che trova su origin dopo il suo fetch: con un verdetto che comprende il server
 * (#1062) gli si passa un ramo fermo sullo sha verificato, così un push arrivato dopo il controllo resta fuori.
 */
export function lanciaFissato(cartella, ramo, verdetto, env, { lancia, fissa, log, err, prova = false }) {
  const sha = verdetto && verdetto.server ? String(verdetto.server.sha || '') : '';
  const coda = prova ? ['--dry-run'] : [];
  if (!verdetto) return lancia(cartella, [ramo, ...coda], env);
  if (!sha) { err(`server:fondi: la verifica di ${ramo} non comprende commit del server: non fondo una punta che nessuno ha visto.`); return 1; }
  const fisso = fissa(cartella, ramo, sha);
  if (!fisso || !fisso.ok) {
    err(`server:fondi: non riesco a fermare lo sha verificato ${sha.slice(0, 9)} su un ramo suo, e senza non fondo: un push su ${ramo} entrerebbe senza verifica (${String((fisso && fisso.motivo) || '').slice(0, 300)}).`);
    return 1;
  }
  log(`${prova ? 'PROVA sullo' : 'Porto su main lo'} sha verificato ${sha.slice(0, 9)} di ${ramo}: allo strumento del server va ${fisso.ramo}, che contiene solo quello e tolgo alla fine.`);
  try {
    return lancia(cartella, [fisso.ramo, ...coda], env);
  } finally {
    const t = fisso.togli();
    if (t && !t.ok) err(`Non ho tolto ${fisso.ramo} da origin del server (${String(t.out || '').slice(0, 200)}): git push origin :refs/heads/${fisso.ramo}`);
  }
}

function gitEsito(cwd, args) {
  try { return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message || e) };
  }
}

function puntaDelServer(cartella) {
  try { return execFileSync('git', ['rev-parse', 'refs/remotes/origin/main'], { cwd: cartella, encoding: 'utf8' }).trim(); } catch (_) { return ''; }
}

/** main del server letto adesso da origin: sha, null se origin non si legge. */
function mainRemotoServer(cartella) {
  const r = gitEsito(dirname(cartella), ['ls-remote', 'origin', 'refs/heads/main']);
  if (!r.ok) return null;
  const sha = String(r.out).trim().split(/\s+/)[0] || '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function deployDaGitHub(cartella) {
  return gitEsito(cartella, ['cat-file', '-e', 'refs/remotes/origin/main:.github/workflows/deploy.yml']).ok;
}

/** La punta di `ramo` su origin del server, appena letta: '' se su origin il ramo non c'è, null se origin non si legge. */
function puntaRamoServer(cartella, ramo) {
  const radice = dirname(cartella);
  const elenco = gitEsito(radice, ['ls-remote', 'origin', `refs/heads/${ramo}`]);
  if (!elenco.ok) return null;
  if (!String(elenco.out).trim()) return '';
  if (!gitEsito(radice, ['fetch', '--quiet', 'origin', `+refs/heads/${ramo}:refs/remotes/origin/${ramo}`]).ok) return null;
  const r = gitEsito(radice, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ramo}`]);
  return r.ok ? String(r.out).trim() : null;
}

// Uscita di server:fondi quando sul server il ramo non c'è: per un lavoro tutto nell'app non c'è niente da fondere (#1159).
export const USCITA_SOLO_APP = 5;
// La stessa dello strumento del server: un ramo worker/* va in conflitto con main del server, lo riallineano le routine.
export const USCITA_CONFLITTO_MAIN = 6;
// La stessa dello strumento del server: GitHub rifiuta la spinta su main, che dopo il passo 10 scrive solo il cancello.
export const USCITA_SPINTA_RIFIUTATA = 7;

/**
 * La fusione che la spinta dal PC non può più fare la chiede al cancello (#1159 fase 2), sullo stesso sha. A fusione
 * fatta origin/main del server si rilegge e il checkout di main, se c'è, avanza. → codice d'uscita (0 = fuso).
 */
export async function fusioneDalCancello({ cartella, ramo, sha, feedbackId }, { chiedi, allinea = allineaMainServer, log, err }) {
  if (!/^[0-9a-f]{40}$/.test(String(sha || ''))) {
    err(`server:fondi: GitHub rifiuta la spinta su main e non so quale commit di ${ramo} chiedere al cancello. Non ho toccato niente.`);
    return 1;
  }
  log(`main di filo-security lo scrive solo il cancello: gli chiedo di portarci ${String(sha).slice(0, 9)} di ${ramo}.`);
  const { askServerMergeServer, messageForServerMerge } = await import('./lib/owner-merge.mjs');
  const risposta = await (chiedi || askServerMergeServer)({ branch: ramo, sha, feedbackId });
  const riga = messageForServerMerge(risposta, ramo);
  if (risposta.outcome !== 'merged') {
    err(`server:fondi: ${riga}`);
    return risposta.outcome === 'unreachable' ? 4 : 1;
  }
  log(riga);
  allinea(cartella, log);
  return 0;
}

/**
 * Il server registra che main del server su `sha` l'ha portato server:fondi dal PC (#1521): senza la voce, il suo
 * controllo dei riferimenti allarma. Main è già spinto: un no si dice e basta. `prima`: main letto da origin prima di
 * server:fondi; uguale a `sha` vuol dire niente spinto (ramo già dentro), e registrarlo sdoganerebbe chi l'ha portato lì.
 */
export async function registraMainDalPc({ ramo, sha, prima, feedbackId }, { registra, err }) {
  if (!/^[0-9a-f]{40}$/.test(String(sha || ''))) {
    err('Attenzione: non leggo lo sha di main del server dopo la spinta, e il server non sa che l’ha portato server:fondi: aprirà un allarme su main fuori registro, che puoi chiudere.');
    return false;
  }
  if (prima === sha) return false;
  if (!/^[0-9a-f]{40}$/.test(String(prima || ''))) {
    err(`Attenzione: non ho letto main del server prima della fusione, e non so se l’ha mosso questo server:fondi: non lo registro. Se il server apre un allarme su main fuori registro per ${sha.slice(0, 9)} ed è questa spinta, chiudilo.`);
    return false;
  }
  const { registraSpintaServer, messageForServerMerge } = await import('./lib/owner-merge.mjs');
  const risposta = await (registra || registraSpintaServer)({ branch: ramo, sha, feedbackId });
  if (risposta && risposta.outcome === 'registrato') return true;
  err(`Attenzione: main del server è su ${sha.slice(0, 9)}, ma il server non l’ha registrato come portato da server:fondi (${messageForServerMerge(risposta, ramo).replace(/\.$/, '')}). Aprirà un allarme su main fuori registro: se è questa spinta, chiudilo.`);
  return false;
}

/** origin/main del server riletto, e il checkout di main portato lì solo in avanti; un passo che non riesce si dice e basta. */
function allineaMainServer(cartella, log) {
  const radice = dirname(cartella);
  if (!gitEsito(radice, ['fetch', '--quiet', 'origin']).ok) { log('  ! git fetch del server non riuscito: rileggi origin/main quando puoi'); return; }
  const elenco = gitEsito(radice, ['worktree', 'list', '--porcelain']);
  const blocchi = elenco.ok ? String(elenco.out).split(/\r?\n\r?\n/) : [];
  const main = blocchi.find((b) => /^branch refs\/heads\/main\r?$/m.test(b));
  const dove = main ? ((main.match(/^worktree (.+?)\r?$/m) || [])[1] || '') : '';
  if (!dove) return;
  const ff = gitEsito(dove, ['merge', '--ff-only', '--quiet', 'refs/remotes/origin/main']);
  if (!ff.ok) log(`  ! il checkout di main del server (${dove}) non avanza da solo: git merge --ff-only origin/main`);
}

/**
 * Il ramo del server è un lavoro fidato secondo il registro dei rami (#1159, mappa §1.6)? Vale anche per un ramo con
 * voci sporche o un buco; un ramo senza registro passa solo se la pratica non è un lavoro delle routine in attesa del PC
 * (i lavori locali di prima del registro). → { ok:true, sha } (sha = da fondere esattamente, '' = la punta del momento)
 * | { ok:false, codice, motivo }
 */
export async function controllaRamoServer({ ramo, feedbackId, verdetto, cartella }, { lavoroDelRamo, puntaRamo = puntaRamoServer } = {}) {
  const sha = verdetto && verdetto.server && verdetto.server.sha ? String(verdetto.server.sha) : puntaRamo(cartella, ramo);
  if (sha === null) return { ok: false, codice: 4, motivo: `origin del server non si legge, e non so se ${ramo} c'è: controlla la rete e rilancia` };
  if (!sha) {
    return {
      ok: false, codice: USCITA_SOLO_APP, soloApp: true,
      motivo: `su origin del server ${ramo} non c'è: se il lavoro sta tutto nell'app qui non c'è niente da fondere, altrimenti spingilo prima`,
    };
  }
  let r;
  try {
    r = await (lavoroDelRamo || (await import('./lib/biglietto-locale.mjs')).lavoroDelRamo)({ repo: 'server', ramo, sha, feedbackId });
  } catch (e) {
    return { ok: false, codice: 4, motivo: `il registro dei rami non risponde (${String((e && e.message) || e).slice(0, 200)}): senza, un ramo del server non va su main` };
  }
  if (r && r.registro && r.lavoroFidato === true) return { ok: true, sha };
  if (r && r.registro) return { ok: false, codice: 3, motivo: `il ramo ${ramo} del server non è un lavoro fidato: ${r.motivo || 'motivo non detto'}. Decide l’owner` };
  if (r && r.attesa === 'fusione_server') return { ok: false, codice: 3, motivo: `il ramo ${ramo} è di un lavoro delle routine ma non ha registro: nessuno sa chi l’ha scritto. Decide l’owner` };
  return { ok: true, sha: '', legacy: true };
}

/**
 * Tutto il giro; ritorna il codice d'uscita (0 fatto, 1 fermo, 2 uso, 3 pratica rifiutata, 4 server non raggiungibile,
 * 5 ramo assente sul server: USCITA_SOLO_APP).
 * Le dipendenze si iniettano nei test; la rete passa dal fetch globale, come negli strumenti delle pratiche.
 */
export async function esegui(argv, deps = {}) {
  const env = deps.env || process.env;
  const log = deps.log || console.log;
  const err = deps.err || console.error;
  const a = leggiArgomenti(argv, env);
  if (a.errore) { err(`server:fondi: ${a.errore}. ${USO}`); return 2; }
  if (a.nota) log(a.nota);
  if (!a.pratica) { err(SENZA_PRATICA); return 1; }
  if (!a.ramo) { err(`server:fondi: manca il ramo del server (claude/<nome>). ${USO}`); return 2; }
  const cartella = deps.funzioni !== undefined ? deps.funzioni : cartellaDelServer(deps.radice || ROOT);
  if (!cartella) { err('server:fondi: accanto al repo Filo non trovo il checkout del server (cartella filo-security). Non ho toccato niente.'); return 1; }
  // Un ramo dell'app con lo stesso nome ha la sua verifica: il verdetto è di tutti e due, e si fonde solo lo sha
  // verificato (#1062).
  const verdetto = deps.verdetto
    ? deps.verdetto(a.ramo, cartella)
    : (await import('./verify-local.mjs')).verdettoDelRamo(a.ramo, { radice: deps.radice || ROOT, cartellaServer: cartella });
  if (verdetto && !verdetto.ok) {
    err(`server:fondi: ${a.ramo} è un lavoro con l'app, e la sua verifica non regge: ${verdetto.reason}.\nNon ho toccato niente.`);
    return 1;
  }
  // Con un verdetto si fonde solo uno sha che la verifica ha visto: senza, il server prenderebbe la punta del momento.
  if (verdetto && !(verdetto.server && verdetto.server.sha)) {
    err(`server:fondi: ${a.ramo} è un lavoro con l'app, e la sua verifica non comprende commit del server (quando è stata fatta il ramo del server non c'era, o era già su main): non c'è niente di verificato da portare su main. Se il lavoro sul server è nato dopo, serve una verifica che lo comprenda (dal checkout dell'app: node scripts/verify-local.mjs start).\nNon ho toccato niente.`);
    return 1;
  }
  if (verdetto) log(`Verifica del lavoro: ${verdetto.reason}.`);

  const of = await import('./owner-feedback.mjs');
  let bearer = deps.bearer;
  let base = deps.base;
  try {
    if (!bearer || !base) {
      const auth = await import('./lib/firestore-auth.mjs');
      bearer = bearer || await auth.acquireBearer();
      base = base || auth.FIRESTORE_BASE;
    }
    const r = await risolviFeedback(a.pratica, { bearer, base });
    if (!r.ok) { err(`Pratica non trovata: ${r.motivo}. Non ho toccato niente.`); return 3; }
    const chi = r.seq ? `#${r.seq}` : r.id;
    const lav = await of.praticaPerLaSessione(r.id, { bearer });
    if (!lav.ok) { err(`${of.rifiutoPratica(a.pratica, lav)}\nNon ho toccato niente.`); return 3; }
    // §1.6: un lavoro sul server dev'essere fidato. server:fondi spinge main senza L5 né server: il controllo sta qui.
    // Campo che la migrazione non ha ancora scritto: vale la regola di prima, il mittente provato che localSenderCheck ha
    // già controllato (decisione dell'owner, 11/10). Senza, la fusione del server di #1148 aspetterebbe la sua stessa migrazione.
    if (lav.fiducia !== 'fidato' && !lav.primaDellaMigrazione) {
      err(`La pratica ${chi} non è fidata: un lavoro sul server si fonde solo su una pratica fidata. La segna fidata l’owner, in Gestione, dopo averne letto il testo. Non ho toccato niente.`);
      return 3;
    }
    const ramoServer = await controllaRamoServer({ ramo: a.ramo, feedbackId: r.id, verdetto, cartella }, { lavoroDelRamo: deps.lavoroDelRamo, puntaRamo: deps.puntaRamo });
    if (!ramoServer.ok) { err(`server:fondi: ${ramoServer.motivo}. Non ho toccato niente.`); return ramoServer.codice; }
    if (ramoServer.legacy) log(`Il ramo ${a.ramo} non ha un registro: lavoro locale di prima del registro dei rami, vale la fiducia della pratica.`);
    // Il registro garantisce uno sha: si fonde quello, anche senza una verifica locale (#1062, #1159).
    const daFondere = verdetto || (ramoServer.sha ? { ok: true, server: { sha: ramoServer.sha } } : null);
    const letta = await of.partiDellaPratica(r.id, { bearer });
    if (!letta.ok) { err(`La pratica ${chi} non si legge (${letta.motivo}). Non ho toccato niente.`); return 3; }
    // Un ramo dell'app legato e fuori da main vince sul registro: è un seguito, o la pratica è stata riaperta.
    const ramiApp = (deps.ramiAperti || ramiApertiDellaPratica)(r.id, { ramoGemello: a.ramo });
    // Chiusa dalla fusione dell'app dello stesso lavoro, da poco: questa è l'ultima parte (#915), salvo che dell'app
    // arrivi ancora un ramo: lasciata chiusa, la pratica lo rifiuterebbe, quindi si riapre, anche per un seguito (#938).
    let tardiva = null;
    let riapertaDa = null;
    if (letta.status === 'done') {
      const caso = {
        status: letta.status, parti: letta.parti, parte: 'server', ramo: a.ramo, solo: a.soloServer, locale: letta.locale, ora: (deps.ora || Date.now)(),
      };
      const t = ramiApp.length ? riaperturaConAltraInArrivo(caso) : parteTardiva(caso);
      if (!t.ok) { err(`La pratica ${chi} è chiusa e non vale per questo ramo: ${t.motivo}. Per un lavoro nuovo aprine una. Non ho toccato niente.`); return 3; }
      if (ramiApp.length) {
        const prova = await of.scrivi(r.id, 'todo', '', { bearer, dryRun: true });
        if (!prova.ok) { err(`La pratica ${chi} è chiusa e ${ramiApp.join(', ')} dell'app, legato a lei, non è su main, ma non si riapre (${prova.motivo}). Non ho toccato niente.`); return 3; }
        riapertaDa = t;
      } else tardiva = t;
    } else {
      // La stessa presa in carico della verifica: rifiuta una pratica nei Ricevuti prima di muovere il server.
      const prova = await of.annotaPratica(r.id, notaInizio(a.ramo), { bearer, dryRun: true });
      if (!prova.ok) { err(`La pratica ${chi} non porta un lavoro (${prova.motivo}): per un lavoro nuovo aprine una. Non ho toccato niente.`); return 3; }
    }
    const figlio = { ...env, [PRATICA_ENV]: chi };
    const lancia = deps.lancia || lanciaServer;
    // La parte dell'app già su main: questa è l'ultima. Altrimenti l'app può ancora arrivare, anche da un ramo che da
    // qui non si vede, e la pratica si chiude solo a parola (--solo-server), che resta scritta per chi arrivasse dopo.
    const ultima = !!letta.parti.app && !ramiApp.length;
    const solo = a.soloServer && !ultima && !tardiva;
    const chiude = !tardiva && (ultima || solo);
    const quando = tardiva || riapertaDa ? new Date((tardiva || riapertaDa).at).toISOString() : '';
    const perche = `l'aveva chiusa la fusione della parte ${NOME_PARTE[(riapertaDa && riapertaDa.chiusaDa) || 'app']} (${quando}), ma ${ramiApp.join(', ')} dell'app è legato a questa pratica e non è su main. Le parti già su main ripartono da zero.`;
    const numero = chi.replace(/^#/, '');
    const chiudeApp = `la chiude la fusione di ${ramiApp.length ? ramiApp.join(', ') : 'quella parte'} (npm run finish -- --feedback ${numero})`;
    const soloComando = `npm run server:fondi -- ${a.ramo} --feedback ${numero} --solo-server`;
    // Ci si ferma prima di fondere: dopo, la pratica sarebbe chiusa e il rilancio senza --solo-server rifiutato.
    if (solo && ramiApp.length) {
      err([
        `Dici che il lavoro sta solo sul server, ma ${ramiApp.join(', ')} dell'app è legato a questa pratica e non è su main.`,
        `Se è di questo lavoro, rilancia senza --solo-server: ${soloComando.replace(/ --solo-server$/, '')}`,
        'Se non lo è, legalo alla sua pratica (dal suo checkout: node scripts/verify-local.mjs start --feedback <N>) e rilancia questo comando. Non ho toccato niente.',
      ].join('\n'));
      return 1;
    }
    const dopo = tardiva
      ? `resterebbe chiusa, con la nota di quest'ultima parte (l'ha chiusa la fusione della parte ${NOME_PARTE.app}, ${quando})`
      : chiude
        ? `si chiuderebbe con «${notaFine(a.ramo, '')}»`
        : `resterebbe aperta: manca la parte ${NOME_PARTE.app}, ${chiudeApp}${ramiApp.length ? '' : `. Se il lavoro sta solo sul server: ${soloComando}`}`;
    // La prova guarda lo stesso sha che fonderebbe la fusione vera, non la punta del ramo.
    const fissate = { lancia, fissa: deps.fissa || ramoFisso, log, err };
    if (a.dryRun) {
      const k = lanciaFissato(cartella, a.ramo, daFondere, figlio, { ...fissate, prova: true });
      log(tardiva
        ? `PROVA: la pratica ${chi} non si riapre e, a fusione riuscita, ${dopo}.`
        : riapertaDa
          ? `PROVA: la pratica ${chi} è chiusa, ma ${ramiApp.join(', ')} dell'app le è legato e non è su main: si riaprirebbe, andrebbe in lavorazione e, a fusione riuscita, ${dopo}.`
          : `PROVA: la pratica ${chi} andrebbe in lavorazione e, a fusione riuscita, ${dopo}.`);
      return k;
    }
    if (tardiva) {
      log(`Pratica ${chi}: l'ha chiusa la fusione della parte ${NOME_PARTE.app} (${quando}), meno di ${FINESTRA_PARTE_TARDIVA_MS / 3600000} ore fa: vale per quest'ultima parte.`);
    } else {
      if (riapertaDa) {
        const riaperta = await of.scrivi(r.id, 'todo', `Riaperta da server:fondi su ${a.ramo}: ${perche}`, { bearer });
        if (!riaperta.ok) { err(`La pratica ${chi} non si è riaperta (${riaperta.motivo}): non porto il ramo su main senza.`); return 1; }
        log(`Pratica ${chi} riaperta: ${perche}`);
      }
      const presa = await of.annotaPratica(r.id, notaInizio(a.ramo), { bearer });
      if (!presa.ok) { err(`Pratica ${chi} non aggiornata (${presa.motivo}): non porto il ramo su main senza.`); return 1; }
      log(`Pratica ${chi}: ${presa.from === presa.to ? 'giro annotato' : 'presa in carico («In lavorazione»)'}.`);
    }
    const mainPrima = (deps.mainPrima || mainRemotoServer)(cartella);
    let k = lanciaFissato(cartella, a.ramo, daFondere, figlio, fissate);
    const dalPc = k === 0;
    if (k === USCITA_SPINTA_RIFIUTATA) {
      const shaCancello = (daFondere && daFondere.server && daFondere.server.sha) || (deps.puntaRamo || puntaRamoServer)(cartella, a.ramo) || '';
      k = await fusioneDalCancello({ cartella, ramo: a.ramo, sha: shaCancello, feedbackId: r.id }, { chiedi: deps.chiediAlCancello, allinea: deps.allinea, log, err });
    }
    if (k === USCITA_CONFLITTO_MAIN && !tardiva) {
      err(`main del server non si è mosso. La pratica ${chi} torna alle routine per il riallineamento al giro del PC (npm run orchestra -- fusioni-server).`);
      return k;
    }
    if (k !== 0) {
      if (tardiva) { err(`main del server non si è mosso, e la pratica ${chi} resta chiusa com'era: sistema e rilancia lo stesso comando.`); return k; }
      await of.annotaPratica(r.id, `server:fondi si è fermato (uscita ${k}) su ${a.ramo}: main del server non si è mosso.`, { bearer }).catch(() => null);
      err(`La pratica ${chi} resta in lavorazione: sistema e rilancia lo stesso comando.`);
      return k;
    }
    const sha = (deps.punta || puntaDelServer)(cartella);
    const verificato = daFondere && daFondere.server ? daFondere.server.sha : '';
    if (verificato && sha && sha !== verificato) {
      err(`Attenzione: main del server è su ${sha.slice(0, 9)}, non sullo sha verificato ${verificato.slice(0, 9)}: il ramo si è mosso fra il controllo e la fusione.`);
    }
    // La fusione chiesta al cancello la registra il server; la spinta dal PC la dice questo passo.
    if (dalPc) await registraMainDalPc({ ramo: a.ramo, sha, prima: mainPrima, feedbackId: r.id }, { registra: deps.registraMain, err });
    const parte = await of.registraParte(r.id, 'server', { bearer, solo, ramo: a.ramo });
    if (!parte.ok) err(`La pratica ${chi} non ha registrato che la parte del server è su main (${parte.motivo}): una parte dell'app che arrivasse a pratica chiusa non la troverebbe.`);
    const daGitHub = (deps.deployDaGitHub || deployDaGitHub)(cartella);
    if (tardiva) {
      const nota = `${notaFine(a.ramo, sha, daGitHub)} Era l'ultima parte: la pratica l'aveva chiusa la fusione della parte ${NOME_PARTE.app} dello stesso lavoro (${quando}), e resta chiusa.`;
      const annotata = await of.scrivi(r.id, 'done', nota, { bearer, attore: 'routine' });
      if (!annotata.ok) err(`${a.ramo} è su main del server, ma la pratica ${chi} non l'ha annotato (${annotata.motivo}).`);
      log(`${a.ramo} è su main del server. La pratica ${chi} resta chiusa, con la nota di quest'ultima parte. ${perIlDeploy(daGitHub)}`);
      return annotata.ok ? 0 : 1;
    }
    if (!chiude) {
      const nota = `${notaFine(a.ramo, sha, daGitHub)} La pratica resta aperta: manca la parte ${NOME_PARTE.app}, non ancora su main, e ${chiudeApp}.${ramiApp.length ? '' : ` Se il lavoro stava solo sul server: ${soloComando}.`}`;
      const annotata = await of.annotaPratica(r.id, nota, { bearer });
      if (!annotata.ok) err(`${a.ramo} è su main del server, ma la pratica ${chi} non l'ha registrato (${annotata.motivo}).`);
      log(`${a.ramo} è su main del server. La pratica ${chi} resta aperta: manca la parte ${NOME_PARTE.app}, ${chiudeApp}.`);
      // Con un ramo dell'app legato --solo-server si rifiuta: consigliarlo manderebbe in un vicolo.
      if (!ramiApp.length) log(`Se il lavoro stava solo sul server, chiudila con: ${soloComando}`);
      log(perIlDeploy(daGitHub));
      return annotata.ok ? 0 : 1;
    }
    const notaChiusura = solo ? `${notaFine(a.ramo, sha, daGitHub)} Il lavoro stava solo sul server (--solo-server).` : notaFine(a.ramo, sha, daGitHub);
    const chiusa = await of.scrivi(r.id, 'done', notaChiusura, { bearer, attore: 'routine' });
    if (!chiusa.ok) {
      err(`${a.ramo} è su main del server, ma la pratica ${chi} non si è chiusa (${chiusa.motivo}). Chiudila a mano:\n  npm run feedback -- ${r.id} done "${notaChiusura}" --come-routine`);
      return 1;
    }
    log(`Pratica ${chi} chiusa: ${a.ramo} è su main del server. ${perIlDeploy(daGitHub)}`);
    const frase = await of.fraseDaScrivere(r.id, chi, { bearer });
    if (frase) log(frase);
    return 0;
  } catch (e) {
    err(`Server dei feedback non raggiungibile: ${String((e && e.message) || e).slice(0, 200)}`);
    return 4;
  }
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(await esegui(process.argv.slice(2)));
}
