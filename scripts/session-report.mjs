// Rapporto di fine sessione, da script e non dall'agente.
//
// PERCHÉ ESISTE (giro del 14/09/2026)
//   Di come è andata una sessione di routine — quanto è durata, quanto è
//   costata, quante volte ha ricominciato da freddo, quali strumenti hanno
//   sforato — il server non sapeva niente: il worker "riportava" a parole, e
//   le parole non si sommano. Il transcript JSONL di Claude Code contiene già
//   tutti i numeri: qui si leggono e si impacchettano in un oggetto che
//   `routine-channel.mjs release` allega da solo al rilascio.
//
// USO
//   node scripts/session-report.mjs [--transcript <file>] [--role <ruolo>]
//                                   [--ticket <biglietto>] [--out <file>]
//     → il JSON su stdout (o nel file di --out), cinque righe di riassunto su
//       stderr. Non fallisce mai: senza transcript esce un rapporto minimo con
//       una nota.
//
// DOVE STA IL TRANSCRIPT
//   `--transcript`, poi FILO_TRANSCRIPT; altrimenti il `.jsonl` scritto più di
//   recente in `~/.claude/projects/<slug>/` (CLAUDE_CONFIG_DIR al posto di
//   `~/.claude` se c'è), dove <slug> è il percorso assoluto della cartella di
//   lavoro con ogni carattere non alfanumerico sostituito da `-`. Contano
//   anche i transcript dei sotto-agenti (`<sessione>/subagents/*.jsonl`): nelle
//   routine chi rilascia è un sotto-agente dell'orchestratore, e il suo
//   transcript è l'ultimo scritto. I sotto-agenti di un sotto-agente stanno
//   nella stessa cartella, accanto a lui: si riconoscono dal tempo (cominciano
//   fra la sua chiamata Agent e il risultato) e si sommano nel suo rapporto,
//   come quelli di una sessione (figliDelSottoAgente). Da una cartella di lavoro separata (git
//   worktree) si guarda anche la cartella del checkout principale, dove Claude
//   Code li scrive davvero.
//   `since` (il rilascio lo prende dal marcatore del biglietto) limita il conto
//   a quello che è successo da quel momento.
//
// FORMA DEL JSONL (verificata su file veri il 16/09/2026)
//   righe {"type":"assistant","timestamp":…,"message":{"id","model","usage":{
//     input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
//     output_tokens}, "content":[{type:"tool_use", id, name}]}} — un messaggio
//   può stare su PIÙ righe (una per blocco di contenuto), con lo stesso `id` e
//   la stessa `usage` ripetuta: si conta una volta per `id`;
//   righe {"type":"user","message":{"content":[{type:"tool_result",
//     tool_use_id, is_error, content}]}}.
//
// I file sono decine di MB: si leggono riga per riga, mai interi.

