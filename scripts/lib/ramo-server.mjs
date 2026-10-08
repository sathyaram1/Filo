// Il ramo del server con lo stesso nome di quello dell'app (#915) dentro il verdetto di verify-local (#1062): lo sha
// verificato è di tutti e due, e un server diverso da quello verificato fa decadere il verdetto per finish e server:fondi.
// Test: tests/unit/ramoServer.test.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { RAMO_RE } from './parti-lavoro.mjs';

/** La cartella functions del checkout del server accanto al repo Filo, anche da una sua worktree; '' se non c'è. */
export function cartellaDelServer(radice, esiste = existsSync) {
  let d = resolve(radice);
  for (let i = 0; i < 8; i += 1) {
    const f = join(dirname(d), 'filo-security', 'functions');
    if (esiste(join(f, 'tools', 'server-fondi.js'))) return f;
    const su = dirname(d);
    if (su === d) break;
    d = su;
  }
  return '';
}

const corto = (s) => String(s || '').slice(0, 8);
const MAIN_SERVER = 'refs/remotes/origin/main';

/**
 * Il ramo `ramo` nel checkout del server. null = server assente (o ramo che non può avere un gemello); `sha` '' = il
 * ramo non c'è. `sha` è la punta locale (o su origin se in locale manca); con `punta: 'origine'` quella che fonde
 * server:fondi. `shaVerificato` fa calcolare se è su main e se dopo di lui sono entrate solo fusioni pulite di main.
 */
export function statoRamoServer(ramo, {
  cartellaServer = '', shaVerificato = '', fetch = false, punta = 'locale', git = gitIn,
} = {}) {
  if (!cartellaServer || !RAMO_RE.test(String(ramo || '')) || /\.\./.test(ramo)) return null;
  const radice = dirname(cartellaServer);
  if (git(radice, ['rev-parse', '--git-dir']) === null) return null;
  // server:fondi fonde la punta su origin dopo un fetch: chi gli fa da cancello deve guardare la stessa.
  if (fetch) git(radice, ['fetch', '--quiet', 'origin']);
  const rev = (r) => String(git(radice, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]) || '').trim();
  const locale = rev(`refs/heads/${ramo}`);
  const origine = rev(`refs/remotes/origin/${ramo}`);
  const sha = punta === 'origine' ? origine : (locale || origine);
  const main = rev(MAIN_SERVER);
  const dentro = (x) => !!(x && main) && git(radice, ['merge-base', '--is-ancestor', x, main]) !== null;
  const v = /^[0-9a-f]{40}$/i.test(String(shaVerificato || '')) ? shaVerificato : '';
  const checkout = locale ? checkoutDelRamo(git(radice, ['worktree', 'list', '--porcelain']), ramo) : '';
  return {
    ramo, sha, locale, origine, radice, checkout,
    sporchi: checkout ? modificheNonSalvate(git, checkout) : [],
    dentroMain: dentro(sha),
    verificatoInMain: dentro(v),
    soloFusioniDiMain: !!(v && sha && v !== sha && main) && soloFusioniPulite(git, radice, v, sha, main),
  };
}

/** La cartella dove `ramo` è il ramo corrente, dall'elenco porcelain dei worktree; '' se nessuna. PURA. */
export function checkoutDelRamo(porcelain, ramo) {
  let cartella = '';
  for (const riga of String(porcelain || '').split('\n')) {
    if (riga.startsWith('worktree ')) cartella = riga.slice('worktree '.length).trim();
    else if (riga.trim() === `branch refs/heads/${ramo}`) return cartella;
  }
  return '';
}

// Solo i file tracciati: il .gitignore del server non copre il collegamento a node_modules né .claude/worktrees.
function modificheNonSalvate(git, cartella) {
  const out = git(cartella, ['status', '--porcelain', '--untracked-files=no']);
  if (out === null) return ['(stato del checkout illeggibile)'];
  return out.split('\n').map((r) => r.trimEnd()).filter(Boolean);
}

/**
 * Da `v` a `c` sono entrate solo fusioni di main del server, ognuna identica a quella che git fa da sé: il contenuto è
 * quello verificato più main. Serve perché server:fondi fonde solo in avanzamento rapido e chiede `git merge origin/main`.
 */
