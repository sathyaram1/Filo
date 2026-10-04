// Il giro lavoro → verifica → chiusura dei lavori locali (#956): decide il passo dopo come dispatch nelle routine.
// Non lancia niente da sé: processi, istanze di Claude, carico e stato arrivano da fuori (scripts/orchestratore-locale.mjs).
// Regole: tests/unit/orchestratore.test.mjs.

import { createRequire } from 'node:module';

// Le regole del giro come le legge verify-local: moduli condivisi che si registrano su globalThis.
const require = createRequire(import.meta.url);
require('../../src/shared/feedbackTransitions.js');
require('../../src/shared/verifierRound.js');
const ROUND = globalThis.SN_VERIFIER_ROUND;

export const FASI_FINITE = Object.freeze(['fuso', 'fermo']);

export const OPZIONI_BASE = Object.freeze({
  paralleli: 2,
  // Un giro in più costa un'istanza; un lavoro fermato troppo presto costa una decisione dell'owner.
  tetto: 8,
  cpuMax: 80,
  // Il test a tempo del 2FA cade sotto carico (#943): la chiusura aspetta una macchina più calma.
  cpuChiusura: 60,
  memMinGB: 2,
  ritenta: 2,
  pausaMs: 60_000,
  // Il limite d'uso dell'abbonamento si aspetta (un quarto d'ora per volta, se non dice quando riparte); oltre il tetto il lavoro si ferma col motivo.
  pausaLimiteMs: 15 * 60_000,
  oreLimite: 12,
  derivati: 'non-locale',
  tieniWorktree: false,
});

// I file del repo pubblico che il server incorpora al deploy (filo-security/functions/tools/bake-shared.js).
export const INCORPORATI_DAL_SERVER = Object.freeze([
  'src/shared/feedbackTransitions.js', 'src/shared/verifierRound.js', 'filo_filosofia.txt',
]);
export const FILE_REGOLE = Object.freeze(['firestore.rules', 'storage.rules', 'firestore.indexes.json']);

const TRANSITORIO = /usciteSegreti|2FA|EBUSY|Process failed to launch|0xC0000142|ETIMEDOUT|ECONNRESET|fetch failed|socket hang up|timed? ?out|overloaded|rate.?limit|\b529\b|\b503\b/i;

/** Il rosso è di quelli che la macchina carica o la rete producono da soli, e si rilancia. PURA. */
export function eTransitorio(testo) { return TRANSITORIO.test(String(testo || '')); }

const LIMITE_USO = /usage limit|hit your (usage )?limit|(5-hour|weekly|session|opus|sonnet) limit|limit reached|limite di utilizzo/i;

/** Quanto aspettare prima di rilanciare un'istanza fermata dal limite d'uso: 0 se l'errore è un altro. PURA. */
export function attesaLimite(testo, adessoMs, opz = OPZIONI_BASE) {
  const t = String(testo || '');
  if (!LIMITE_USO.test(t)) return 0;
  const epoca = /\|(\d{10})\b/.exec(t);
  if (epoca) return Math.max(Number(epoca[1]) * 1000 - Number(adessoMs || 0) + 60_000, 60_000);
  return opz.pausaLimiteMs;
}

/** I rilievi di una correzione in sospeso sul ramo, '' se non ce n'è una. PURA. */
export function rilieviSospesi(v) {
  const e = (v && v.entry) || {};
  if (e.verdict !== 'fix-pending') return '';
  const f = e.pending && Array.isArray(e.pending.findings) ? e.pending.findings : [];
  return f.length ? ROUND.formatFindings(f) : '(i rilievi li ristampa node scripts/verify-local.mjs status)';
}

/** Un verdetto registrato, riconoscibile fra un giro e l'altro: '' se il giro non ne ha. PURA. */
export function chiaveVerdetto(e) {
  if (!e || !e.verdict) return '';
  return [e.verdict, e.at || '', e.sha || '', String(e.critique || '').slice(0, 200)].join('|');
}

/**
 * Il passo che il verdetto già scritto sul ramo impone, prima di quello che direbbe la fase registrata. PURA.
 * Vale a ogni passo di lavoro e verifica: ripresa, riavvio dell'orchestratore, istanza caduta. null = decide la fase.
 */
export function passoDalRamo(v, p) {
  if (!['lavoro', 'verifica'].includes(p.fase) || p.compito === 'riallinea') return null;
  const e = (v && v.entry) || {};
  // Una risposta dell'owner si applica prima: il verdetto si rilegge appena il lavoratore ha finito.
  if (p.fase === 'lavoro' && p.compito === 'decisione') return null;
  if (v && v.ok) return { fase: 'chiusura' };
  if (e.verdict === 'fix-pending') return p.fase === 'lavoro' && p.compito === 'correzione' ? null : { correzione: true };
  if (e.verdict === 'fail' && chiaveVerdetto(e) !== (p.verdettoVisto || '')) {
    return { ferma: 'la verifica ha fermato il lavoro: serve una decisione dell’owner', domanda: String(e.critique || '') };
  }
  if (e.verdict === 'pass' && v.dirty && p.fase === 'verifica') return { ferma: 'modifiche non salvate nel worktree dopo il verdetto' };
  return null;
}

/** Le ultime righe di un'uscita, per il motivo di una fermata. PURA. */
export function coda(testo, righe = 12) {
  return String(testo || '').trim().split('\n').slice(-righe).join('\n');
}

