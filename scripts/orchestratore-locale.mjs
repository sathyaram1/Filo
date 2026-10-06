// L'orchestratore dei lavori locali (#956): worktree, lavoratore, verificatori, chiusura e deploy, senza una sessione in mezzo.
// La sessione resta per le decisioni: legge `stato` e risponde con `riprendi`. Logica e regole in scripts/lib/orchestratore.mjs.
// Uso: npm run orchestra -- aggiungi <N>… | avvia [opzioni] [--dry-run] | stato | smetti [--subito] | riprendi <N> ["risposta"] | togli <N>

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { cpus, freemem, homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FASI_FINITE, MODI_DERIVATI, OPZIONI_BASE, apriDerivatiDi, coda, creaMotore, modoDerivati, nuovaPratica, rigaChiusura, rigaStato, riprendi, slugDi, togliWorktree,
} from './lib/orchestratore.mjs';
import { cartellaDelServer } from './server-fondi-pratica.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USO = 'Uso: npm run orchestra -- aggiungi <N> [<N>…] [--slug <nome>] [--file <regola,regola>] [--richiesta "<testo>"]\n'
  + '                          avvia [--paralleli N] [--tetto N] [--derivati auto|non-locale|locale|nessuno] [--tieni-worktree] [--budget-istanza <$>]\n'
  + '                                [--ore-istanza <ore>] [--cpu-max <%>] [--cpu-chiusura <%>] [--dry-run [<N>…]]\n'
  + '                          stato | smetti [--subito] | riprendi <N> ["<risposta dell’owner>"] | togli <N>\n'
  + 'Senza --paralleli, --tetto, --budget-istanza e --ore-istanza non c’è un numero fisso: decidono macchina libera e bilanci del server.\n'
  + 'smetti, da un altro terminale (o il primo Ctrl-C): niente di nuovo, i passi in corso finiscono, poi esce; --subito (o il secondo Ctrl-C) ferma tutto adesso.';