import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Prezzi ($ per milione di token) ─────────────────────────────────────────
// Fonte: skill `claude-api` (tabella modelli del 2026-06-24 e note su cache):
// scrittura in cache a 5 minuti = 1,25× l'input, a UN'ORA = 2× l'input
// (`cacheWrite1h`), lettura = 0,1× l'input, tranne Fable 5.1 (lettura
// 0,25 $/M) e Fable 5 (1 $/M). Sonnet 4.x costa 3/15, Sonnet 5 costa 2/10.
// Un modello sconosciuto paga la tariffa opus, con una nota nel rapporto.
//
// Le due durate si distinguono nel transcript (`usage.cache_creation.
// ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`; la somma è
// `cache_creation_input_tokens`). Fino al giro 4 della verifica (16/09/2026)
// tutto era prezzato a 1,25×: su questa macchina un messaggio su cinque
// scrive a un'ora, e il costo usciva più basso del 18-39% su ogni sessione.
export const PREZZI = Object.freeze({
  opus: { input: 5, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  sonnet: { input: 2, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  'sonnet-4': { input: 3, cacheWrite: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
  haiku: { input: 1, cacheWrite: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
  fable: { input: 10, cacheWrite: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },
  'fable-5': { input: 10, cacheWrite: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50 },
});

/**
 * Le scritture in cache di una usage, divise per durata: { cw5m, cw1h }.
 * Con il dettaglio (`cache_creation`) si prende quello; senza (un transcript
 * vecchio) tutto il totale vale come cinque minuti. Se il dettaglio non torna
 * col totale, la differenza si conta a cinque minuti: non si perde niente.
 * PURA.
 */
export function scrittureCache(u) {
  const tot = Number(u && u.cache_creation_input_tokens) || 0;
  const det = u && u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
  if (!det) return { cw5m: tot, cw1h: 0 };
  const cw1h = Math.max(0, Number(det.ephemeral_1h_input_tokens) || 0);
  const cw5m = Math.max(0, Number(det.ephemeral_5m_input_tokens) || 0);
  const resto = Math.max(0, tot - cw1h - cw5m);
  return { cw5m: cw5m + resto, cw1h };
}

/** La famiglia di prezzo di un modello. PURA. `known` è falso se si ripiega su opus. */
export function famigliaPrezzo(model) {
  const m = String(model || '').toLowerCase();
  if (/fable|mythos/.test(m)) return { key: /(fable|mythos)-5(?![-\d])/.test(m) ? 'fable-5' : 'fable', known: true };
  if (m.includes('opus')) return { key: 'opus', known: true };
  if (m.includes('sonnet')) return { key: /sonnet-4/.test(m) ? 'sonnet-4' : 'sonnet', known: true };
  if (m.includes('haiku')) return { key: 'haiku', known: true };
  return { key: 'opus', known: false };
}

/** Il nome della cartella dei transcript per una cartella di lavoro. PURA. */
export function slugProgetto(percorso) {
  return String(percorso || '').replace(/[^A-Za-z0-9]/g, '-');
}

/** Una chiave ammessa da Firestore: solo [A-Za-z0-9_-], il resto diventa `_`. PURA. */
export function chiaveSicura(nome) {
  const s = String(nome || '').replace(/[^A-Za-z0-9_-]/g, '_');
  return s || '_';
}

/** Il testo di un tool_result, comunque sia impacchettato. PURA. */
function testoDi(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : (c && typeof c.text === 'string' ? c.text : ''))).join('\n');
  return '';
}

/** Il rapporto vuoto: ogni chiave al suo posto, così un server che lo legge non trova buchi. */
export function rapportoVuoto({ role = '', ticket = '' } = {}) {
  return {
    v: 1,
    role: String(role || ''),
    ticket: String(ticket || ''),
    sessionId: '',
    models: [],
    startedAt: '',
    endedAt: '',
    durationS: 0,
    turns: 0,
    coldTurns: 0,
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    costUsd: 0,
    tools: { total: 0, byName: {}, timeouts: 0, errors: 0 },
    subagents: 0,
    // I transcript dei sotto-agenti letti e sommati, e la loro parte del costo
    // (che sta gia' dentro costUsd e nei totali qui sopra).
    subagentRuns: 0,
    subagentCostUsd: 0,
    longestToolS: 0,
    notes: [],
  };
}

/**
 * Il checkout principale di una cartella di lavoro separata (git worktree),
 * o '' se `cwd` è già il checkout principale, un repo nudo, o non è git.
 * Claude Code scrive i transcript nella cartella del progetto da cui la
 * sessione è partita: chi lavora in `.claude/worktrees/<nome>` li trova lì.
 */
export function checkoutPrincipale(cwd) {
  try {
    const comune = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!comune || basename(comune) !== '.git') return '';
    const principale = resolve(dirname(comune));
    return principale === resolve(cwd) ? '' : principale;
  } catch (_) {
    return '';
  }
}

/** Un transcript è quello di un sotto-agente se sta in `<sessione>/subagents/`. PURA. */
export function eSottoAgente(file) {
  return basename(dirname(file)) === 'subagents';
}

/** L'id di un sotto-agente dal nome del suo transcript (`agent-<id>.jsonl`). PURA. */
export function agentIdDi(file) {
  return basename(file, '.jsonl').replace(/^agent-/, '');
}

/**
 * Il meta di un sotto-agente: Claude Code scrive accanto a ogni transcript
 * `agent-<id>.meta.json` con `parentAgentId` (chi lo ha lanciato) e
 * `toolUseId` (la chiamata Agent che lo ha lanciato). È il legame vero
 * figlio → lanciatore; il tempo è solo un ripiego (giro 6 della verifica del
 * 16/09/2026). Torna null se il file manca o non è JSON.
 */
export function leggiMeta(file) {
  const p = file.replace(/\.jsonl$/, '.meta.json');
  try {
    const m = JSON.parse(readFileSync(p, 'utf8'));
    return m && typeof m === 'object' ? m : null;
  } catch (_) {
    return null;
  }
}

/** Il transcript del lanciatore dichiarato dal meta, se sta nella stessa cartella; altrimenti ''. */
function lanciatoreDi(file) {
  const meta = leggiMeta(file);
  const pid = meta && typeof meta.parentAgentId === 'string' ? meta.parentAgentId.trim() : '';
  if (!pid) return '';
  for (const nome of [`agent-${pid}.jsonl`, `${pid}.jsonl`]) {
    const p = join(dirname(file), nome);
    if (existsSync(p) && resolve(p) !== resolve(file)) return p;
  }
  return '';
}

/**
 * I transcript di una cartella del progetto, con la data dell'ultima
 * scrittura: i `.jsonl` delle sessioni E quelli dei loro sotto-agenti
 * (`<sessione>/subagents/*.jsonl`). Nelle routine i worker SONO sotto-agenti
 * dell'orchestratore (routines/roles/orchestrator.md): il transcript scritto
 * più di recente è quello di chi sta rilasciando, e fino al 16/09/2026 il
 * rapporto guardava solo le sessioni, cioè prendeva l'orchestratore con
 * dentro tutti i worker del giro (verifica del giro 2).
 */
function candidatiIn(cartella) {
  const out = [];
  for (const n of readdirSync(cartella)) {
    const p = join(cartella, n);
    if (n.endsWith('.jsonl')) { out.push({ p, m: recenzaDi(p) }); continue; }
    const sub = join(p, 'subagents');
    let figli = [];
    try { figli = readdirSync(sub); } catch (_) { continue; }
    for (const f of figli) {
      if (!f.endsWith('.jsonl')) continue;
      const pf = join(sub, f);
      out.push({ p: pf, m: recenzaDi(pf) });
    }
  }
  return out;
}

/**
 * Quanto è «recente» un transcript: la data dell'ultimo messaggio
 * dell'assistente che contiene, e la data di scrittura del file solo se non
 * se ne trova uno in coda. La sessione madre, ferma ad aspettare un
 * sotto-agente, continua a ricevere righe di servizio (code, promemoria,
 * allegati) e il suo file può risultare scritto DOPO quello del sotto-agente
 * che sta rilasciando: ma un messaggio dell'assistente, in quel momento, lo
 * scrive solo il sotto-agente.
 */
function recenzaDi(file) {
  const dalContenuto = ultimoAssistantMs(file);
  if (Number.isFinite(dalContenuto)) return dalContenuto;
  try { return statSync(file).mtimeMs; } catch (_) { return 0; }
}

const CODA_BYTE = 512 * 1024;

/** La data dell'ultimo messaggio dell'assistente negli ultimi 512 KB del file, o NaN. */
export function ultimoAssistantMs(file) {
  let fd = null;
  try {
    const size = statSync(file).size;
    if (!size) return NaN;
    const da = Math.max(0, size - CODA_BYTE);
    const buf = Buffer.alloc(size - da);
    fd = openSync(file, 'r');
    readSync(fd, buf, 0, buf.length, da);
    const righe = buf.toString('utf8').split('\n');
    for (let i = righe.length - 1; i >= 0; i -= 1) {
      const r = righe[i];
      if (!r.includes('"type":"assistant"')) continue;
      const m = r.match(/"timestamp":"([^"]+)"/);
      const ms = m ? Date.parse(m[1]) : NaN;
      if (Number.isFinite(ms)) return ms;
    }
    return NaN;
  } catch (_) {
    return NaN;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch (_) { /* già chiuso */ } }
  }
}