export function slugDi(num) { return `lavoro-${num}`; }
export function ramoDi(p) { return `claude/${p.slug}`; }
// verify-local start prende per opzione o percorso un testo che comincia con un trattino o una barra.
export const richiestaArg = (r) => String(r || '').replace(/^[\s\-‐-―−/\\]+/, '');
const primaRiga = (t) => String(t || '').split('\n')[0];
// Il lavoratore ha finito e ha lasciato solo file: tolti quelli, si riparte dalla verifica. Il testo riconosce anche le fermate scritte prima del segno.
const MOTIVO_SPORCO = 'il lavoratore ha lasciato modifiche non salvate';

/** Una pratica nuova in coda. PURA. */
export function nuovaPratica({ num, slug, richiesta = '', file = [], ora = '' }) {
  const n = Number(num);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`numero di feedback non valido: ${num}`);
  const s = String(slug || slugDi(n)).trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(s)) throw new Error(`nome del ramo non valido: ${s} (lettere, cifre, . _ -)`);
  return {
    num: n, slug: s, richiesta: String(richiesta || ''), file: (Array.isArray(file) ? file : []).filter(Boolean),
    fase: 'in-coda', compito: 'lavoro', giri: 0, giriTotali: 0, tentativi: {}, costo: 0, istanze: [],
    fermo: null, risposta: '', avvisi: [], derivatiAperti: [], fusa: { app: false, server: false, deploy: false },
    aggiornato: ora,
  };
}

const escRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** Una regola di file («scripts/**», «src/shared/x.js», «tests/») come espressione regolare. PURA. */
export function regolaFile(glob) {
  const g = String(glob || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!g) return null;
  if (!/[*?]/.test(g)) return new RegExp(`^${escRe(g)}${g.endsWith('/') ? '' : '(/|$)'}`);
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i += 1; if (g[i + 1] === '/') i += 1; } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escRe(c);
  }
  return new RegExp(`^${re}$`);
}

/** Due lavori si pestano i piedi: toccano lo stesso file, o uno tocca un file che l'altro ha dichiarato. PURA. */
export function siSovrappongono(a, b) {
  const fa = (a.toccati || []).map(String);
  const fb = (b.toccati || []).map(String);
  if (fa.some((f) => fb.includes(f))) return true;
  const cade = (files, globs) => globs.map(regolaFile).filter(Boolean).some((re) => files.some((f) => re.test(f)));
  if (cade(fb, a.file || []) || cade(fa, b.file || [])) return true;
  // Due regole dichiarate prima del lavoro, senza file toccati: basta che una contenga l'altra.
  const radice = (g) => String(g).replace(/\\/g, '/').split(/[*?]/)[0];
  return (a.file || []).some((x) => (b.file || []).some((y) => radice(x).startsWith(radice(y)) || radice(y).startsWith(radice(x))));
}

/** Il carico lascia partire un'altra istanza (o una chiusura)? PURA. */
export function caricoBasta(carico, opz, perChiusura = false) {
  if (!carico) return true;
  const soglia = perChiusura ? opz.cpuChiusura : opz.cpuMax;
  return Number(carico.cpu) <= soglia && Number(carico.liberaGB) >= opz.memMinGB;
}

/**
 * Cosa fare dopo l'istanza che ha verificato, dallo stato di verify-local del ramo. PURA.
 * v = { ok, entry, dirty } come verdictForCurrentBranch → { azione: 'chiudi' | 'giro' | 'ferma', motivo?, domanda?, ripeti? }
 */
export function decidiDopoVerifica(v, p) {
  const e = (v && v.entry) || null;
  if (v && v.ok) return { azione: 'chiudi' };
  if (!e || !e.verdict) {
    if (((p.tentativi || {}).critica || 0) < 1) return { azione: 'giro', ripeti: 'critica' };
    return { azione: 'ferma', motivo: 'due verificatori di fila non hanno registrato la critica' };
  }
  if (e.verdict === 'fixed') return { azione: 'giro' };
  if (e.verdict === 'fix-pending') {
    const r = e.pending && Array.isArray(e.pending.findings) ? ROUND.formatFindings(e.pending.findings) : '';
    return { azione: 'ferma', motivo: `il verificatore ha registrato la critica ma non ha consegnato la correzione${r ? `:\n${r}` : ''}`, correzione: r || '(i rilievi li ristampa node scripts/verify-local.mjs status)' };
  }
  if (e.verdict === 'fail') {
    return { azione: 'ferma', motivo: 'la verifica ha fermato il lavoro: serve una decisione dell’owner', domanda: String(e.critique || '') };
  }
  if (e.verdict === 'pass') {
    if (v.dirty) return { azione: 'ferma', motivo: 'modifiche non salvate nel worktree dopo il verdetto' };
    return { azione: 'giro' };
  }
  return { azione: 'ferma', motivo: `esito di verifica sconosciuto: ${e.verdict}` };
}

/** L'esito di npm run finish dal codice d'uscita (scripts/lib/owner-merge.mjs) e dall'uscita. PURA. */
export function classificaFinish({ code, out = '' }) {
  if (code === 0) return 'fuso';
  if (code === 10) return 'attesa-owner';
  if (/conflitt/i.test(out) && (code === 20 || code === 1)) return 'conflitto';
  if (code === 30) return 'superato';
  if (eTransitorio(out)) return 'transitorio';
  return 'rosso';
}