// Un lettore solo per ogni comando (#1027): un argomento che non torna ferma tutto prima di qualsiasi lavoro, mai preso per buono o saltato.
const TESTO = { atteso: 'un testo', leggi: (v) => v.trim() || undefined };
const SI = { flag: true };
const intero = (min) => ({ atteso: `un numero intero da ${min} in su`, leggi: (v) => (/^\d+$/.test(v.trim()) && Number(v) >= min ? Number(v) : undefined) });
const numero = (atteso, ok) => ({
  atteso,
  leggi: (v) => { const n = /^\d+(?:[.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(',', '.')) : NaN; return ok(n) ? n : undefined; },
});
const percentuale = numero('una percentuale da 1 a 100', (n) => n >= 1 && n <= 100);
export const OPZIONI_DI = Object.freeze({
  aggiungi: {
    '--slug': TESTO,
    '--richiesta': TESTO,
    '--file': { atteso: 'una o più regole separate da virgole', leggi: (v) => { const l = v.split(',').map((x) => x.trim()).filter(Boolean); return l.length ? l : undefined; } },
  },
  avvia: {
    '--paralleli': intero(1),
    '--tetto': intero(1),
    '--derivati': { atteso: 'auto, non-locale, locale o nessuno', leggi: (v) => (MODI_DERIVATI.includes(v.trim()) ? v.trim() : undefined) },
    '--tieni-worktree': SI,
    '--budget-istanza': numero('un importo in dollari sopra zero', (n) => n > 0),
    '--ore-istanza': numero('un numero di ore da 0.5 in su', (n) => n >= 0.5),
    '--cpu-max': percentuale,
    '--cpu-chiusura': percentuale,
    '--dry-run': SI,
  },
  stato: {},
  riprendi: {},
  togli: {},
});
// Il trattino lungo è quello che un correttore automatico fa di «--».
const TRATTINI = '\u2010-\u2015\u2212';
const SEMBRA_OPZIONE = new RegExp(`^(?:--|[${TRATTINI}]\\p{L})`, 'u');

function erroreDiUso(msg) {
  const e = new Error(`${msg}. Non ho fatto niente.`);
  e.uso = true;
  return e;
}

// Distanza fra due nomi con lo scambio di due lettere vicine contato come uno: è il refuso più comune.
function distanza(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function sconosciuta(cmd, nome) {
  const norm = nome.replace(new RegExp(`^[-${TRATTINI}]+`), '--');
  const [vicina] = Object.keys(OPZIONI_DI[cmd] || {}).map((k) => [k, distanza(norm, k)]).filter(([, n]) => n <= 2).sort((x, y) => x[1] - y[1]);
  const altrove = Object.keys(OPZIONI_DI).find((c) => c !== cmd && OPZIONI_DI[c][norm]);
  const consiglio = vicina ? ` (forse ${vicina[0]}?)` : altrove ? ` (${norm} vale per ${altrove})` : '';
  return erroreDiUso(`${cmd}: opzione sconosciuta ${nome}${consiglio}`);
}

/** Opzioni e argomenti di un comando, con la regola di #1027: sconosciuta, senza valore, valore che è un'altra opzione o che non torna → errore. PURA. */
export function leggiArgomenti(cmd, args) {
  const spec = OPZIONI_DI[cmd] || {};
  const opz = {};
  const posizionali = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    if (!SEMBRA_OPZIONE.test(a)) { posizionali.push(a); continue; }
    const uguale = a.indexOf('=');
    const nome = uguale > 0 ? a.slice(0, uguale) : a;
    const s = spec[nome];
    if (!s) throw sconosciuta(cmd, nome);
    const chiave = nome.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (chiave in opz) throw erroreDiUso(`${cmd}: ${nome} data due volte, tienine una`);
    if (s.flag) {
      if (uguale > 0) throw erroreDiUso(`${cmd}: ${nome} non vuole un valore`);
      opz[chiave] = true;
      continue;
    }
    let v = uguale > 0 ? a.slice(uguale + 1) : args[i + 1];
    if (uguale < 0) i += 1;
    v = v === undefined ? '' : String(v);
    if (SEMBRA_OPZIONE.test(v)) throw erroreDiUso(`${cmd}: ${nome} vuole ${s.atteso}, e «${v}» è un’altra opzione`);
    if (!v.trim()) throw erroreDiUso(`${cmd}: ${nome} vuole ${s.atteso}${v ? ', non solo spazi' : ''}`);
    const letto = s.leggi(v);
    if (letto === undefined) throw erroreDiUso(`${cmd}: ${nome} vuole ${s.atteso}, non «${v}»`);
    opz[chiave] = letto;
  }
  return { opz, posizionali };
}

// Impostazioni di npm stesso a un refuso da un'opzione nostra: arrivano anche dal suo file di configurazione, e un refuso non sono (#1027).
// La sentinella in tests/unit/orchestratore.test.mjs le ricava dal npm installato.
export const IMPOSTAZIONI_NPM_VICINE = Object.freeze(['cafile']);

/**
 * Le opzioni (o i loro refusi) che npm si è tenuto perché manca il «--» dopo `npm run orchestra`: arrivano solo nell'ambiente,
 * e senza questo controllo `avvia --dry-run` farebbe un giro vero. PURA.
 */
export function opzioniTenuteDaNpm(env = process.env) {
  if (!/orchestratore-locale/.test(env.npm_lifecycle_script || '')) return [];
  const note = [...new Set(Object.values(OPZIONI_DI).flatMap((s) => Object.keys(s)))];
  const diNpm = (o) => IMPOSTAZIONI_NPM_VICINE.includes(o.slice(2));
  return Object.keys(env)
    .filter((k) => k.startsWith('npm_config_'))
    .map((k) => `--${k.slice('npm_config_'.length).replace(/_/g, '-')}`)
    .filter((o) => note.includes(o) || (!diNpm(o) && note.some((n) => distanza(o, n) <= 2)))
    .sort();
}

/** Il numero di un feedback («41» o «#41»), o un errore che dice quale argomento non lo è. PURA. */
export function numeroDiFeedback(cmd, a) {
  const m = /^#?(\d+)$/.exec(String(a).trim());
  if (!m || Number(m[1]) <= 0) throw erroreDiUso(`${cmd}: argomento non capito «${a}» (serve il numero di un feedback)`);
  return Number(m[1]);
}

// I ruoli prendono modello e sforzo dagli agenti delle routine: una scelta sola per lo stesso lavoro, in locale e in cloud.
export const AGENTE_DEL_RUOLO = Object.freeze({ lavoratore: 'routine-nuovo-lavoro', verificatore: 'routine-worker' });

export function radicePrincipale(root = ROOT) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  return resolve(common, '..');
}