/**
 * Trova il transcript. `explicit` vince, poi `env`, poi il `.jsonl` scritto
 * più di recente — sessione o sotto-agente — nella cartella del progetto (e,
 * da una cartella di lavoro separata, in quella del checkout principale).
 * Se il più recente è un sotto-agente il cui meta punta a un lanciatore
 * nella stessa cartella, si risale a lui: al rilascio un figlio in sottofondo
 * ancora vivo è più recente del worker, ma il rapporto è del worker (giro 6).
 * Torna { file, note } — `file` vuoto se non c'è niente, con la nota che
 * spiega dove si è guardato.
 */
export function trovaTranscript({ explicit = '', env = process.env, cwd = process.cwd(), configDir = '' } = {}) {
  const dichiarato = String(explicit || env.FILO_TRANSCRIPT || '').trim();
  if (dichiarato) {
    return existsSync(dichiarato) ? { file: dichiarato, note: '' } : { file: '', note: `transcript indicato ma assente: ${dichiarato}` };
  }
  const base = configDir || env.CLAUDE_CONFIG_DIR || join(os.homedir(), '.claude');
  const cartelle = [];
  for (const dir of [resolve(cwd), checkoutPrincipale(cwd)]) {
    if (!dir) continue;
    const c = join(base, 'projects', slugProgetto(dir));
    if (!cartelle.includes(c)) cartelle.push(c);
  }
  const guardate = [];
  const candidati = [];
  for (const cartella of cartelle) {
    if (!existsSync(cartella)) continue;
    guardate.push(cartella);
    try {
      candidati.push(...candidatiIn(cartella));
    } catch (e) {
      return { file: '', note: `cartella dei transcript illeggibile (${cartella}): ${String(e && e.message)}` };
    }
  }
  if (!guardate.length) return { file: '', note: `nessuna cartella di transcript per questa sessione (${cartelle.join(' né ')})` };
  if (!candidati.length) return { file: '', note: `nessun transcript in ${guardate.join(' né ')}` };
  candidati.sort((a, b) => b.m - a.m);
  return { file: candidati[0].p, note: '' };
}

