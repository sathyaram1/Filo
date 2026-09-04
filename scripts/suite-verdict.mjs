#!/usr/bin/env node
// suite-verdict.mjs — pubblica e rilegge il verdetto della suite completa.
//
// PERCHÉ ESISTE
//   La suite completa gira su GitHub Actions (workflow `suite.yml`). Chi deve
//   sapere com'è andata — il verificatore in cloud, il cancello di fusione, una
//   sessione locale — sta ALTROVE, e deve poterlo chiedere senza rilanciare
//   venticinque minuti di test.
//
//   Il verdetto non può viaggiare sulle API di GitHub: nell'ambiente delle
//   routine le chiamate REST al repo sono chiuse (verificato sul campo:
//   `api.github.com/repos/...` risponde "GitHub access is not enabled for this
//   session"). Quello che invece funziona sempre, perché è il trasporto stesso
//   del lavoro, è **git**. Quindi il verdetto viaggia come un ref git:
//
//       refs/suite/<ramo>     →  un commit con dentro un solo file, verdetto.json
//
//   Fuori da `refs/heads/*`: non è un ramo, non finisce nella lista dei rami,
//   non tocca `main` e non accende nessun workflow (i push su ref che non sono
//   rami non fanno scattare `on: push`).
//
//   Un ref per RAMO, riscritto a ogni giro, non uno per commit: i commit di un
//   ramo di lavoro sono decine (il salvataggio automatico committa a ogni
//   modifica di file) e lascerebbero dietro una scia di ref morti. Il commit a
//   cui il verdetto si riferisce sta DENTRO il verdetto: chi legge confronta,
//   e un verdetto di un altro commit vale quanto un verdetto assente.
//
// USO
//   node scripts/suite-verdict.mjs pubblica --ramo <ramo> --sha <sha> \
//        --stato in-corso|finito [--esito <file.json>] [--run <url>]
//   node scripts/suite-verdict.mjs leggi [--ramo <ramo>] [--sha <sha>] [--attendi <minuti>]
//
//   Exit code di `leggi` (è questo il contratto per chi lo chiama):
//     0  VERDE      — nessun rosso fuori dalla lista dei rossi noti
//     1  ROSSA      — con l'elenco degli spec da rilanciare
//     2  IN CORSO   — la suite sta ancora girando su questo commit
//     3  ASSENTE    — nessun verdetto per questo commit (non è partita, o è
//                     morta, o il verdetto è di un altro commit)
//     4  GUASTO     — non si riesce nemmeno a chiedere (git, rete)
//
//   ASSENTE e IN CORSO non sono un verde e non sono un rosso: chi legge decide
//   (aspettare ancora, oppure lanciarsi la suite da sé). Non trattarli mai come
//   un verde è l'unica regola dura: "non lo so" non è "a posto".
//
//   Contano come ASSENTI, e non come verdi, anche i due modi in cui "non lo so"
//   si traveste da risposta: un verdetto che non dice su quale commit è stato
//   eseguito, e una domanda che non dice quale commit interessa.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedRepoRoot } from './lib/tools-pin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Nelle routine questo script gira dalla COPIA fissata degli strumenti, che sta
// fuori dal progetto e non è nemmeno un repo git: senza `pinnedRepoRoot` ogni
// comando git finirebbe nella cartella sbagliata e il verdetto risulterebbe
// sempre assente. `FILO_REPO_ROOT` resta l'override dei test.
export const REPO_ROOT = process.env.FILO_REPO_ROOT
  ? resolve(process.env.FILO_REPO_ROOT)
  : (pinnedRepoRoot() || resolve(__dirname, '..'));

export const NOME_FILE = 'verdetto.json';

// ─── logica pura ─────────────────────────────────────────────────────────────