/** Va rideployato il server: c'è la parte del server, o l'app tocca file che il server incorpora. PURA. */
export function serveDeploy(p, fileApp) {
  return !!(p.fusa && p.fusa.server) || (fileApp || []).some((f) => INCORPORATI_DAL_SERVER.includes(f));
}
export function toccaRegole(fileApp) { return (fileApp || []).some((f) => FILE_REGOLE.includes(f)); }

/** I feedback da aprire per i rilievi che il lavoro non ha corretto, raggruppati come li apre il server. PURA. */
export function derivatiDaAprire(p, derived) {
  const fatti = new Set((p.derivatiAperti || []).map((d) => d.chiave));
  return ROUND.derivedGroups(Array.isArray(derived) ? derived : []).map((g) => {
    const chiave = g.findings.map((f) => `${f.level}${f.sede}:${String(f.text).slice(0, 80)}`).join('|');
    const prima = primaRiga(g.findings[0].text).replace(/\s+/g, ' ').trim();
    const titolo = g.tipo === 'rimasti' && g.findings.length > 1
      ? `Rilievi rimasti del lavoro locale #${p.num}`
      : (prima.length > 90 ? `${prima.slice(0, 89)}…` : prima);
    const testo = [
      `Rilievo messo da parte nella verifica del lavoro locale #${p.num} (ramo ${ramoDi(p)}): ${ROUND.groupLabel(g)}.`,
      '',
      ROUND.formatFindings(g.findings),
    ].join('\n');
    return { chiave, titolo, testo, priorita: g.priority };
  }).filter((d) => !fatti.has(d.chiave));
}

const testa = (regole) => (regole ? [String(regole).trim(), '', '════════'] : []);

/** Il compito del lavoratore. Le regole fisse viaggiano in testa, intere: ogni istanza parte senza memoria. PURA. */
export function promptLavoratore({ p, regole, wtApp, wtServer, cartellaNote, crit = '', giaLavoro = false }) {
  const righe = [...testa(regole), 'Sei un lavoratore di una sessione locale di Filo, lanciato dall’orchestratore automatico (#956). Segui le regole fisse qui sopra.', ''];
  if (p.compito === 'riallinea') {
    righe.push(
      `Lavoro: feedback #${p.num}. Il ramo ${ramoDi(p)} va in conflitto con origin/main: \`git fetch origin main\`, \`git merge origin/main\`,`,
      'risolvi i conflitti unendo i due lati (elenchi, campi ammessi: si tiene l’unione; se si contraddicono davvero scrivilo nelle note e fermati),',
      'lancia gli unit dei file toccati dal conflitto, committa e pusha. Non toccare altro.',
    );
  } else if (p.compito === 'correzione') {
    righe.push(
      `Lavoro: feedback #${p.num} (\`npm run feedback:leggi -- ${p.num}\`). La verifica ha registrato questi rilievi e la correzione non è stata consegnata:`,
      crit,
      '',
      ...(p.risposta ? ['L’owner ha risposto (è sua, vale come decisione):', p.risposta, ''] : []),
      'Correggili sul ramo con le prove del giro (`node scripts/verify-local.mjs status` ristampa i rilievi),',
      'e consegna con `node scripts/verify-local.mjs corretto "<report della correzione>"`. La verifica nuova la lancia l’orchestratore.',
    );
  } else if (p.compito === 'decisione') {
    righe.push(
      `Lavoro: feedback #${p.num} (\`npm run feedback:leggi -- ${p.num}\`). Il lavoro si era fermato così:`,
      crit || '(nessun motivo registrato)',
      '',
      'L’owner ha risposto (è sua, vale come decisione):',
      p.risposta,
      '',
      'Applica la decisione sul ramo e chiudi gli altri rilievi della lista.',
    );
  } else {
    righe.push(`Lavoro: feedback #${p.num} (\`npm run feedback:leggi -- ${p.num}\`).`);
    if (p.giriTotali > 0 || giaLavoro) righe.push('Il ramo ha già del lavoro: riprendilo da dove è rimasto, non ricominciare.');
  }
  righe.push(
    '',
    `- app: worktree \`${wtApp}\` (ramo ${ramoDi(p)}, nato da origin/main, node_modules già collegato).`,
    wtServer
      ? `- parte server: worktree \`${wtServer}\` di filo-security, stesso ramo.`
      : '- se serve una parte server: worktree di filo-security con lo stesso nome di ramo (vedi regole fisse).',
    '- Niente deploy, fusioni o giudici veri durante le prove: dati finti, --dry-run.',
    `- Note per dopo (ordine di deploy, scelte che spettano all'owner, cose diverse dal chiesto): \`${cartellaNote}/note-${p.num}.md\`.`,
    p.compito === 'correzione'
      ? '- Di verify-local usi solo status e corretto: start lo lancia l’orchestratore, con un’istanza nuova.'
      : '- Non lanciare verify-local: la verifica la lancia l’orchestratore, con un’istanza nuova.',
    '',
    'Rispondi con una riga sola: esito e ultimi sha dei rami.',
  );
  return righe.join('\n');
}