/**
 * Il cuore: legge le righe (un iterabile, anche asincrono) e produce il
 * rapporto. Turno = messaggio assistant con `usage`, contato una volta per
 * id. Turno freddo = cache letta 0 e cache scritta ≥ 20.000, escluso il
 * primo. `timeouts` = tool_result col testo «timed out»; `subagents` =
 * tool_use di nome Agent o Task; `longestToolS` = distanza massima fra un
 * tool_use e il suo tool_result.
 */
export async function analizzaRighe(righe, { role = '', ticket = '', since = '', finestreAgent = null } = {}) {
  const rep = rapportoVuoto({ role, ticket });
  // L'usage di ogni messaggio, per id: un messaggio su più righe (pensa, poi
  // chiama uno strumento) porta sulla PRIMA riga un output parziale (2, 5, 7
  // token) e sull'ultima quello vero (163, 273, 309: verificato sui file di
  // questa macchina il 16/09/2026). Vale l'ultima usage vista per quell'id;
  // fino al giro 2 valeva la prima, e l'output usciva sei volte più basso.
  const usi = new Map();
  const strumentiVisti = new Set();
  const inCorso = new Map();
  const modelli = new Set();
  const sconosciuti = new Set();
  // `since`: solo quello che è successo da quel momento (il biglietto di
  // questo giro): quando l'orchestratore rilascia il biglietto di un worker
  // morto, il suo transcript è quello scelto, e senza finestra ci finirebbero
  // tutti i worker del giro.
  const sinceMs = since ? Date.parse(String(since)) : NaN;
  let primoMs = Infinity;
  let ultimoMs = -Infinity;
  let illeggibili = 0;
  let riga = 0;

  for await (const linea of righe) {
    riga += 1;
    const t = String(linea || '').trim();
    if (!t) continue;
    let e;
    try { e = JSON.parse(t); } catch (_) { illeggibili += 1; continue; }
    if (!e || typeof e !== 'object') continue;
    if (!rep.sessionId && typeof e.sessionId === 'string') rep.sessionId = e.sessionId;
    const ms = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (Number.isFinite(sinceMs) && Number.isFinite(ms) && ms < sinceMs) continue;
    if (Number.isFinite(ms)) { if (ms < primoMs) primoMs = ms; if (ms > ultimoMs) ultimoMs = ms; }
    const msg = e.message && typeof e.message === 'object' ? e.message : null;
    if (!msg) continue;
    // Le righe col modello «<synthetic>» (una richiesta interrotta, un errore
    // dell'API) hanno usage a zero e non sono un turno: contate, gonfiavano i
    // turni e lasciavano in ogni rapporto la nota del modello sconosciuto
    // (giro del 14/09, terza verifica: 36 righe così nei transcript di una
    // macchina sola).
    if (e.type === 'assistant' && /^<[^>]*>$/.test(String(msg.model || ''))) continue;

    if (e.type === 'assistant') {
      const u = msg.usage && typeof msg.usage === 'object' ? msg.usage : null;
      const id = typeof msg.id === 'string' && msg.id ? msg.id : `riga-${riga}`;
      if (u) usi.set(id, { u, model: msg.model });
      const blocchi = Array.isArray(msg.content) ? msg.content : [];
      for (const b of blocchi) {
        if (!b || b.type !== 'tool_use') continue;
        const bid = typeof b.id === 'string' && b.id ? b.id : `${id}:${strumentiVisti.size}`;
        if (strumentiVisti.has(bid)) continue;
        strumentiVisti.add(bid);
        rep.tools.total += 1;
        const nome = chiaveSicura(b.name);
        rep.tools.byName[nome] = (rep.tools.byName[nome] || 0) + 1;
        if (b.name === 'Agent' || b.name === 'Task') {
          rep.subagents += 1;
          // La finestra in cui quel sotto-agente ha lavorato: da questa
          // chiamata al suo risultato. Serve a ritrovare il suo transcript
          // quando chi rilascia e' a sua volta un sotto-agente (figliDelSottoAgente).
          if (Array.isArray(finestreAgent) && Number.isFinite(ms)) finestreAgent.push({ id: bid, inizio: ms, fine: Infinity });
        }
        if (Number.isFinite(ms)) inCorso.set(bid, ms);
      }
    } else if (e.type === 'user') {
      const blocchi = Array.isArray(msg.content) ? msg.content : [];
      for (const b of blocchi) {
        if (!b || b.type !== 'tool_result') continue;
        // Un timeout è un risultato IN ERRORE che comincia con «Command timed
        // out after …»: il testo di un file letto che contiene quelle parole
        // (uno spec, questo script) non lo è. Fino al giro 3 contava anche
        // quello, e il rapporto di una verifica diceva «timeout 2» senza che
        // nessun comando fosse scaduto.
        if (b.is_error === true && /timed out/i.test(testoDi(b.content).split('\n')[0])) rep.tools.timeouts += 1;
        if (b.is_error === true) rep.tools.errors += 1;
        if (Array.isArray(finestreAgent) && Number.isFinite(ms)) {
          const f = finestreAgent.find((x) => x.id === b.tool_use_id);
          if (f) f.fine = ms;
        }
        const inizio = inCorso.get(b.tool_use_id);
        if (inizio !== undefined) {
          inCorso.delete(b.tool_use_id);
          if (Number.isFinite(ms)) rep.longestToolS = Math.max(rep.longestToolS, Math.round(((ms - inizio) / 1000) * 10) / 10);
        }
      }
    }
  }

  // I conti, a fine lettura, con l'ULTIMA usage di ogni messaggio (in ordine
  // di prima comparsa: il primo turno non è mai «freddo»).
  let costo = 0;
  for (const { u, model } of usi.values()) {
    const input = Number(u.input_tokens) || 0;
    const { cw5m, cw1h } = scrittureCache(u);
    const cw = cw5m + cw1h;
    const cr = Number(u.cache_read_input_tokens) || 0;
    const out = Number(u.output_tokens) || 0;
    rep.turns += 1;
    if (rep.turns > 1 && cr === 0 && cw >= 20000) rep.coldTurns += 1;
    rep.tokens.input += input;
    rep.tokens.cacheWrite += cw;
    rep.tokens.cacheRead += cr;
    rep.tokens.output += out;
    if (typeof model === 'string' && model) modelli.add(model);
    const fam = famigliaPrezzo(model);
    if (!fam.known && model) sconosciuti.add(String(model));
    const p = PREZZI[fam.key];
    costo += (input * p.input + cw5m * p.cacheWrite + cw1h * p.cacheWrite1h + cr * p.cacheRead + out * p.output) / 1e6;
  }

  rep.models = [...modelli];
  if (Number.isFinite(primoMs)) rep.startedAt = new Date(primoMs).toISOString();
  if (Number.isFinite(ultimoMs)) rep.endedAt = new Date(ultimoMs).toISOString();
  if (Number.isFinite(primoMs) && Number.isFinite(ultimoMs)) rep.durationS = Math.round((ultimoMs - primoMs) / 1000);
  rep.costUsd = Math.round(costo * 10000) / 10000;
  for (const m of sconosciuti) rep.notes.push(`modello sconosciuto «${m}»: costo calcolato a tariffa opus`);
  if (illeggibili) rep.notes.push(`${illeggibili} righe del transcript non erano JSON e sono state saltate`);
  return rep;
}

