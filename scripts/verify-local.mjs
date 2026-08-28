// verify-local.mjs — la verifica avversariale, anche in sessione locale.
//
// PERCHÉ ESISTE
//   In cloud, prima che una modifica arrivi agli utenti, un'istanza DIVERSA da
//   quella che ha scritto il codice prova a romperla. Non vede il diff e non
//   legge il report di chi ha lavorato: vede solo cosa era stato chiesto, e
//   giudica se adesso l'utente ottiene quella cosa. È l'unico controllo che
//   trova i lavori "verdi ma sbagliati" — quelli in cui i test passano perché
//   li ha scritti chi ha anche scritto il bug.
//
//   In locale quel passaggio non esisteva: si lanciavano i test e si pubblicava.
//   I test però li scrive la stessa istanza che ha fatto il lavoro, quindi
//   condividono i suoi punti ciechi. Da qui in poi anche in locale si passa di
//   qui, e `npm run finish` non pubblica senza un esito positivo.
//
// COME SI USA (tre comandi, in quest'ordine)
//
//   node scripts/verify-local.mjs start "<cosa aveva chiesto l'owner>"
//     Registra la richiesta di verifica per il ramo corrente e STAMPA il testo
//     da consegnare a un'istanza NUOVA. Quel testo contiene la richiesta e il
//     ramo, MAI il diff né il report: è l'isolamento che rende la verifica
//     avversariale invece di una rilettura compiacente.
//
//   node scripts/verify-local.mjs pass "<cosa ha provato e com'è andata>"
//   node scripts/verify-local.mjs fail "<cosa NON funziona, in concreto>"
//     Lo lancia l'istanza che ha verificato, non chi ha scritto il codice.
//
//   node scripts/verify-local.mjs status
//     Esito per il ramo corrente. Exit 0 = si può pubblicare.
//
// L'ESITO È LEGATO AL CONTENUTO, NON AL RAMO
//   Il verdetto vale per il commit su cui è stato dato. Se dopo il PASS si
//   tocca ancora il codice, il verdetto decade e va rifatto: altrimenti
//   basterebbe farsi approvare una versione e pubblicarne un'altra.
//
// DOVE VIVE
//   `.claude/verify-local.json`, effimero e gitignorato come gli altri
//   marcatori di sessione: riguarda questa macchina e questo momento.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : resolve(__dirname, '..');

export function stateFile(root = ROOT) {
  return resolve(root, '.claude', 'verify-local.json');
}

// ─── Logica pura (testata in tests/unit/verifyLocal.test.mjs) ────────────────

/**
 * La verifica registrata copre il contenuto che si sta per pubblicare?
 * Ritorna { ok, reason } — `reason` è già la frase da mostrare a chi pubblica.
 *
 * Casi di NO, tutti e tre reali:
 *   - nessuno ha mai verificato questo ramo;
 *   - qualcuno ha verificato e ha bocciato;
 *   - qualcuno ha verificato e ha approvato, ma POI il codice è cambiato → il
 *     verdetto riguarda una versione che non è quella che uscirebbe.
 */
export function checkVerdict(entry, headSha, dirty = false) {
  if (!entry || (!entry.verdict && !entry.request)) {
    return { ok: false, reason: 'nessuna verifica avviata per questo lavoro' };
  }
  if (!entry.verdict) {
    // Distinguere questo dal caso sopra evita mezz'ora persa a rilanciare
    // `start` quando il pezzo che manca è il verdetto di chi doveva verificare.
    return { ok: false, reason: 'verifica avviata ma senza esito: chi doveva verificare non ha ancora registrato pass o fail' };
  }
  if (entry.verdict !== 'pass') {
    return { ok: false, reason: `la verifica ha bocciato il lavoro: ${entry.critique || '(nessuna critica registrata)'}` };
  }
  if (!headSha || entry.sha !== headSha) {
    return { ok: false, reason: 'il codice è cambiato dopo la verifica: l’esito riguarda una versione diversa da quella che pubblicheresti' };
  }
  // Il confronto sopra guarda l'ULTIMO SALVATAGGIO, e le modifiche non ancora
  // salvate non lo spostano: senza questo, si può far approvare una versione,
  // modificare i file e vedersi dire ancora "verifica superata". È successo
  // davvero, su questo stesso lavoro.
  if (dirty) {
    return { ok: false, reason: 'ci sono modifiche non salvate: la verifica riguarda il codice com’era, non com’è adesso' };
  }
  return { ok: true, reason: 'verifica superata su questo contenuto' };
}

/** Registra l'avvio di una verifica (nessun verdetto ancora). PURA. */
export function withRequest(state, branch, { request, sha, at }) {
  const s = (state && typeof state === 'object') ? { ...state } : {};
  s[branch] = { request: String(request || ''), requestedSha: sha || '', requestedAt: at || new Date().toISOString() };
  return s;
}