/**
 * Il nome del ref che porta il verdetto di un ramo. PURA.
 *
 * Due cose insieme, e servono entrambe:
 *
 * · le barre del nome del ramo diventano `__`, perché `refs/suite/worker/7` e
 *   `refs/suite/worker` non possono coesistere in git (una directory non può
 *   essere anche un file), e con nomi di ramo generati da una macchina quella
 *   collisione arriva — come un push che fallisce senza che nessuno capisca
 *   perché;
 * · in coda ci va l'impronta del nome VERO. Senza, la ripulitura è una funzione
 *   che perde informazione: `lavoro/a b` e `lavoro/a-b` finiscono sullo stesso
 *   ref, e il verdetto di un ramo diventa il verdetto dell'altro — cioè
 *   esattamente il "verde ereditato" che tutto questo meccanismo esiste per
 *   impedire. Con l'impronta, due nomi diversi non possono più incontrarsi.
 */
export function chiaveRef(ramo) {
  const nome = String(ramo || '').trim();
  if (!nome) return '';
  const pulito = nome.replace(/[\\/]/g, '__').replace(/[^A-Za-z0-9._-]/g, '-');
  const impronta = createHash('sha1').update(nome).digest('hex').slice(0, 8);
  return `refs/suite/${pulito}-${impronta}`;
}

/** Un ramo utilizzabile: non vuoto, niente `HEAD` staccato. PURA. */
export function ramoValido(ramo) {
  const r = String(ramo || '').trim();
  return r.length > 0 && r !== 'HEAD';
}

/**
 * Che cosa dice il verdetto trovato, rispetto al commit che ci interessa. PURA.
 *
 * Ritorna `{ esito, testo }` con esito in
 * `verde | rossa | in-corso | altro-commit | assente`.
 *
 * ⚠️ La regola dura — «un verdetto vale solo per il commit che ha provato» — ha
 * avuto per un po' dentro l'eccezione che la annullava: il confronto si faceva
 * solo se il verdetto PORTAVA un commit, e un verdetto senza commit passava per
 * buono su qualunque punta. Ci si arriva pubblicando da fuori una copia git
 * (`shaCorrente()` torna vuoto), che è proprio la situazione descritta qui
 * sotto. Un verdetto che non dice a quale commit si riferisce, o una domanda che
 * non dice quale commit interessa, valgono come verdetto ASSENTE.
 */
export function interpreta(verdetto, shaAtteso, ramoAtteso) {
  if (!verdetto || typeof verdetto !== 'object') {
    return { esito: 'assente', testo: 'Nessun verdetto della suite per questo ramo.' };
  }
  const sha = String(verdetto.sha || '');
  const atteso = String(shaAtteso || '');
  if (!sha) {
    return {
      esito: 'assente',
      testo: 'Il verdetto trovato non dice su quale commit è stata eseguita la suite: vale come un verdetto assente.',
    };
  }
  if (!atteso) {
    return {
      esito: 'assente',
      testo: 'Non so quale commit stai guardando, quindi non posso dire che il verdetto sia il suo.',
    };
  }
  if (sha !== atteso) {
    return {
      esito: 'altro-commit',
      testo: `Il verdetto disponibile è del commit ${sha.slice(0, 12)}, non di ${atteso.slice(0, 12)}: `
        + 'la suite non ha ancora detto niente su quello che stai guardando.',
    };
  }
  // Il ramo dentro il verdetto è la seconda serratura del ref: se un giorno due
  // rami finissero sullo stesso ref, il verdetto dell'uno non deve poter valere
  // per l'altro.
  const ramo = String(verdetto.ramo || '');
  if (ramoAtteso && ramo && ramo !== String(ramoAtteso)) {
    return {
      esito: 'assente',
      testo: `Il verdetto trovato è del ramo ${ramo}, non di ${ramoAtteso}: vale come un verdetto assente.`,
    };
  }
  if (verdetto.stato !== 'finito') {
    return { esito: 'in-corso', testo: `Suite in corso su ${sha.slice(0, 12) || 'questo commit'}${verdetto.run ? ` (${verdetto.run})` : ''}.` };
  }
  if (verdetto.verde === true) {
    return { esito: 'verde', testo: String(verdetto.riassunto || 'Suite completa verde.') };
  }
  return { esito: 'rossa', testo: String(verdetto.riassunto || 'Suite completa rossa.') };
}