/** Le righe di un file, una alla volta. */
function righeDelFile(file) {
  return createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
}

/**
 * I transcript dei sotto-agenti di una sessione. Claude Code li scrive in
 * `<cartella>/<nome della sessione>/subagents/*.jsonl` (verificato su file
 * veri il 16/09/2026), coi loro token. Le regole del repo dicono di delegare
 * le esplorazioni: e' li' che una sessione spende la parte piu' grossa, e un
 * rapporto che li ignorava diceva 29 $ per una sessione in cui UN solo
 * sotto-agente su diciassette ne valeva 55 (giro del 14/09, verifica).
 */
export function transcriptSottoAgenti(file) {
  const dir = join(dirname(file), basename(file, '.jsonl'), 'subagents');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().map((n) => join(dir, n));
  } catch (_) {
    return [];
  }
}

/** La data della prima riga con un timestamp nei primi 64 KB del file, o NaN. */
export function primoTimestampMs(file) {
  let fd = null;
  try {
    const size = statSync(file).size;
    if (!size) return NaN;
    const buf = Buffer.alloc(Math.min(size, 64 * 1024));
    fd = openSync(file, 'r');
    readSync(fd, buf, 0, buf.length, 0);
    for (const r of buf.toString('utf8').split('\n')) {
      const m = r.match(/"timestamp":"([^"]+)"/);
      const ms = m ? Date.parse(m[1]) : NaN;
      if (Number.isFinite(ms)) return ms;
    }
    return NaN;
  } catch (_) {
    return NaN;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch (_) { /* già chiuso */ } }
  }
}