/** Registra un verdetto sul contenuto `sha`. PURA. */
export function withVerdict(state, branch, { verdict, critique, sha, at }) {
  const s = (state && typeof state === 'object') ? { ...state } : {};
  const prev = s[branch] || {};
  s[branch] = {
    ...prev,
    verdict: verdict === 'pass' ? 'pass' : 'fail',
    critique: String(critique || '').slice(0, 4000),
    sha: sha || '',
    at: at || new Date().toISOString(),
  };
  return s;
}

// ─── Riallineamento alla linea principale (caso #500) ───────────────────────
//
// Un ramo che resta indietro mentre aspetta verifica e approvazione finisce in
// conflitto di fusione, e quel conflitto salterebbe fuori solo DOPO i controlli
// o dopo l'approvazione dell'owner. Il riallineamento si fa QUI, all'inizio
// della verifica: così verifica e chiusura girano già sul contenuto allineato,
// e lo sha approvato è quello che si pubblica.

/**
 * Cosa fare col ramo prima di avviare la verifica. PURA.
 *
 * `ahead` non conta: i commit propri il rebase li riporta sopra da solo, e un
 * ramo solo avanti (behind = 0) non ha niente da riallineare. Ogni astensione
 * che nasconde un ramo indietro va DETTA: un salto silenzioso è
 * indistinguibile dal non avere il riallineamento.
 */
export function realignPlan({ fetchOk, dirty, behind, workBranch = true }) {
  // I rami protetti non li tocca nessun automatismo (regola del repo), e lì
  // non c'è niente da dire: su quei rami non si chiude nessun lavoro.
  if (!workBranch) return { action: 'skip', message: '' };
  if (!fetchOk) {
    return {
      action: 'skip',
      message: 'Non raggiungo origin, quindi non so se il ramo è rimasto indietro: se la chiusura poi si ferma per questo, riprova con la rete.',
    };
  }
  const n = Number(behind);
  if (!Number.isFinite(n) || n <= 0) return { action: 'skip', message: '' };
  if (dirty) {
    return {
      action: 'skip',
      message: `Il ramo è indietro di ${n} commit rispetto alla linea principale, ma ci sono modifiche non salvate: non lo tocco. Falle salvare e rilancia, così la verifica parte dal contenuto riallineato.`,
    };
  }
  return { action: 'rebase', message: '' };
}

/**
 * L'esito del rebase → cosa fare. PURA.
 *
 * `abort` significa: il repo torna ESATTAMENTE com'era. Un rebase lasciato a
 * metà blocca ogni comando git successivo, compreso il salvataggio automatico:
 * peggio del conflitto stesso.
 */
export function afterRebase({ ok, behind = 0, conflictFiles = [] }) {
  if (ok) {
    return {
      action: 'push',
      message: `Il ramo era indietro di ${behind} commit rispetto alla linea principale: l'ho riallineato e lo rispedisco. La verifica parte dal contenuto aggiornato.`,
    };
  }
  const files = (Array.isArray(conflictFiles) ? conflictFiles : []).filter(Boolean);
  return {
    action: 'abort',
    message: [
      'Il riallineamento alla linea principale va in conflitto. Ho annullato tutto: il ramo è rimasto com\'era.',
      'File in conflitto:',
      files.length ? files.map((f) => `  ${f}`).join('\n') : '  (non identificati)',
      'Risolvili a mano (git rebase origin/main, sistema i file, git rebase --continue) e poi rilancia questo comando.',
    ].join('\n'),
  };
}

// ─── Stato su disco ─────────────────────────────────────────────────────────

export function readState(root = ROOT) {
  const f = stateFile(root);
  if (!existsSync(f)) return {};
  try {
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return (o && typeof o === 'object') ? o : {};
  } catch (_) {
    return {};
  }
}