export function soloFusioniPulite(git, radice, v, c, main) {
  if (git(radice, ['merge-base', '--is-ancestor', v, c]) === null) return false;
  const out = git(radice, ['rev-list', '--parents', c, `^${v}`, `^${main}`]);
  if (out === null) return false;
  for (const riga of out.split('\n').map((r) => r.trim()).filter(Boolean)) {
    const [sha, ...genitori] = riga.split(/\s+/);
    if (genitori.length !== 2) return false;
    // merge-tree esce diverso da 0 sui conflitti: la loro risoluzione è contenuto nuovo, mai verificato.
    const atteso = git(radice, ['merge-tree', '--write-tree', genitori[0], genitori[1]]);
    const vero = git(radice, ['rev-parse', `${sha}^{tree}`]);
    if (atteso === null || vero === null || atteso.split('\n')[0].trim() !== vero.trim()) return false;
  }
  return true;
}

/**
 * Il server di adesso regge il verdetto dato su `verificato` ({ ramo, sha }, o niente se la verifica non l'aveva)?
 * `ora` è statoRamoServer. Ritorna { ok, reason?, sha, tollerato? }. PURA.
 */
export function confrontaServer(verificato, ora) {
  const v = verificato && verificato.sha ? verificato : null;
  const no = (reason) => ({ ok: false, reason });
  const sporco = testoServerSporco(ora);
  if (sporco) return no(sporco);
  if (!v) {
    if (!ora || !ora.sha || ora.dentroMain) return { ok: true, sha: '' };
    return no(`il ramo del server ${ora.ramo} (${corto(ora.sha)}) ha commit fuori da main del server che la verifica non comprendeva: serve un'altra verifica, che li veda (verify-local.mjs start)`);
  }
  if (!ora) return no(`la verifica comprende il ramo del server ${v.ramo} (${corto(v.sha)}), ma accanto al repo non trovo il checkout del server: non posso dire che sia ancora quello`);
  if (ora.sha === v.sha) return { ok: true, sha: v.sha };
  if (!ora.sha) {
    return ora.verificatoInMain
      ? { ok: true, sha: v.sha }
      : no(`il ramo del server ${v.ramo}, verificato a ${corto(v.sha)}, non c'è più e quel commit non è su main del server`);
  }
  if (ora.soloFusioniDiMain || (ora.dentroMain && ora.verificatoInMain)) return { ok: true, sha: ora.sha, tollerato: true };
  return no(`il ramo del server ${ora.ramo} si è mosso dopo la verifica (${corto(v.sha)} → ${corto(ora.sha)}): l'esito riguarda un server diverso da quello che si fonderebbe. Serve un'altra verifica (verify-local.mjs start)`);
}

/** Il rifiuto per le modifiche non salvate nel checkout del ramo del server; '' se non ce ne sono. PURA. */
export function testoServerSporco(ora, cosa = 'la verifica riguarda i commit') {
  if (!ora || !Array.isArray(ora.sporchi) || !ora.sporchi.length) return '';
  const elenco = ora.sporchi.slice(0, 10).map((r) => `  ${r}`).join('\n');
  const altri = ora.sporchi.length > 10 ? `\n  … e altri ${ora.sporchi.length - 10}` : '';
  return `nel checkout del server (${ora.checkout}) il ramo ${ora.ramo} ha modifiche non salvate: ${cosa}, non quei file come sono adesso. Salvale in un commit o scartale, poi rilancia:\n${elenco}${altri}`;
}

/** Il rifiuto di una critica se il ramo del server non è più quello dell'avvio della verifica; '' se lo è. PURA. */
export function testoServerMossoDallAvvio(prima, ora) {
  const a = (prima && prima.sha) || '';
  const b = (ora && ora.sha) || '';
  // Un ramo nato da main senza commit suoi non porta niente da verificare.
  if (a === b || (!a && ora && ora.dentroMain)) return '';
  const ramo = (ora && ora.ramo) || (prima && prima.ramo) || '';
  const come = !a ? `è comparso il ramo del server ${ramo} (${corto(b)})`
    : !b ? `il ramo del server ${ramo} (${corto(a)}) non c'è più` : `il ramo del server ${ramo} si è mosso (${corto(a)} → ${corto(b)})`;
  return [
    `critica non registrata: dall'avvio della verifica ${come}, quindi la critica parlerebbe di un server diverso da quello da verificare.`,
    a ? `Se non doveva muoversi, riportalo a ${corto(a)} nel checkout del server e registra di nuovo la stessa critica; se doveva, la verifica riparte (verify-local.mjs start, lo rilancia chi guida).`
      : 'La verifica riparte (verify-local.mjs start, lo rilancia chi guida), così lo comprende.',
  ].join('\n');
}

/** La parte del server da scrivere accanto allo sha dell'app nei messaggi; '' senza server. PURA. */
export function testoServer(server) {
  return server && server.sha ? ` e il server ${server.ramo} su ${corto(server.sha)}` : '';
}

function gitIn(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) { return null; }
}