/**
 * I transcript dei sotto-agenti lanciati da un SOTTO-AGENTE. Claude Code non
 * li annida sotto di lui: li scrive accanto, nella stessa cartella
 * `subagents/` della sessione madre, con lo stesso sessionId e un agentId
 * loro, senza un puntatore a chi li ha lanciati (verificato dal vivo il
 * 16/09/2026, verifica del giro 5). Nelle routine il worker E' un sotto-agente
 * e il suo ruolo gli chiede di delegare le letture grosse: fino al giro 5 il
 * rapporto cercava i figli in <worker>/subagents/, che non esiste, e il
 * rilascio allegava un rapporto senza le esplorazioni delegate.
 * Il legame che c'e' e' il tempo: un figlio comincia dentro la finestra fra la
 * chiamata Agent del lanciatore e il suo risultato (`finestre`, raccolte da
 * analizzaRighe). Un fratello di un altro giro (un worker precedente) sta
 * fuori da ogni finestra. I nipoti cominciano dentro la finestra anche loro,
 * e sono costo del worker come i figli. PURA a meno della lettura dei file.
 */
export function figliDelSottoAgente(file, finestre) {
  if (!Array.isArray(finestre) || !finestre.length) return [];
  const dir = dirname(file);
  let nomi = [];
  try { nomi = readdirSync(dir); } catch (_) { return []; }
  const out = [];
  for (const n of nomi.sort()) {
    if (!n.endsWith('.jsonl')) continue;
    const p = join(dir, n);
    if (resolve(p) === resolve(file)) continue;
    const t = primoTimestampMs(p);
    if (!Number.isFinite(t)) continue;
    // Due secondi di margine prima: la riga della chiamata e la prima riga
    // del figlio si scrivono a orologi diversi.
    if (finestre.some((f) => t >= f.inizio - 2000 && t <= f.fine)) out.push(p);
  }
  return out;
}