/** Il compito del verificatore: il testo di verify-local start, intero, e il dove. Niente diff, niente report. PURA. */
export function promptVerificatore({ p, regole, wtApp, wtServer, brief, cartellaNote = '' }) {
  return [
    ...testa(regole),
    'Sei un verificatore di una sessione locale di Filo, istanza nuova, lanciato dall’orchestratore automatico (#956). Segui le regole fisse qui sopra.',
    `Lavori nel worktree \`${wtApp}\` (ramo ${ramoDi(p)}).${wtServer ? ` La parte server dello stesso lavoro sta nel worktree \`${wtServer}\` di filo-security, stesso ramo.` : ''}`,
    ...(cartellaNote ? [`Cartella temporanea, fuori dal repo, per script di prova, log, appunti e la nota \`note-${p.num}.md\`: \`${cartellaNote}\`.`] : []),
    'Segui per intero il compito qui sotto e poi la risposta del server alla critica, qualunque cosa dica.',
    'Rispondi con una riga sola: esito del server e ultimo sha del ramo.',
    '',
    '════ COMPITO ════',
    String(brief || '').trim(),
  ].join('\n');
}

/** Una riga per pratica, per chi guarda (npm run orchestra -- stato). PURA. */
export function rigaStato(p) {
  const costo = p.costo ? ` · ${Number(p.costo).toFixed(2)} $` : '';
  const giri = p.giriTotali ? ` · giri ${p.giriTotali}` : '';
  let r = `#${p.num} ${ramoDi(p)}: ${p.fase}${p.fase === 'lavoro' && p.compito !== 'lavoro' ? ` (${p.compito})` : ''}${giri}${costo}`;
  if (p.fermo) r += `\n    fermo: ${p.fermo.motivo}${p.fermo.domanda ? `\n    domanda:\n${p.fermo.domanda.replace(/^/gm, '      ')}` : ''}`;
  if (p.derivatiAperti && p.derivatiAperti.length) r += `\n    feedback aperti dai rilievi: ${p.derivatiAperti.map((d) => (d.num ? `#${d.num}` : d.titolo)).join(', ')}`;
  for (const a of p.avvisi || []) r += `\n    avviso: ${a}`;
  return r;
}

/** Rimette in moto una pratica ferma, con la risposta dell'owner se c'è. PURA. */
export function riprendi(p, risposta) {
  if (!p) throw new Error('pratica non in coda');
  if (p.fase !== 'fermo') throw new Error(`#${p.num} non è ferma (fase ${p.fase})`);
  const f = p.fermo || {};
  // L'owner ha visto la fermata: il verdetto che la accompagnava non la ripropone.
  const q = { ...p, fermoPrima: p.fermo, fermo: null, ripreso: true, tentativi: {}, verdettoVisto: f.verdetto || p.verdettoVisto || '' };
  const r = String(risposta || '').trim();
  // Si riparte dal passo che si era fermato: una fusione in attesa d'approvazione non rifà la verifica (l'approvazione vale per quel commit).
  // Una risposta data lì vale solo se l'approvazione non c'è: la chiusura prova prima a fondere.
  if (f.attesaApprovazione) { q.fase = 'chiusura'; q.risposta = r; return q; }
  if (q.fusa && (q.fusa.app || q.fusa.server)) { q.fase = 'chiusura'; return q; }
  if (f.dove === 'chiusura' && !r) { q.fase = 'chiusura'; return q; }
  if (f.correzione) { q.compito = 'correzione'; q.risposta = r; q.fase = 'lavoro'; return q; }
  if (!r && f.dove === 'lavoro' && (f.lavoroFinito || String(f.motivo || '').startsWith(MOTIVO_SPORCO))) { q.compito = 'lavoro'; q.fase = 'verifica'; return q; }
  if (r) { q.compito = 'decisione'; q.risposta = r; q.fase = 'lavoro'; return q; }
  if (!q.giriTotali || f.dove === 'lavoro') { q.fase = 'lavoro'; return q; }
  q.fase = 'verifica';
  return q;
}

/**
 * Toglie i worktree di un lavoro (app e server), il collegamento a node_modules per primo: un worktree remove che lo
 * attraversa svuota il node_modules di tutti. Mai --force: un worktree con modifiche resta. → gli avvisi.
 */
export async function togliWorktree(dep, p) {
  const P = dep.percorsi;
  const avvisi = [];
  const coppie = [[P.wt(p.slug), P.radice, 'node_modules']];
  const ws = P.serverRadice ? P.wtServer(p.slug) : '';
  if (ws && dep.fs.esiste(ws)) coppie.push([ws, P.serverRadice, 'functions/node_modules']);
  for (const [wt, repo, nm] of coppie) {
    if (!dep.fs.esiste(wt)) continue;
    if (dep.fs.esiste(`${wt}/${nm}`)) dep.fs.scollega(`${wt}/${nm}`);
    if (dep.fs.esiste(`${wt}/${nm}`)) { avvisi.push(`worktree ${wt} lasciato: il collegamento a ${nm} non si è tolto`); continue; }
    const r = await dep.esegui('git', ['worktree', 'remove', wt], { cwd: repo });
    if (r.code !== 0) avvisi.push(`worktree ${wt} lasciato: ${coda(r.out, 1)}`);
  }
  return avvisi;
}