/** Dall'esito al codice d'uscita del contratto. PURA. */
export function exitCodeFor(esito) {
  if (esito === 'verde') return 0;
  if (esito === 'rossa') return 1;
  if (esito === 'in-corso') return 2;
  if (esito === 'assente' || esito === 'altro-commit') return 3;
  return 4;
}

/** Il corpo del verdetto che finisce nel ref. PURA. */
export function componiVerdetto({ sha, ramo, stato, run, esito }) {
  const e = esito || {};
  return {
    sha: String(sha || ''),
    ramo: String(ramo || ''),
    stato: stato === 'finito' ? 'finito' : 'in-corso',
    quando: new Date().toISOString(),
    run: run ? String(run) : '',
    verde: stato === 'finito' ? e.verde === true : null,
    eseguiti: Number(e.eseguiti || 0),
    rossi: Array.isArray(e.rossi) ? e.rossi : [],
    riassunto: String(e.riassunto || ''),
  };
}

// ─── git ─────────────────────────────────────────────────────────────────────

function git(args, { input, cwd } = {}) {
  return execFileSync('git', args, {
    cwd: cwd || REPO_ROOT,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function gitZitto(args, opts) {
  try { return { ok: true, out: git(args, opts) }; }
  catch (e) { return { ok: false, out: String((e && e.stderr) || (e && e.message) || '') }; }
}

/** Il ramo su cui siamo adesso (o quello passato). */
export function ramoCorrente() {
  try { return git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(); } catch (_) { return ''; }
}

/** Il commit su cui siamo adesso (o quello passato). */
export function shaCorrente() {
  try { return git(['rev-parse', 'HEAD']).trim(); } catch (_) { return ''; }
}

/**
 * Scrive il verdetto come commit orfano e lo spedisce sul ref del ramo.
 *
 * Plumbing di proposito: `hash-object` + `mktree` + `commit-tree` non toccano
 * l'indice né la copia di lavoro. Farlo con un checkout, dentro il workflow che
 * ha appena eseguito la suite, vorrebbe dire spostare i file sotto i piedi agli
 * artefatti appena prodotti.
 */
export function pubblica({ ramo, sha, stato, run, esito }) {
  const ref = chiaveRef(ramo);
  if (!ref) throw new Error('ramo mancante: non so su quale ref pubblicare');
  // Un verdetto senza commit non è pubblicabile: chi lo rilegge lo tratta come
  // assente (vedi `interpreta`), quindi pubblicarlo servirebbe solo a
  // sovrascrivere un verdetto buono con uno inutile.
  if (!String(sha || '').trim()) throw new Error('commit mancante: un verdetto che non dice cosa ha provato non vale per nessuna punta');
  const corpo = `${JSON.stringify(componiVerdetto({ sha, ramo, stato, run, esito }), null, 2)}\n`;
  const blob = git(['hash-object', '-w', '--stdin'], { input: corpo }).trim();
  const tree = git(['mktree'], { input: `100644 blob ${blob}\t${NOME_FILE}\n` }).trim();
  const commit = git([
    '-c', 'user.email=suite@filo.local',
    '-c', 'user.name=suite',
    'commit-tree', tree, '-m', `suite ${stato} ${String(sha).slice(0, 12)}`,
  ]).trim();
  // Destinazione ESPLICITA (`<src>:<dst>`): è la forma che la sentinella degli
  // script pretende, ed è anche l'unica che dice a chi legge dove va a finire.
  git(['push', '--force', 'origin', `${commit}:${ref}`]);
  return { ref, commit };
}

/** Rilegge il verdetto dal ref (scaricandolo da origin). `null` se non c'è. */
export function leggiVerdetto(ramo) {
  const ref = chiaveRef(ramo);
  if (!ref) return null;
  const preso = gitZitto(['fetch', '--force', 'origin', `+${ref}:${ref}`]);
  if (!preso.ok) {
    // Il ref può non esistere ancora (suite mai partita su questo ramo): non è
    // un guasto, è un "niente da leggere".
    if (/couldn't find remote ref|not our ref|does not exist/i.test(preso.out)) return null;
    // Qualunque altra cosa (rete, credenziali) è un guasto vero.
    throw new Error(preso.out.trim().split('\n').slice(-1)[0] || 'fetch fallito');
  }
  const letto = gitZitto(['show', `${ref}:${NOME_FILE}`]);
  if (!letto.ok) return null;
  try { return JSON.parse(letto.out); } catch (_) { return null; }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = { comando: '', ramo: '', sha: '', stato: '', esito: '', run: '', attendi: 0, unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--ramo') out.ramo = argv[++i] || '';
    else if (a === '--sha') out.sha = argv[++i] || '';
    else if (a === '--stato') out.stato = argv[++i] || '';
    else if (a === '--esito') out.esito = argv[++i] || '';
    else if (a === '--run') out.run = argv[++i] || '';
    else if (a === '--attendi') out.attendi = Number(argv[++i] || 0) || 0;
    else if (typeof a === 'string' && a.startsWith('-')) out.unknown.push(a);
    else if (!out.comando) out.comando = a;
    else out.unknown.push(a);
  }
  return out;
}

const dormi = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.unknown.length) { console.error(`opzioni sconosciute: ${a.unknown.join(' ')}`); process.exit(4); }

  if (a.comando === 'pubblica') {
    const ramo = a.ramo || ramoCorrente();
    const sha = a.sha || shaCorrente();
    let esito = {};
    if (a.esito && existsSync(resolve(a.esito))) {
      try { esito = JSON.parse(readFileSync(resolve(a.esito), 'utf8')); } catch (_) { esito = {}; }
    }
    // Nessun esito da allegare a una suite "finita" vuol dire che la corsa è
    // morta prima di produrre un verbale (installazione fallita, macchina
    // caduta). Non è un verde, e chi legge deve capire PERCHÉ senza andare a
    // rovistare nei log del workflow.
    if (a.stato === 'finito' && !esito.riassunto) {
      esito = {
        ...esito,
        verde: esito.verde === true,
        riassunto: esito.verde === true
          ? 'Suite completa verde.'
          : 'La suite non ha prodotto nessun verbale: la corsa è finita senza eseguire i test. Non è un verde.',
      };
    }
    try {
      const { ref } = pubblica({ ramo, sha, stato: a.stato || 'in-corso', run: a.run, esito });
      console.log(`[suite-verdict] verdetto "${a.stato || 'in-corso'}" pubblicato su ${ref} (${String(sha).slice(0, 12)})`);
      process.exit(0);
    } catch (e) {
      console.error(`[suite-verdict] pubblicazione fallita: ${e.message}`);
      process.exit(4);
    }
  }

  if (a.comando === 'leggi') {
    const ramo = a.ramo || ramoCorrente();
    const sha = a.sha || shaCorrente();
    if (!ramoValido(ramo)) {
      console.error('[suite-verdict] non so su quale ramo guardare (HEAD staccato?): passa --ramo');
      process.exit(4);
    }
    // Senza sapere QUALE commit si sta guardando, nessuna risposta vale: un
    // verde che non si riferisce a una punta precisa è il verde di chiunque.
    // Meglio dirlo come guasto qui che restituire un "assente" che sembra
    // "aspetta ancora".
    if (!sha) {
      console.error('[suite-verdict] non so quale commit guardare (la cartella non è una copia git?): passa --sha');
      process.exit(4);
    }
    const scadenza = Date.now() + Math.max(0, a.attendi) * 60_000;
    for (;;) {
      let letto;
      try { letto = leggiVerdetto(ramo); }
      catch (e) { console.error(`[suite-verdict] non riesco a chiedere: ${e.message}`); process.exit(4); }
      const { esito, testo } = interpreta(letto, sha, ramo);
      const finito = esito === 'verde' || esito === 'rossa';
      if (finito || Date.now() >= scadenza) {
        console.log(`[suite-verdict] ${esito.toUpperCase()} — ${testo}`);
        process.exit(exitCodeFor(esito));
      }
      console.log(`[suite-verdict] ${esito} — riprovo fra 30s (${Math.round((scadenza - Date.now()) / 60000)} min di attesa rimasti)`);
      await dormi(30_000);
    }
  }

  console.error('uso: node scripts/suite-verdict.mjs <pubblica|leggi> [opzioni]');
  process.exit(4);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