const arrotonda = (x) => Math.round(x * 10000) / 10000;

/**
 * Somma nel rapporto della sessione i numeri di un sotto-agente: costo,
 * token, turni, strumenti, modelli. Muta `rep` e lo restituisce. PURA.
 */
export function sommaSottoAgente(rep, sub) {
  rep.subagentRuns += 1;
  rep.subagentCostUsd = arrotonda(rep.subagentCostUsd + (Number(sub.costUsd) || 0));
  rep.costUsd = arrotonda(rep.costUsd + (Number(sub.costUsd) || 0));
  rep.turns += Number(sub.turns) || 0;
  rep.coldTurns += Number(sub.coldTurns) || 0;
  for (const k of Object.keys(rep.tokens)) rep.tokens[k] += Number(sub.tokens && sub.tokens[k]) || 0;
  const st = sub.tools || {};
  rep.tools.total += Number(st.total) || 0;
  rep.tools.timeouts += Number(st.timeouts) || 0;
  rep.tools.errors += Number(st.errors) || 0;
  for (const [nome, n] of Object.entries(st.byName || {})) rep.tools.byName[nome] = (rep.tools.byName[nome] || 0) + (Number(n) || 0);
  rep.subagents += Number(sub.subagents) || 0;
  rep.longestToolS = Math.max(rep.longestToolS, Number(sub.longestToolS) || 0);
  for (const m of Array.isArray(sub.models) ? sub.models : []) if (!rep.models.includes(m)) rep.models.push(m);
  for (const n of Array.isArray(sub.notes) ? sub.notes : []) {
    const nota = `sotto-agente: ${n}`;
    if (!rep.notes.includes(nota)) rep.notes.push(nota);
  }
  return rep;
}

/**
 * Il rapporto di questa sessione, sotto-agenti compresi. Non lancia mai per
 * un transcript assente o illeggibile: torna il rapporto minimo con la nota.
 * (Un errore di programmazione qui dentro sì: lo prende chi chiama.)
 */