export function percorsi(env = process.env, root = ROOT) {
  const radice = radicePrincipale(root);
  const funzioni = cartellaDelServer(radice);
  const serverRadice = funzioni ? dirname(funzioni) : '';
  const note = resolve(env.FILO_ORCH_DIR || join(radice, '..', 'orchestratore-locale'));
  const fileRegole = join(radice, '..', 'SOTTOAGENTI-LOCALI.md');
  return {
    radice,
    serverRadice,
    note,
    regole: existsSync(fileRegole) ? readFileSync(fileRegole, 'utf8') : '',
    wt: (slug) => join(radice, '.claude', 'worktrees', slug),
    wtServer: (slug) => join(serverRadice, '.claude', 'worktrees', slug),
  };
}

/** Modello e sforzo dal frontmatter di un agente (.claude/agents/<nome>.md). PURA sul testo. */
export function frontmatter(testo) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(testo || ''));
  const out = {};
  if (!m) return out;
  for (const riga of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(riga);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

export function modelloDelRuolo(ruolo, root = ROOT) {
  const nome = AGENTE_DEL_RUOLO[ruolo];
  const f = join(root, '.claude', 'agents', `${nome}.md`);
  if (!existsSync(f)) throw new Error(`manca ${f}: modello e sforzo del ${ruolo} si leggono da lì`);
  const fm = frontmatter(readFileSync(f, 'utf8'));
  if (!fm.model || !fm.effort) throw new Error(`${f} senza model o effort nel frontmatter`);
  return { model: fm.model, effort: fm.effort };
}

const confrontaVersioni = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

/** Il binario di Claude Code: FILO_CLAUDE_BIN, poi il PATH, poi dove lo installa l'app desktop. */
export function trovaClaude(env = process.env, piattaforma = process.platform) {
  if (env.FILO_CLAUDE_BIN) return env.FILO_CLAUDE_BIN;
  const nomi = piattaforma === 'win32' ? ['claude.exe'] : ['claude'];
  for (const d of String(env.PATH || env.Path || '').split(delimiter).filter(Boolean)) {
    for (const n of nomi) if (existsSync(join(d, n))) return join(d, n);
  }
  if (piattaforma === 'win32') {
    const base = join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude-code');
    const versioni = existsSync(base) ? readdirSync(base).filter((v) => /^\d+(\.\d+)*$/.test(v)).sort(confrontaVersioni).reverse() : [];
    for (const v of versioni) {
      for (const h of readdirSync(join(base, v))) if (existsSync(join(base, v, h, 'claude.exe'))) return join(base, v, h, 'claude.exe');
    }
  } else {
    for (const c of [join(homedir(), '.local', 'bin', 'claude'), join(homedir(), '.claude', 'local', 'claude')]) if (existsSync(c)) return c;
  }
  return '';
}

/** Gli argomenti di `claude -p` per un ruolo. PURA. */
export function argomentiClaude({ model, effort, nome, addDirs = [], permessi = 'auto', budget = '' }) {
  return [
    '-p', '--output-format', 'json', '--model', model, '--effort', effort,
    '--permission-mode', permessi, '-n', nome,
    ...addDirs.flatMap((d) => ['--add-dir', d]),
    ...(budget ? ['--max-budget-usd', String(budget)] : []),
  ];
}

/** L'uscita JSON di `claude -p` → { ok, testo, costo, errore }. PURA. */
export function leggiUscitaClaude(stdout, stderr = '', code = 0) {
  const t = String(stdout || '').trim();
  let j = null;
  for (const pezzo of [t, t.slice(t.lastIndexOf('\n{') + 1)]) {
    try { j = JSON.parse(pezzo); break; } catch (_) { /* il prossimo */ }
  }
  if (!j || typeof j !== 'object') return { ok: false, testo: '', costo: 0, errore: coda(`${stderr}\n${t}`, 6) || `uscita ${code}` };
  const ok = !j.is_error && code === 0 && (j.subtype === undefined || j.subtype === 'success');
  return { ok, testo: String(j.result || ''), costo: Number(j.total_cost_usd) || 0, errore: ok ? '' : String(j.result || j.subtype || `uscita ${code}`) };
}

// Le variabili della sessione che lancia: un'istanza figlia che le eredita si crede dentro di lei (e CLAUDE_EFFORT batte --effort).
const DELLA_SESSIONE = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(SESSION_ID|HOST_SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|ENTRYPOINT|EXECPATH|MESSAGING_\w+|SDK_HAS_HOST_AUTH_REFRESH))$/;
/** L'ambiente di un'istanza figlia. PURA. */
export function envFiglio(env) {
  return Object.fromEntries(Object.entries(env || {}).filter(([k]) => !DELLA_SESSIONE.test(k)));
}