/**
 * Il motore. dep = {
 *   store: { leggi() → { coda, pratiche }, salvaPratica(p) },
 *   esegui(cmd, args, { cwd, input, timeoutMs }) → { code, stdout, out },   // out = stdout + stderr
 *   claude({ ruolo, prompt, cwd, addDirs, nome }) → { ok, testo, costo, errore },
 *   verifica(wtApp) → { ok, entry, dirty }, pubblica() → { code, out },
 *   carico() → { cpu, liberaGB }, dormi(ms), log(riga), ora() → ISO,
 *   percorsi: { radice, wt(slug), serverRadice ('' se manca), wtServer(slug), note, regole },
 *   fs: { esiste(p), collega(verso, link), scollega(link) }, annota(feedbackId, testo), richiestaDi(num),
 * }
 */
export function creaMotore(dep, opzioni = {}) {
  const opz = { ...OPZIONI_BASE, ...opzioni };
  const P = dep.percorsi;
  let chiusure = 0;

  const salva = (p) => { p.aggiornato = dep.ora(); dep.store.salvaPratica(p); };
  const git = (cwd, ...args) => dep.esegui('git', args, { cwd });
  const node = (cwd, args, timeoutMs) => dep.esegui('node', args, { cwd, timeoutMs });
  const numero = (r) => (r.code === 0 ? Number(String(r.out).trim()) || 0 : 0);

  function ferma(p, motivo, domanda = '', altro = {}) {
    const dove = p.fase;
    const verdetto = chiaveVerdetto(((dep.verifica(P.wt(p.slug)) || {}).entry) || null);
    p.fase = 'fermo';
    p.fermo = { motivo, ...(domanda ? { domanda } : {}), dove, ...(verdetto ? { verdetto } : {}), ...altro, at: dep.ora() };
    dep.log(`#${p.num} fermo: ${primaRiga(motivo)}`);
    if (p.feedbackId && dep.annota) {
      const nota = `Orchestratore locale: lavoro fermo, ${primaRiga(motivo)}${domanda ? '. Serve la risposta dell’owner (npm run orchestra -- riprendi).' : '.'}`;
      Promise.resolve().then(() => dep.annota(p.feedbackId, nota)).catch(() => {});
    }
    return 'fermo';
  }

  const avanti = async (cwd) => numero(await git(cwd, 'rev-list', '--count', 'origin/main..HEAD'));
  const serverAvanti = async (p) => (P.serverRadice ? numero(await git(P.serverRadice, 'rev-list', '--count', `origin/main..refs/heads/${ramoDi(p)}`)) : 0);
  const wtServerSeC = (p) => {
    const w = P.serverRadice ? P.wtServer(p.slug) : '';
    return w && dep.fs.esiste(w) ? w : '';
  };
  const aspettaCalma = async (perChiusura) => {
    while (!caricoBasta(await dep.carico(), opz, perChiusura)) await dep.dormi(opz.pausaMs);
  };

  async function prepara(p) {
    const wt = P.wt(p.slug);
    if (!p.richiesta) p.richiesta = await dep.richiestaDi(p.num);
    if (!p.richiesta) return ferma(p, `richiesta del feedback #${p.num} non letta (npm run feedback:leggi): niente worktree né ramo creati`);
    await git(P.radice, 'fetch', 'origin', 'main');
    if (!dep.fs.esiste(wt)) {
      const c = await git(P.radice, 'rev-parse', '--verify', '--quiet', `refs/heads/${ramoDi(p)}`);
      const r = c.code === 0
        ? await git(P.radice, 'worktree', 'add', wt, ramoDi(p))
        : await git(P.radice, 'worktree', 'add', wt, '-b', ramoDi(p), 'origin/main');
      if (r.code !== 0) return ferma(p, `worktree non creato:\n${coda(r.out)}`);
    }
    if (!dep.fs.esiste(`${wt}/node_modules`)) dep.fs.collega(`${P.radice}/node_modules`, `${wt}/node_modules`);
    p.fase = 'lavoro';
    return 'ok';
  }

  // Il passo dell'istanza risulta già sul ramo: critica registrata (verificatore), correzione consegnata (lavoratore).
  function passoFatto(p, ruolo, prima) {
    const e = ((dep.verifica(P.wt(p.slug)) || {}).entry) || {};
    if (ruolo === 'verificatore') return !!e.verdict;
    return prima === 'fix-pending' && e.verdict === 'fixed';
  }

  async function istanza(p, ruolo, prompt, nome) {
    let atteso = 0;
    const prima = (((dep.verifica(P.wt(p.slug)) || {}).entry) || {}).verdict || '';
    for (let t = 0; ; t += 1) {
      const r = await dep.claude({ ruolo, prompt, cwd: P.wt(p.slug), addDirs: [P.note, P.serverRadice].filter(Boolean), nome });
      const costo = Number(r.costo) || 0;
      p.costo += costo;
      p.istanze.push({ ruolo, giro: p.giriTotali, at: dep.ora(), ok: !!r.ok, costo, riga: primaRiga(r.testo || r.errore).slice(0, 300) });
      salva(p);
      if (!r.ok && passoFatto(p, ruolo, prima)) {
        dep.log(`#${p.num} ${ruolo}: uscito con errore dopo aver fatto il suo passo, non lo rilancio`);
        return r;
      }
      const attesa = r.ok ? 0 : attesaLimite(`${r.errore || ''}\n${r.testo || ''}`, Date.parse(dep.ora()) || Date.now(), opz);
      if (attesa && atteso + attesa <= opz.oreLimite * 60 * 60_000) {
        atteso += attesa;
        t -= 1;
        dep.log(`#${p.num} ${ruolo}: limite d’uso raggiunto, riprovo fra ${Math.round(attesa / 60_000)} min`);
        await dep.dormi(attesa);
        continue;
      }
      if (attesa) return { ...r, errore: `limite d’uso ancora attivo dopo ${opz.oreLimite} ore di attesa: ${primaRiga(r.errore)}` };
      if (r.ok || t >= opz.ritenta || !eTransitorio(r.errore)) return r;
      dep.log(`#${p.num} ${ruolo}: errore transitorio, riprovo`);
      await dep.dormi(opz.pausaMs);
    }
  }

  async function lavora(p) {
    const wtApp = P.wt(p.slug);
    const fp = p.fermoPrima || {};
    // Il compito lo decide lo stato del ramo, non chi stava girando quando il lavoro si è fermato.
    const sospesi = p.compito === 'riallinea' ? '' : rilieviSospesi(dep.verifica(wtApp));
    if (sospesi) p.compito = 'correzione';
    const crit = sospesi || (['decisione', 'correzione'].includes(p.compito) ? (fp.correzione || fp.domanda || fp.motivo || '') : '');
    // Un lavoratore interrotto, o un orchestratore riavviato, lascia commit sul ramo: chi riparte lo sa dal ramo, non dal numero di giri.
    const giaLavoro = p.compito === 'lavoro' && ((await avanti(wtApp)) > 0 || (await serverAvanti(p)) > 0);
    dep.log(`#${p.num} lavoratore (${p.compito})`);
    const r = await istanza(p, 'lavoratore', promptLavoratore({ p, regole: P.regole, wtApp, wtServer: wtServerSeC(p), cartellaNote: P.note, crit, giaLavoro }), `filo #${p.num} lavoratore`);
    const consegnata = p.compito === 'correzione' && ((dep.verifica(wtApp) || {}).entry || {}).verdict === 'fixed';
    if (!r.ok && !consegnata) return ferma(p, `il lavoratore non ha finito: ${primaRiga(r.errore)}`);
    const st = await git(wtApp, 'status', '--porcelain');
    if (String(st.out).trim()) return ferma(p, `${MOTIVO_SPORCO}:\n${coda(st.out)}`, '', { lavoroFinito: true });
    if (p.compito === 'lavoro' && !(await avanti(wtApp)) && !(await serverAvanti(p))) {
      return ferma(p, `il lavoratore non ha lasciato commit sul ramo (sua riga: ${primaRiga(r.testo).slice(0, 200)})`);
    }
    if (p.compito === 'correzione' && ((dep.verifica(wtApp) || {}).entry || {}).verdict === 'fix-pending') {
      return ferma(p, `la correzione non è stata consegnata (sua riga: ${primaRiga(r.testo).slice(0, 200)})`, '', { correzione: crit });
    }
    p.compito = 'lavoro';
    p.risposta = '';
    p.fermoPrima = null;
    p.fase = 'verifica';
    return 'ok';
  }

  // Un ramo con un merge commit va in conflitto col rebase di verify-local start: lo si porta avanti con un merge.
  async function preStart(p, wt) {
    if ((await git(wt, 'fetch', 'origin', 'main')).code !== 0) return 'ok';
    const merges = String((await git(wt, 'rev-list', '--merges', 'origin/main..HEAD')).out).trim();
    if (!merges || !(numero(await git(wt, 'rev-list', '--count', 'HEAD..origin/main')) > 0)) return 'ok';
    if ((await git(wt, 'merge', '--no-edit', 'origin/main')).code !== 0) {
      await git(wt, 'merge', '--abort');
      return 'riallinea';
    }
    await git(wt, 'push', 'origin', `HEAD:refs/heads/${ramoDi(p)}`);
    return 'ok';
  }

  function riallinea(p, perche) {
    p.tentativi.riallinea = (p.tentativi.riallinea || 0) + 1;
    if (p.tentativi.riallinea > opz.ritenta) return ferma(p, `${perche}, anche dopo ${opz.ritenta} riallineamenti`);
    dep.log(`#${p.num} ${perche}: riallineo`);
    p.compito = 'riallinea';
    p.fase = 'lavoro';
    return 'ok';
  }

  async function giro(p) {
    if (p.giri >= opz.tetto) return ferma(p, `tetto dei giri raggiunto (${opz.tetto}) senza un esito superato`);
    const wt = P.wt(p.slug);
    if ((await preStart(p, wt)) === 'riallinea') return riallinea(p, 'il merge di origin/main va in conflitto');
    const primo = !((dep.verifica(wt) || {}).entry || {}).request;
    const args = ['scripts/verify-local.mjs', 'start', ...(primo ? [richiestaArg(p.richiesta), '--feedback', String(p.num)] : [])];
    let s;
    for (let t = 0; ; t += 1) {
      s = await node(wt, args);
      if (s.code === 0 || t >= opz.ritenta || !eTransitorio(s.out)) break;
      await dep.dormi(opz.pausaMs);
    }
    if (s.code !== 0) {
      if (/conflitt/i.test(s.out)) return riallinea(p, 'verify-local start va in conflitto con origin/main');
      return ferma(p, `verify-local start non è partito:\n${coda(s.out)}`);
    }
    const dopoStart = dep.verifica(wt) || {};
    if (dopoStart.entry && dopoStart.entry.feedbackId) p.feedbackId = dopoStart.entry.feedbackId;
    p.giri += 1;
    p.giriTotali += 1;
    salva(p);
    dep.log(`#${p.num} verificatore, giro ${p.giriTotali}`);
    // Solo stdout: i bilanci stanno su stderr apposta, servono a chi guida e non a chi verifica.
    const brief = s.stdout !== undefined ? s.stdout : s.out;
    const r = await istanza(p, 'verificatore', promptVerificatore({ p, regole: P.regole, wtApp: wt, wtServer: wtServerSeC(p), brief, cartellaNote: P.note }), `filo #${p.num} verifica ${p.giriTotali}`);
    if (!r.ok) dep.log(`#${p.num} verificatore uscito con errore: ${primaRiga(r.errore)}`);
    const d = decidiDopoVerifica(dep.verifica(wt), p);
    if (d.ripeti) p.tentativi[d.ripeti] = (p.tentativi[d.ripeti] || 0) + 1;
    else p.tentativi.critica = 0;
    if (d.azione === 'chiudi') { p.fase = 'chiusura'; return 'ok'; }
    if (d.azione === 'giro') return 'ok';
    if (d.correzione && !r.ok) {
      dep.log(`#${p.num} il verificatore è caduto dopo la critica: la correzione la fa un lavoratore`);
      p.compito = 'correzione';
      p.fase = 'lavoro';
      return 'ok';
    }
    return ferma(p, d.motivo, d.domanda, d.correzione ? { correzione: d.correzione } : {});
  }

  async function conRitenta(p, fare, cosa) {
    for (let t = 0; ; t += 1) {
      const r = await fare();
      if (r.code === 0 || t >= opz.ritenta || !eTransitorio(r.out)) return r;
      dep.log(`#${p.num} ${cosa}: rosso transitorio, riprovo a macchina più calma`);
      await dep.dormi(opz.pausaMs);
      await aspettaCalma(true);
    }
  }

  async function fondiApp(p, wt) {
    for (let t = 0; ; t += 1) {
      const r = await node(wt, ['scripts/finish-local.mjs', '--feedback', String(p.num)], 4 * 60 * 60_000);
      const k = classificaFinish(r);
      if (k === 'fuso') return 'ok';
      if (k === 'conflitto') return riallinea(p, 'finish trova un conflitto con main');
      if (k === 'attesa-owner' && p.risposta) {
        dep.log(`#${p.num} fusione non approvata: applico la tua risposta`);
        p.compito = 'decisione';
        p.fase = 'lavoro';
        return 'ok';
      }
      if (k === 'attesa-owner') return ferma(p, 'la fusione aspetta la tua approvazione in Filo (Gestione → Automazioni), poi npm run orchestra -- riprendi', '', { attesaApprovazione: true });
      if ((k === 'superato' || k === 'transitorio') && t < opz.ritenta) {
        dep.log(`#${p.num} finish: ${k}, riprovo`);
        await dep.dormi(opz.pausaMs);
        await aspettaCalma(true);
        continue;
      }
      return ferma(p, `npm run finish non ha fuso (${k}):\n${coda(r.out)}`);
    }
  }

  async function chiudi(p) {
    const wt = P.wt(p.slug);
    await git(wt, 'fetch', 'origin', 'main');
    if (P.serverRadice) await git(P.serverRadice, 'fetch', 'origin');
    const nApp = await avanti(wt);
    const nSrv = await serverAvanti(p);
    const visti = (p.fileApp || []).length;
    const fileApp = String((await git(wt, 'diff', '--name-only', 'origin/main...HEAD')).out || '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (fileApp.length) p.fileApp = fileApp;
    if (nSrv) p.serverDaFondere = true;
    salva(p);
    // Commit che c'erano e ora stanno dentro origin/main senza una fusione registrata: li ha fusi il server
    // (approvazione in Filo, risposta persa, orchestratore chiuso a metà). Si riparte da lì, deploy compreso.
    const dentroMain = async (cwd, ref) => (await git(cwd, 'merge-base', '--is-ancestor', ref, 'origin/main')).code === 0;
    if (!nApp && !fileApp.length && visti && !p.fusa.app && await dentroMain(wt, 'HEAD')) {
      dep.log(`#${p.num} l'app è già su main`);
      p.fusa.app = true;
    }
    if (!nSrv && !p.fusa.server && p.serverDaFondere && P.serverRadice && await dentroMain(P.serverRadice, `refs/heads/${ramoDi(p)}`)) {
      dep.log(`#${p.num} il server è già su main`);
      p.fusa.server = true;
    }
    if (!nApp && !nSrv && !p.fusa.app && !p.fusa.server) return ferma(p, 'niente da fondere: il ramo non ha commit oltre origin/main, né qui né sul server');

    while (chiusure > 0 || !caricoBasta(await dep.carico(), opz, true)) {
      dep.log(`#${p.num} chiusura in attesa: un'altra chiusura in corso o macchina carica`);
      await dep.dormi(opz.pausaMs);
    }
    chiusure += 1;
    try {
      // Server su main, poi l'app (che chiude la pratica), poi il deploy che incorpora il main pubblico appena fuso.
      if (nSrv && !p.fusa.server) {
        await git(P.serverRadice, 'push', 'origin', `refs/heads/${ramoDi(p)}:refs/heads/${ramoDi(p)}`);
        const args = ['scripts/server-fondi-pratica.mjs', ramoDi(p), '--feedback', String(p.num), ...(nApp || p.fusa.app ? [] : ['--solo-server'])];
        dep.log(`#${p.num} server:fondi`);
        const r = await conRitenta(p, () => node(wt, args, 60 * 60_000), 'server:fondi');
        if (r.code !== 0) return ferma(p, `server:fondi non ha fuso:\n${coda(r.out)}`);
        p.fusa.server = true;
        salva(p);
      }
      if (nApp && !p.fusa.app) {
        dep.log(`#${p.num} finish`);
        const e = await fondiApp(p, wt);
        if (e !== 'ok' || p.fase !== 'chiusura') return e;
        p.fusa.app = true;
        salva(p);
      }
      if (serveDeploy(p, p.fileApp) && !p.fusa.deploy) {
        dep.log(`#${p.num} server:pubblica`);
        const r = await conRitenta(p, () => dep.pubblica(), 'server:pubblica');
        if (r.code !== 0) return ferma(p, `fuso, ma il deploy del server non è andato:\n${coda(r.out)}`);
        p.fusa.deploy = true;
        salva(p);
      }
    } finally {
      chiusure -= 1;
    }
    if (toccaRegole(p.fileApp) && !p.avvisi.some((a) => a.startsWith('regole'))) {
      p.avvisi.push('regole cambiate: npm run regole:pubblica dal checkout principale su main, a Filo chiuso');
    }
    await apriDerivati(p);
    if (!opz.tieniWorktree) await pulisci(p);
    p.fase = 'fuso';
    p.fermo = null;
    p.risposta = '';
    dep.log(`#${p.num} fuso`);
    return 'ok';
  }

  async function apriDerivati(p) {
    if (opz.derivati === 'nessuno') return;
    const entry = (dep.verifica(P.wt(p.slug)) || {}).entry || {};
    for (const d of derivatiDaAprire(p, entry.derived)) {
      const r = await dep.esegui('node', ['scripts/claude-feedback.mjs', d.titolo, '-', `--${opz.derivati}`, '--priorita', String(d.priorita)], { cwd: P.wt(p.slug), input: d.testo });
      const m = /#(\d+)/.exec(String(r.out || ''));
      if (r.code === 0) p.derivatiAperti.push({ chiave: d.chiave, titolo: d.titolo, num: m ? Number(m[1]) : null });
      else p.avvisi.push(`feedback non aperto per «${d.titolo}»: ${coda(r.out, 2)}`);
      salva(p);
    }
  }

  async function pulisci(p) {
    p.avvisi.push(...await togliWorktree(dep, p));
  }

  async function guida(p) {
    for (;;) {
      let esito;
      try {
        const passo = passoDalRamo(dep.verifica(P.wt(p.slug)), p);
        if (passo && passo.ferma) esito = ferma(p, passo.ferma, passo.domanda || '');
        else if (passo && passo.fase) { p.fase = passo.fase; p.compito = 'lavoro'; esito = 'ok'; }
        else if (passo && passo.correzione) { p.compito = 'correzione'; p.fase = 'lavoro'; esito = 'ok'; }
        else if (p.fase === 'in-coda') esito = await prepara(p);
        else if (p.fase === 'lavoro') esito = await lavora(p);
        else if (p.fase === 'verifica') esito = await giro(p);
        else if (p.fase === 'chiusura') esito = await chiudi(p);
        else return p;
      } catch (e) {
        esito = ferma(p, `errore dell'orchestratore: ${String((e && e.stack) || e).split('\n').slice(0, 3).join(' · ')}`);
      }
      salva(p);
      if (esito === 'fermo') return p;
    }
  }

  async function toccatiDa(p) {
    if (!dep.fs.esiste(P.wt(p.slug))) return [];
    const r = await git(P.wt(p.slug), 'diff', '--name-only', 'origin/main...HEAD');
    return r.code === 0 ? String(r.out).split('\n').map((x) => x.trim()).filter(Boolean) : [];
  }

  /** Parte quello che si può (posti, carico, file in comune); esce quando non resta niente da guidare. */
  async function avvia() {
    const attivi = new Map();
    for (;;) {
      const stato = dep.store.leggi();
      const daFare = (stato.coda || []).map((n) => stato.pratiche[n])
        .filter((p) => p && !FASI_FINITE.includes(p.fase) && !attivi.has(p.num));
      if (!daFare.length && !attivi.size) return dep.store.leggi();
      const vivi = [];
      for (const a of attivi.values()) vivi.push({ file: a.p.file, toccati: await toccatiDa(a.p) });
      for (const p of daFare) {
        if (attivi.size >= opz.paralleli) break;
        const io = { file: p.file, toccati: await toccatiDa(p) };
        if (vivi.some((v) => siSovrappongono(io, v))) continue;
        if (attivi.size && !caricoBasta(await dep.carico(), opz)) break;
        p.tentativi = p.tentativi || {};
        if (p.fase === 'in-coda' || p.ripreso) p.giri = 0;
        delete p.ripreso;
        dep.log(`#${p.num} parte (${p.fase})`);
        const corsa = guida(p).finally(() => attivi.delete(p.num));
        attivi.set(p.num, { p, corsa });
        vivi.push(io);
      }
      const corse = [...attivi.values()].map((a) => a.corsa);
      await Promise.race([...corse, dep.dormi(opz.pausaMs)]);
    }
  }

  return { avvia, guida, opz };
}