export async function generaRapporto({ transcript = '', role = '', ticket = '', cwd = process.cwd(), env = process.env, configDir = '', since = '' } = {}) {
  const trovato = trovaTranscript({ explicit: transcript, env, cwd, configDir });
  if (!trovato.file) {
    const rep = rapportoVuoto({ role, ticket });
    rep.notes.push(trovato.note || 'transcript non trovato');
    return rep;
  }
  try {
    const finestre = [];
    const rep = await analizzaRighe(righeDelFile(trovato.file), { role, ticket, since, finestreAgent: finestre });
    if (!rep.turns) rep.notes.push(`nessun turno nel transcript ${trovato.file}`);
    const sottoAgente = eSottoAgente(trovato.file);
    if (sottoAgente) rep.notes.push(`sotto-agente della sessione ${basename(dirname(dirname(trovato.file)))}`);
    // Una sessione ha i suoi sotto-agenti in <sessione>/subagents/; un
    // sotto-agente li ha ACCANTO a se', e li si riconosce dal tempo.
    const figli = sottoAgente ? figliDelSottoAgente(trovato.file, finestre) : transcriptSottoAgenti(trovato.file);
    for (const f of figli) {
      try {
        sommaSottoAgente(rep, await analizzaRighe(righeDelFile(f), { role, ticket, since }));
      } catch (e) {
        rep.notes.push(`transcript di un sotto-agente illeggibile (${f}): ${String((e && e.message) || e)}`);
      }
    }
    return rep;
  } catch (e) {
    const rep = rapportoVuoto({ role, ticket });
    rep.notes.push(`transcript illeggibile (${trovato.file}): ${String((e && e.message) || e)}`);
    return rep;
  }
}

/** Le cinque righe per chi guarda lo schermo. PURA. */
export function riassunto(rep) {
  const durata = `${Math.floor(rep.durationS / 60)}m${String(rep.durationS % 60).padStart(2, '0')}s`;
  return [
    `rapporto sessione — ruolo: ${rep.role || '(nessuno)'}, biglietto: ${rep.ticket ? `${rep.ticket.slice(0, 8)}…` : '(nessuno)'}, sessione: ${rep.sessionId || '(sconosciuta)'}`,
    `durata ${durata}, ${rep.turns} turni (${rep.coldTurns} freddi), modelli: ${rep.models.join(', ') || '(nessuno)'}`,
    `token: input ${rep.tokens.input}, cache letta ${rep.tokens.cacheRead}, cache scritta ${rep.tokens.cacheWrite}, output ${rep.tokens.output}`,
    `costo stimato: $${rep.costUsd.toFixed(4)}`,
    `strumenti: ${rep.tools.total} (timeout ${rep.tools.timeouts}, errori ${rep.tools.errors}, sotto-agenti ${rep.subagents}, il più lungo ${rep.longestToolS}s) · sotto-agenti letti: ${Number(rep.subagentRuns) || 0}, il loro costo $${(Number(rep.subagentCostUsd) || 0).toFixed(4)}${rep.notes.length ? ` — note: ${rep.notes.join(' | ')}` : ''}`,
  ];
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { console.error(`Argomento non capito: "${a}". Opzioni: --transcript <file> --role <ruolo> --ticket <biglietto> --out <file>`); process.exit(1); }
    const uguale = a.indexOf('=');
    if (uguale > 2) { opt[a.slice(2, uguale)] = a.slice(uguale + 1); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { console.error(`${a} vuole un valore dopo di sé.`); process.exit(1); }
    opt[a.slice(2)] = next; i += 1;
  }
  const ammesse = new Set(['transcript', 'role', 'ticket', 'out']);
  for (const k of Object.keys(opt)) {
    if (!ammesse.has(k)) { console.error(`Opzione non capita: --${k}. Opzioni: --transcript --role --ticket --out`); process.exit(1); }
  }
  const rep = await generaRapporto({ transcript: opt.transcript || '', role: opt.role || '', ticket: opt.ticket || '', cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd() });
  const json = JSON.stringify(rep, null, 2);
  if (opt.out) writeFileSync(opt.out, `${json}\n`, 'utf8');
  else process.stdout.write(`${json}\n`);
  for (const r of riassunto(rep)) console.error(r);
}