/** `claude auth status` → l'istanza figlia avrà un accesso suo? PURA. */
export function accessoDaStatus(stdout) {
  try { return JSON.parse(String(stdout || '').trim()).loggedIn === true; } catch (_) { return false; }
}

// L'app desktop dà l'accesso alle sue sessioni senza passarlo ai processi che lanciano: la riga di comando ne vuole uno suo.
export const SENZA_ACCESSO = [
  'Claude Code da riga di comando non ha un accesso suo, e le istanze figlie risponderebbero «Not logged in».',
  'Una volta sola, dall’owner, in un terminale: `claude auth login` (o `claude setup-token` e la variabile CLAUDE_CODE_OAUTH_TOKEN).',
  'Non ho lanciato niente.',
].join('\n');

/** La richiesta dell'owner dalle cornici di feedback:leggi: titolo e testo. PURA. */
export function richiestaDaLettura(testo) {
  const t = String(testo || '').replace(/\r\n/g, '\n');
  const pezzo = (nome) => {
    const m = new RegExp(`\\[${nome}:[^\\]\\n]*Inizio (\\w+)\\]\\n([\\s\\S]*?)\\n\\[Fine \\1\\]`).exec(t);
    return m ? m[2].trim() : '';
  };
  return [pezzo('Titolo'), pezzo('Testo')].filter(Boolean).join('\n\n');
}

function esegui(cmd, args, { cwd, input, timeoutMs, env } = {}) {
  return new Promise((ok) => {
    const bin = cmd === 'node' ? process.execPath : cmd;
    let stdout = '';
    let stderr = '';
    let scaduto = false;
    const figlio = spawn(bin, args, { cwd, env: env || process.env, windowsHide: true });
    const timer = timeoutMs ? setTimeout(() => { scaduto = true; figlio.kill(); }, timeoutMs) : null;
    figlio.stdout.on('data', (d) => { stdout += d; });
    figlio.stderr.on('data', (d) => { stderr += d; });
    figlio.on('error', (e) => { stderr += String(e.message || e); });
    figlio.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (scaduto) stderr += `\ntempo scaduto (${Math.round(timeoutMs / 60_000)} min): processo fermato`;
      ok({ code: code === null ? 1 : code, stdout, stderr, out: `${stdout}\n${stderr}`.trim() });
    });
    if (input !== undefined) figlio.stdin.end(String(input));
    else figlio.stdin.end();
  });
}

function carico() {
  const misura = () => cpus().reduce((a, c) => {
    const tot = Object.values(c.times).reduce((x, y) => x + y, 0);
    return { tot: a.tot + tot, idle: a.idle + c.times.idle };
  }, { tot: 0, idle: 0 });
  const a = misura();
  return new Promise((ok) => setTimeout(() => {
    const b = misura();
    const tot = b.tot - a.tot;
    ok({ cpu: tot > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / tot)) : 0, liberaGB: freemem() / 2 ** 30 });
  }, 2000));
}