export function writeState(state, root = ROOT) {
  mkdirSync(resolve(root, '.claude'), { recursive: true });
  writeFileSync(stateFile(root), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ─── git ────────────────────────────────────────────────────────────────────

function git(args, root = ROOT) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  catch (_) { return ''; }
}

export function currentBranch(root = ROOT) { return git(['rev-parse', '--abbrev-ref', 'HEAD'], root); }
export function headSha(root = ROOT) { return git(['rev-parse', 'HEAD'], root); }
/** Ci sono modifiche non salvate (anche solo nell'area di stage)? */
export function isDirty(root = ROOT) { return git(['status', '--porcelain'], root).length > 0; }

/** Esito per il ramo corrente: quello che legge chi pubblica. */
export function verdictForCurrentBranch(root = ROOT) {
  const branch = currentBranch(root);
  const entry = readState(root)[branch];
  return { branch, entry, ...checkVerdict(entry, headSha(root), isDirty(root)) };
}

// ─── Il testo consegnato all'istanza che verifica ───────────────────────────

/**
 * Costruisce il compito per l'istanza che verifica. Contiene la RICHIESTA e il
 * ramo; NON il diff, NON i file toccati, NON il report di chi ha lavorato.
 * PURA (testata): è il punto in cui l'isolamento o c'è o non c'è.
 */
export function buildVerifierBrief({ request, branch, recipe }) {
  return [
    'Sei la VERIFICA di un lavoro che ha fatto qualcun altro. Non conosci quel lavoro',
    'e non devi conoscerlo: il tuo giudizio vale proprio perché parti da fuori.',
    '',
    'REGOLA DURA DI ISOLAMENTO — non guardare COME è stato fatto:',
    `  · niente diff, niente log dei commit, niente elenco dei file toccati del ramo ${branch};`,
    '  · niente report o note di chi ha lavorato;',
    '  · niente test scritti insieme al lavoro come prova che funziona (li ha scritti',
    '    chi ha anche scritto l’eventuale bug: condividono i suoi punti ciechi).',
    'Puoi leggere il codice per capire come USARE la funzione, e scrivere test tuoi.',
    'Se sai già dove guardare perché hai visto la modifica, non sei più una verifica.',
    'UNICA eccezione: se stai per bocciare perché "la cosa non esiste", prima',
    'controlla di essere sull’albero giusto con i soli NOMI dei file toccati',
    `(\`git diff --stat main...${branch}\`). I nomi sì, il contenuto no: una`,
    'bocciatura per assenza data guardando la cartella sbagliata è già costata',
    'un’intera implementazione rifatta da capo.',
    '',
    'COSA ERA STATO CHIESTO (l’unica cosa che sai):',
    String(request || '').split('\n').map((l) => `  ${l}`).join('\n'),
    '',
    `RAMO DA PROVARE: ${branch} (è già quello su cui sei: non cambiarlo)`,
    '',
    'IL TUO COMPITO: prova a far fallire la cosa chiesta usandola davvero, come la',
    'userebbe l’owner. Non ti basta che i test passino: apri l’app e prova.',
    '',
    'QUANDO HAI FINITO registra l’esito (uno solo dei due):',
    '  node scripts/verify-local.mjs pass "cosa hai provato e com’è andata"',
    '  node scripts/verify-local.mjs fail "cosa NON funziona, in concreto"',
    'Boccia se la cosa chiesta non si ottiene, non per differenze di gusto.',
    '',
    '─── recipe della verifica (la stessa delle routine) ───',
    String(recipe || '(file-ruolo non trovato)'),
  ].join('\n');
}

export function readRecipe(root = ROOT) {
  const f = resolve(root, 'routines', 'roles', 'verifier.md');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const branch = currentBranch();
  const sha = headSha();

  if (cmd === 'start') {
    const request = rest.join(' ').trim();
    if (!request) {
      console.error('Uso: node scripts/verify-local.mjs start "<cosa aveva chiesto l\'owner>"');
      console.error('Serve la richiesta ORIGINALE, non un riassunto di cosa hai fatto: la verifica');
      console.error('deve poter concludere "non è quello che era stato chiesto".');
      process.exit(1);
    }
    writeState(withRequest(readState(), branch, { request, sha }));
    console.log(buildVerifierBrief({ request, branch, recipe: readRecipe() }));
    process.exit(0);
  }

  if (cmd === 'pass' || cmd === 'fail') {
    const critique = rest.join(' ').trim();
    const prev = readState()[branch];
    if (!prev || !prev.request) {
      console.error(`Nessuna verifica avviata per '${branch}': prima serve "verify-local.mjs start".`);
      process.exit(1);
    }
    if (cmd === 'fail' && !critique) {
      console.error('Una bocciatura senza motivo non è utile a nessuno: scrivi cosa non funziona.');
      process.exit(1);
    }
    writeState(withVerdict(readState(), branch, { verdict: cmd, critique, sha }));
    console.log(cmd === 'pass'
      ? `Verifica superata per '${branch}' su ${sha.slice(0, 8)}. Si può pubblicare.`
      : `Verifica NON superata per '${branch}'. Il lavoro torna a chi l'ha fatto.`);
    process.exit(0);
  }

  if (cmd === 'status' || !cmd) {
    const r = verdictForCurrentBranch();
    console.log(`${r.branch}: ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }

  console.error('Comandi: start "<richiesta>" | pass "<critica>" | fail "<critica>" | status');
  process.exit(1);
}