function negozio(file) {
  const vuoto = () => ({ coda: [], pratiche: {} });
  const leggi = () => {
    try { return existsSync(file) ? { ...vuoto(), ...JSON.parse(readFileSync(file, 'utf8')) } : vuoto(); } catch (e) {
      throw new Error(`${file} illeggibile (${e.message}): non lo sovrascrivo`);
    }
  };
  const scrivi = (s) => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`);
    renameSync(tmp, file);
  };
  return { leggi, scrivi, salvaPratica: (p) => { const s = leggi(); s.pratiche[p.num] = p; scrivi(s); } };
}

function memoria(iniziale) {
  const s = JSON.parse(JSON.stringify(iniziale));
  return { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (p) => { s.pratiche[p.num] = JSON.parse(JSON.stringify(p)); } };
}

const sistemaFs = {
  esiste: (p) => { try { lstatSync(p); return true; } catch (_) { return false; } },
  collega: (verso, link) => symlinkSync(verso, link, process.platform === 'win32' ? 'junction' : 'dir'),
  // Mai ricorsivo: si toglie il collegamento, non quello a cui punta.
  scollega: (link) => {
    const st = lstatSync(link);
    if (!st.isSymbolicLink()) return;
    if (process.platform === 'win32') rmdirSync(link);
    else unlinkSync(link);
  },
};

function pubblicaDavvero(P) {
  const cwd = join(P.serverRadice, 'functions');
  // Su Windows il deploy del server va lanciato da PowerShell (giro locale del 04/10, LOCAL.md § Deploy).
  if (process.platform === 'win32') return esegui('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'npm run server:pubblica'], { cwd, timeoutMs: 60 * 60_000 });
  return esegui('npm', ['run', 'server:pubblica'], { cwd, timeoutMs: 60 * 60_000 });
}

function depVere(P, opz, log) {
  const bin = trovaClaude();
  if (!bin) throw new Error('Claude Code non trovato: imposta FILO_CLAUDE_BIN col percorso del binario');
  const ruoli = { lavoratore: modelloDelRuolo('lavoratore'), verificatore: modelloDelRuolo('verificatore') };
  const env = envFiglio(process.env);
  const auth = spawnSync(bin, ['auth', 'status'], { encoding: 'utf8', env, timeout: 60_000, windowsHide: true });
  if (!accessoDaStatus(auth.stdout)) throw new Error(SENZA_ACCESSO);
  mkdirSync(join(P.note, 'log'), { recursive: true });
  return {
    store: negozio(join(P.note, 'stato.json')),
    esegui,
    async claude({ ruolo, prompt, cwd, addDirs, nome }) {
      for (const d of addDirs || []) mkdirSync(d, { recursive: true });
      const r = await esegui(bin, argomentiClaude({ ...ruoli[ruolo], nome, addDirs, budget: opz.budgetIstanza }), {
        cwd, input: prompt, env, timeoutMs: opz.oreIstanza * 60 * 60_000,
      });
      const f = join(P.note, 'log', `${nome.replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().replace(/[:.]/g, '')}.json`);
      writeFileSync(f, `${r.stdout}\n${r.stderr ? `\n--- stderr ---\n${r.stderr}` : ''}`);
      return leggiUscitaClaude(r.stdout, r.stderr, r.code);
    },
    verifica: (wt) => {
      if (!existsSync(wt)) return {};
      return { ...verifyLocal.verdictForCurrentBranch(wt), dirty: verifyLocal.isDirty(wt) };
    },
    pubblica: () => pubblicaDavvero(P),
    carico,
    dormi: (ms) => new Promise((ok) => setTimeout(ok, ms)),
    log,
    ora: () => new Date().toISOString(),
    percorsi: P,
    fs: sistemaFs,
    annota: async (id, testo) => {
      const { annotaPratica } = await import('./owner-feedback.mjs');
      return annotaPratica(id, testo);
    },
    richiestaDi: async (num) => richiestaDaLettura((await esegui('node', ['scripts/leggi-feedback.mjs', String(num)], { cwd: ROOT })).stdout),
  };
}

/** Le dipendenze della prova a vuoto: stampano quello che farebbero, e il giro va dritto al «superata». */
function depAVuoto(P, stato, log) {
  const fatti = new Set();
  const giri = new Map();
  const finto = (cmd, args, cwd) => {
    const a = args.join(' ');
    if (cmd === 'git' && /rev-parse --verify/.test(a)) return { code: 1, out: '' };
    if (cmd === 'git' && /rev-list --count origin\/main\.\.(HEAD|refs)/.test(a)) return { code: 0, out: '1' };
    if (cmd === 'git' && /diff --name-only/.test(a)) return { code: 0, out: 'scripts/esempio.mjs' };
    if (cmd === 'node' && /verify-local\.mjs start/.test(a)) { giri.set(cwd, 'avviata'); return { code: 0, out: '(il compito del verificatore)' }; }
    return { code: 0, out: '' };
  };
  return {
    store: memoria(stato),
    esegui: async (cmd, args, { cwd } = {}) => {
      log(`[a vuoto] ${cwd ? `(${cwd}) ` : ''}${cmd} ${args.map((x) => (/\s/.test(x) ? JSON.stringify(x.length > 200 ? `${x.slice(0, 197)}…` : x) : x)).join(' ')}`);
      const r = finto(cmd, args, cwd);
      return { ...r, stdout: r.out };
    },
    claude: async ({ ruolo, cwd, nome }) => {
      log(`[a vuoto] claude -p (${ruolo}, ${JSON.stringify(modelloDelRuolo(ruolo))}) «${nome}» in ${cwd}`);
      if (ruolo === 'verificatore') giri.set(cwd, 'superata');
      return { ok: true, testo: 'fatto', costo: 0 };
    },
    verifica: (wt) => {
      const g = giri.get(wt);
      if (g === 'superata') return { ok: true, entry: { request: 'x', verdict: 'pass', derived: [] } };
      if (g === 'avviata') return { ok: false, entry: { request: 'x' } };
      return {};
    },
    pubblica: async () => { log(`[a vuoto] (${join(P.serverRadice, 'functions')}) npm run server:pubblica`); return { code: 0, out: '' }; },
    carico: async () => ({ cpu: 0, liberaGB: 99 }),
    dormi: () => new Promise((ok) => setImmediate(ok)),
    log,
    ora: () => new Date().toISOString(),
    percorsi: P,
    fs: {
      esiste: (p) => fatti.has(p) || sistemaFs.esiste(p),
      collega: (verso, link) => { fatti.add(link); log(`[a vuoto] collego ${link} → ${verso}`); },
      scollega: (link) => { fatti.delete(link); log(`[a vuoto] tolgo il collegamento ${link}`); },
    },
    annota: async () => {},
    richiestaDi: async (num) => `(la richiesta del feedback #${num})`,
  };
}

let verifyLocal;

export function opzioniDa(args) {
  const { opz, posizionali } = leggiArgomenti('avvia', args);
  const numeri = posizionali.map((a) => numeroDiFeedback('avvia', a));
  if (numeri.length && !opz.dryRun) throw erroreDiUso(`avvia: i numeri valgono solo con --dry-run; per metterli in coda: aggiungi ${numeri.join(' ')}`);
  return { ...OPZIONI_BASE, budgetIstanza: '', oreIstanza: 4, dryRun: false, ...opz, numeri };
}

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const tenute = opzioniTenuteDaNpm();
  if (tenute.length) throw erroreDiUso(`npm si è tenuto ${tenute.join(' ')}: dopo «npm run orchestra» serve «--» (npm run orchestra -- ${cmd || 'avvia'} …); se invece sta nella configurazione di npm, lancia «node scripts/orchestratore-locale.mjs ${cmd || 'avvia'} …»`);
  const P = percorsi();
  const store = negozio(join(P.note, 'stato.json'));
  const ora = () => new Date().toISOString();

  if (cmd === 'aggiungi') {
    const { opz, posizionali } = leggiArgomenti('aggiungi', rest);
    const nums = posizionali.map((a) => numeroDiFeedback('aggiungi', a));
    if (!nums.length) throw erroreDiUso('aggiungi vuole almeno un numero di feedback');
    if (nums.length > 1 && (opz.slug || opz.richiesta)) throw erroreDiUso('aggiungi: --slug e --richiesta valgono per un lavoro solo');
    const s = store.leggi();
    for (const n of nums) {
      if (s.pratiche[n] && !['fuso'].includes(s.pratiche[n].fase)) { console.log(`#${n} è già in coda (${s.pratiche[n].fase})`); continue; }
      // Due lavori aperti sullo stesso ramo dividerebbero worktree, verifica e fusione.
      const di = (slug) => Object.values(s.pratiche).find((q) => q && q.num !== n && q.fase !== 'fuso' && q.slug === slug);
      let slug = opz.slug || '';
      if (slug && di(slug)) throw new Error(`il ramo claude/${slug} è già del lavoro #${di(slug).num}: scegli un altro --slug`);
      if (!slug) for (let k = 1; !slug || di(slug); k += 1) slug = k === 1 ? slugDi(n) : `${slugDi(n)}-${k}`;
      s.pratiche[n] = nuovaPratica({ num: n, slug, richiesta: opz.richiesta, file: opz.file, ora: ora() });
      s.coda = (s.coda || []).filter((x) => x !== n).concat([n]);
      console.log(`#${n} in coda: ramo claude/${s.pratiche[n].slug}`);
    }
    store.scrivi(s);
    return 0;
  }

  // Il pid dell'orchestratore vivo, 0 se nessuno: un lavoro rimasto a metà da uno chiuso non lo guida più nessuno.
  const inCorso = () => {
    const lock = join(P.note, 'avvia.lock');
    const pid = existsSync(lock) ? Number(readFileSync(lock, 'utf8')) : 0;
    return pid && vivo(pid) ? pid : 0;
  };
  const aMeta = (p) => p && !['in-coda', 'fermo', 'fuso'].includes(p.fase);

  if (cmd === 'stato' || !cmd) {
    const { posizionali } = leggiArgomenti('stato', rest);
    if (posizionali.length) throw erroreDiUso(`stato: argomento non capito «${posizionali[0]}»`);
    const s = store.leggi();
    const pid = inCorso();
    console.log(pid ? `Orchestratore in corso (pid ${pid}).` : 'Orchestratore fermo.');
    if (!(s.coda || []).length) console.log('Coda vuota.');
    for (const n of s.coda || []) if (s.pratiche[n]) console.log(rigaStato(s.pratiche[n]));
    return 0;
  }

  if (cmd === 'riprendi') {
    const { posizionali } = leggiArgomenti('riprendi', rest);
    if (!posizionali.length) throw erroreDiUso('riprendi vuole il numero del lavoro');
    const n = numeroDiFeedback('riprendi', posizionali[0]);
    const risposta = posizionali.slice(1).join(' ');
    const s = store.leggi();
    if (aMeta(s.pratiche[n])) {
      const pid = inCorso();
      const fase = s.pratiche[n].fase;
      if (pid) throw new Error(`#${n} è in ${fase} e la sta guidando l’orchestratore in corso (pid ${pid}): si riprende da ferma`);
      const da = `#${n} è rimasta in ${fase} da un orchestratore che non gira più: riparte da sola col prossimo «avvia», dal punto in cui sta il ramo`;
      if (risposta.trim()) throw new Error(`${da}. Una risposta vale per un lavoro fermo: non l’ho registrata.`);
      console.log(`${da}.`);
      return 0;
    }
    s.pratiche[n] = riprendi(s.pratiche[n], risposta);
    store.scrivi(s);
    console.log(`#${n} ripresa: ${s.pratiche[n].fase}${s.pratiche[n].compito === 'decisione' ? ' (con la tua risposta)' : ''}. Riparte col prossimo «avvia».`);
    return 0;
  }

  if (cmd === 'togli') {
    const { posizionali } = leggiArgomenti('togli', rest);
    if (posizionali.length !== 1) throw erroreDiUso(`togli vuole un numero di lavoro, uno solo${posizionali.length ? `: ${posizionali.join(' ')}` : ''}`);
    const n = numeroDiFeedback('togli', posizionali[0]);
    const s = store.leggi();
    const p = s.pratiche[n];
    if (!p) throw new Error(`#${n} non è in coda`);
    const pid = aMeta(p) ? inCorso() : 0;
    if (pid) throw new Error(`#${n} è in ${p.fase} e la sta guidando l’orchestratore in corso (pid ${pid}): si toglie da ferma, in coda o fusa`);
    // Il registro della verifica sta nel worktree e se ne va con lui: esterni e messi da parte diventano feedback prima.
    const giaAperti = (p.derivatiAperti || []).length;
    if (p.fase !== 'fuso' && existsSync(P.wt(p.slug))) {
      verifyLocal = await import('./verify-local.mjs');
      const depTogli = { esegui, percorsi: P, verifica: (wt) => (existsSync(wt) ? verifyLocal.verdictForCurrentBranch(wt) : {}) };
      const falliti = await apriDerivatiDi(depTogli, p, { derivati: modoDerivati(p), salva: (q) => { s.pratiche[n] = q; store.scrivi(s); } });
      if (falliti) {
        throw new Error(`#${n} non tolta: ${falliti === 1 ? 'un rilievo non si è aperto' : `${falliti} rilievi non si sono aperti`} come feedback, e col worktree se ne andrebbe:\n${p.avvisi.filter((a) => a.startsWith('feedback non aperto')).join('\n')}\nRiprova togli: quelli già aperti non si riaprono.`);
      }
    }
    delete s.pratiche[n];
    s.coda = (s.coda || []).filter((x) => x !== n);
    store.scrivi(s);
    const avvisi = await togliWorktree({ esegui, fs: sistemaFs, percorsi: P }, p);
    console.log(`#${n} tolta dalla coda; worktree tolti${avvisi.length ? ' salvo questi' : ''}, il ramo resta.`);
    for (const a of avvisi) console.log(`  ${a}`);
    const nuovi = (p.derivatiAperti || []).slice(giaAperti);
    if (nuovi.length) console.log(`  feedback aperti dai rilievi rimasti: ${nuovi.map((d) => (d.num ? `#${d.num}` : d.titolo)).join(', ')}`);
    return 0;
  }

  if (cmd === 'avvia') {
    const opz = opzioniDa(rest);
    const log = (riga) => {
      const r = `${ora().slice(0, 19)} ${riga}`;
      console.log(r);
      if (!opz.dryRun) try { mkdirSync(P.note, { recursive: true }); writeFileSync(join(P.note, 'orchestratore.log'), `${r}\n`, { flag: 'a' }); } catch (_) { /* il log non ferma il giro */ }
    };
    if (opz.dryRun) {
      const s = store.leggi();
      for (const n of opz.numeri) {
        if (!s.pratiche[n]) { s.pratiche[n] = nuovaPratica({ num: n, ora: ora() }); s.coda = (s.coda || []).concat([n]); }
      }
      if (!(s.coda || []).length) { console.log('Coda vuota: niente da provare (avvia --dry-run <N> prova un lavoro senza metterlo in coda).'); return 0; }
      const motore = creaMotore(depAVuoto(P, s, log), { ...opz, pausaMs: 0 });
      const fine = await motore.avvia();
      for (const n of fine.coda) console.log(rigaStato(fine.pratiche[n]));
      return 0;
    }
    verifyLocal = await import('./verify-local.mjs');
    const lock = join(P.note, 'avvia.lock');
    mkdirSync(P.note, { recursive: true });
    if (existsSync(lock) && vivo(Number(readFileSync(lock, 'utf8')))) throw new Error(`un orchestratore è già in corso (pid ${readFileSync(lock, 'utf8').trim()})`);
    writeFileSync(lock, String(process.pid));
    try {
      const fine = await creaMotore(depVere(P, opz, log), opz).avvia();
      for (const n of fine.coda) console.log(rigaStato(fine.pratiche[n]));
      // 2 = qualche lavoro fermo: chi ha lanciato in sottofondo lo sa dal codice, senza leggere le righe.
      return fine.coda.some((n) => fine.pratiche[n] && fine.pratiche[n].fase === 'fermo') ? 2 : 0;
    } finally {
      try { unlinkSync(lock); } catch (_) { /* già tolto */ }
    }
  }

  console.error(USO);
  return 1;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
    console.error(`✗ ${(e && e.message) || e}`);
    if (e && e.uso) console.error(USO);
    process.exit(1);
  });
}
