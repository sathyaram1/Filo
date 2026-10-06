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
  // 0 = nessun numero fisso: un'istanza nuova parte finché processore e memoria lo permettono (#1041).
  paralleli: 0,
  // 0 = nessun tetto proprio: i giri li limitano i bilanci del server, come nelle sessioni in cloud (#1036).
  tetto: 0,
  cpuMax: 80,
  // Il test a tempo del 2FA cade sotto carico (#943): la chiusura aspetta una macchina più calma.
  cpuChiusura: 60,
  memMinGB: 2,
  ritenta: 2,
  pausaMs: 60_000,
  // Il limite d'uso dell'abbonamento si aspetta (un quarto d'ora per volta, se non dice quando riparte); oltre il tetto il lavoro si ferma col motivo.
  pausaLimiteMs: 15 * 60_000,
  oreLimite: 12,
  // auto = ogni rilievo dove si può lavorare: in locale solo ciò che si fa solo qui, il resto alle routine.
  derivati: 'auto',
  tieniWorktree: false,
});

export const MODI_DERIVATI = Object.freeze(['auto', 'non-locale', 'locale', 'nessuno']);

/**
 * Chi fa il passo di lavoro, come nelle routine: il primo lavoro ha il suo ruolo (sforzo più alto); correzione,
 * riallineamento e ripresa di un lavoro fermo un altro. Modello e sforzo per ruolo li legge la riga di comando. PURA.
 */
export function ruoloDelLavoro(p) {
  if (p.compito === 'correzione') return 'correttore';
  if (p.compito === 'riallinea') return 'riallineatore';
  if (p.compito === 'decisione' || p.fermoPrima) return 'ripresa';
  return 'lavoratore';
}

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
    num: n, slug: s, richiesta: String(richiesta || '').trim(), file: (Array.isArray(file) ? file : []).filter(Boolean),
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

const chiaveRilievo = (f) => `${f.level}${f.sede}:${String(f.text).slice(0, 80)}`;

/** Come togli apre i rilievi rimasti: come li apriva l'avvia che ha guidato il lavoro. PURA. */
export const modoDerivati = (p) => (p && p.derivati) || OPZIONI_BASE.derivati;

// Si fa solo in locale (LOCAL.md): il server e i suoi deploy, le regole pubblicate, le impostazioni dell'owner. Il resto alle routine.
const SOLO_IN_LOCALE = /filo-security|\bfunctions[/\\]|\b(firestore|storage)\.rules\b|firestore\.indexes|\b(ri)?deploy|server:(pubblica|fondi)|regole:pubblica|console (di |del )?Firebase|Firebase console|\bSecrets? (di|su) GitHub|GitHub Secrets?|\bruleset\b|token admin|FILO_ADMIN_/i;

/** Chi lavora un rilievo messo da parte: 'locale' solo se si fa soltanto in locale, sennò le routine. PURA. */
export function doveSiLavora(f) {
  return SOLO_IN_LOCALE.test(String((f && f.text) || '')) ? 'locale' : 'non-locale';
}

/**
 * I feedback da aprire per i rilievi che il lavoro non ha corretto, raggruppati come li apre il server. PURA.
 * Il registro accumula i messi da parte giro dopo giro: si salta il singolo rilievo già aperto, non il gruppo, o ogni giro ripete i precedenti.
 * Con `auto` i rilievi da lavorare in locale e quelli per le routine finiscono in feedback separati.
 */
export function derivatiDaAprire(p, derived, modo = 'auto') {
  const fatti = new Set((p.derivatiAperti || []).flatMap((d) => (Array.isArray(d.chiavi) ? d.chiavi : String(d.chiave || '').split('|'))));
  const nuovi = ROUND.derivedGroups(Array.isArray(derived) ? derived : []).flatMap((g) => g.findings).filter((f) => !fatti.has(chiaveRilievo(f)));
  const dove = (f) => (modo === 'auto' ? doveSiLavora(f) : modo);
  return ['non-locale', 'locale'].flatMap((qui) => ROUND.derivedGroups(nuovi.filter((f) => dove(f) === qui)).map((g) => {
    const chiavi = g.findings.map(chiaveRilievo);
    const chiave = chiavi.join('|');
    const prima = primaRiga(g.findings[0].text).replace(/\s+/g, ' ').trim();
    const titolo = g.tipo === 'rimasti' && g.findings.length > 1
      ? `Rilievi rimasti del lavoro locale #${p.num}${qui === 'locale' && modo === 'auto' ? ' (da fare in locale)' : ''}`
      : (prima.length > 90 ? `${prima.slice(0, 89)}…` : prima);
    const testo = [
      `Rilievo messo da parte nella verifica del lavoro locale #${p.num} (ramo ${ramoDi(p)}): ${ROUND.groupLabel(g)}.`,
      '',
      ROUND.formatFindings(g.findings),
    ].join('\n');
    return { chiave, chiavi, titolo, testo, priorita: g.priority, dove: qui };
  }));
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

// Il verificatore ha una cartella sua: in quella dell'orchestratore stanno le note e le risposte di chi ha lavorato.
export const cartellaVerificatore = (note, num) => `${note}/verifica-${num}`;

/** Il compito del verificatore: il testo di verify-local start, intero, e il dove. Niente diff, niente report. PURA. */
export function promptVerificatore({ p, regole, wtApp, wtServer, brief, cartellaNote = '' }) {
  return [
    ...testa(regole),
    'Sei un verificatore di una sessione locale di Filo, istanza nuova, lanciato dall’orchestratore automatico (#956). Segui le regole fisse qui sopra.',
    `Lavori nel worktree \`${wtApp}\` (ramo ${ramoDi(p)}).${wtServer ? ` La parte server dello stesso lavoro sta nel worktree \`${wtServer}\` di filo-security, stesso ramo.` : ''}`,
    ...(cartellaNote ? [
      `Cartella temporanea, fuori dal repo, per script di prova, log, appunti e la nota \`note-${p.num}.md\`: \`${cartellaNote}\`.`,
      'Non leggere le note e le risposte di chi ha lavorato: stanno nella cartella dell’orchestratore, fuori da questa, e per te valgono come il diff.',
    ] : []),
    'Segui per intero il compito qui sotto e poi la risposta del server alla critica, qualunque cosa dica.',
    'Rispondi con una riga sola: esito del server e ultimo sha del ramo.',
    '',
    '════ COMPITO ════',
    String(brief || '').trim(),
  ].join('\n');
}

const oraBreve = (iso) => String(iso || '').slice(11, 16);

/** Una riga per pratica, per chi guarda (npm run orchestra -- stato). `vivo`: l'orchestratore che la guida gira ancora. PURA. */
export function rigaStato(p, { vivo = true } = {}) {
  const costo = p.costo ? ` · ${Number(p.costo).toFixed(2)} $` : '';
  const giri = p.giriTotali ? ` · giri ${p.giriTotali}` : '';
  let r = `#${p.num} ${ramoDi(p)}: ${p.fase}${p.fase === 'lavoro' && p.compito !== 'lavoro' ? ` (${p.compito})` : ''}${giri}${costo}`;
  if (p.inCorso) {
    r += vivo
      ? `\n    in corso: ${p.inCorso.cosa} (dalle ${oraBreve(p.inCorso.da)})`
      : `\n    interrotto: ${p.inCorso.cosa}, l’orchestratore si è chiuso a metà; riparte col prossimo «avvia»`;
  }
  if (p.interrotto) r += `\n    lasciato a metà (${p.interrotto.come === 'subito' ? 'fermata immediata' : 'chiusura con calma'}): ${p.interrotto.cosa}; il prossimo «avvia» rifà il passo`;
  if (p.attesa) r += `\n    in attesa: ${p.attesa}`;
  if (p.fermo) r += `\n    fermo: ${p.fermo.motivo}${p.fermo.domanda ? `\n    domanda:\n${p.fermo.domanda.replace(/^/gm, '      ')}` : ''}`;
  if (p.fermo && p.fermo.azione) r += `\n    da fare: ${p.fermo.azione}`;
  if (p.derivatiAperti && p.derivatiAperti.length) {
    r += `\n    feedback aperti dai rilievi: ${p.derivatiAperti.map((d) => `${d.num ? `#${d.num}` : d.titolo}${d.dove === 'locale' ? ' (locale)' : ''}`).join(', ')}`;
  }
  for (const a of p.avvisi || []) r += `\n    avviso: ${a}`;
  return r;
}

/** La riga di `stato` per un orchestratore a cui è stato chiesto di smettere. r = { modo, at }, inCorso = pratiche con un'istanza viva. PURA. */
export function rigaChiusura(r, inCorso = []) {
  const come = r.modo === 'subito' ? 'In chiusura immediata' : 'In chiusura con calma';
  const n = inCorso.length;
  const quali = inCorso.map((p) => `#${p.num} ${p.inCorso.cosa} (dalle ${oraBreve(p.inCorso.da)})`).join(', ');
  if (!n) return `${come} (chiesta alle ${oraBreve(r.at)}): niente più in corso, sta uscendo.`;
  return r.modo === 'subito'
    ? `${come} (chiesta alle ${oraBreve(r.at)}): sto fermando ${n === 1 ? 'un’istanza' : `${n} istanze`}: ${quali}.`
    : `${come} (chiesta alle ${oraBreve(r.at)}): non avvia altro, aspetta ${n === 1 ? 'un’istanza' : `${n} istanze`}: ${quali}.`;
}

// Una domanda lunga nella nota resta leggibile; intera la mostra `stato`, e la nota lo dice.
const DOMANDA_NELLA_NOTA = 4000;

/** La nota sulla pratica del feedback quando il lavoro si ferma: cosa è successo e cosa deve fare l'owner, in chiaro. PURA. */
export function notaPerOwner(p, f) {
  const riprendiCmd = (conRisposta) => `\`npm run orchestra -- riprendi ${p.num}${conRisposta ? ' "<la tua risposta>"' : ''}\``;
  if (f.attesaApprovazione) {
    return [
      'Orchestratore locale: il lavoro è pronto e la fusione aspetta il tuo sì.',
      `Cosa fare: approvala in Filo (Gestione → Automazioni), poi ${riprendiCmd(false)}.`,
    ].join('\n');
  }
  if (f.domanda) {
    const d = String(f.domanda).trim();
    const corta = d.length > DOMANDA_NELLA_NOTA
      ? `${d.slice(0, DOMANDA_NELLA_NOTA)}\n[… la domanda continua: ${d.length} caratteri in tutto, intera con \`npm run orchestra -- stato\`]`
      : d;
    return [
      `Orchestratore locale: il lavoro si è fermato e serve una tua scelta (${primaRiga(f.motivo)}).`,
      '', corta, '',
      `Cosa fare: rispondi con ${riprendiCmd(true)}.`,
    ].join('\n');
  }
  if (f.azione) return `Orchestratore locale: ${primaRiga(f.motivo)}.\nCosa fare: ${f.azione}`;
  return [
    `Orchestratore locale: lavoro fermo, ${primaRiga(f.motivo)}.`,
    `Cosa fare: il motivo intero è in \`npm run orchestra -- stato\`; poi ${riprendiCmd(false)}, con una risposta fra virgolette se serve una scelta.`,
  ].join('\n');
}

/**
 * Le regole cambiate si pubblicano dal checkout principale su main = origin/main, a Filo chiuso (#1036). PURA.
 * s = { filoAperto, reteGiu, ramo, testa, origine, indietro, toccati } → { azione: 'aspetta'|'allinea'|'pubblica'|'owner', motivo, fai }
 */
export function decidiRegole(s, num) {
  const poi = `poi \`npm run orchestra -- riprendi ${num}\``;
  if (s.filoAperto) return { azione: 'aspetta', motivo: 'Filo è aperto: le regole cambiate si pubblicano appena lo chiudi' };
  if (s.reteGiu) return { azione: 'aspetta', motivo: `origin/main non si legge (${s.reteGiu}): riprovo` };
  if (s.ramo !== 'main') {
    return { azione: 'owner', motivo: `fuso, ma le regole cambiate non si pubblicano: il checkout principale è su «${s.ramo || 'testa staccata'}», non su main`, fai: `riporta il checkout principale su main (git switch main), ${poi}.` };
  }
  if ((s.toccati || []).length) {
    return { azione: 'owner', motivo: `fuso, ma le regole cambiate non si pubblicano: nel checkout principale ${s.toccati.join(', ')} hanno modifiche non fuse`, fai: `togli o metti da parte quelle modifiche, ${poi}.` };
  }
  if (s.testa && s.testa === s.origine) return { azione: 'pubblica' };
  if (s.indietro) return { azione: 'allinea' };
  return { azione: 'owner', motivo: 'fuso, ma le regole cambiate non si pubblicano: il main del checkout principale ha commit che origin/main non ha', fai: `riallinealo a origin/main, ${poi}.` };
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

const avvisaUnaVolta = (p, a) => { p.avvisi = p.avvisi || []; if (!p.avvisi.includes(a)) p.avvisi.push(a); };

/**
 * Apre come feedback i rilievi esterni e messi da parte che il registro della verifica ha e la pratica non ha ancora aperto.
 * La usano il motore dopo ogni passo e togli prima di rimuovere il worktree, che quel registro se lo porta via. → quanti non aperti.
 */
export async function apriDerivatiDi(dep, p, { derivati = OPZIONI_BASE.derivati, salva = () => {} } = {}) {
  if (derivati === 'nessuno') return 0;
  const wt = dep.percorsi.wt(p.slug);
  const entry = (dep.verifica(wt) || {}).entry || {};
  p.derivatiAperti = p.derivatiAperti || [];
  let falliti = 0;
  for (const d of derivatiDaAprire(p, entry.derived, derivati)) {
    const r = await dep.esegui('node', ['scripts/claude-feedback.mjs', d.titolo, '-', `--${d.dove}`, '--priorita', String(d.priorita)], { cwd: wt, input: d.testo });
    const m = /#(\d+)/.exec(String(r.out || ''));
    if (r.code === 0) p.derivatiAperti.push({ chiave: d.chiave, chiavi: d.chiavi, titolo: d.titolo, num: m ? Number(m[1]) : null, dove: d.dove });
    else { falliti += 1; avvisaUnaVolta(p, `feedback non aperto per «${d.titolo}»: ${coda(r.out, 2)}`); }
    salva(p);
  }
  return falliti;
}

/** Un passo lasciato a metà perché è stato chiesto di smettere: chi guida lo rimette dov'era e il prossimo avvia lo rifà. */
export class Interrotto extends Error {
  constructor(cosa) {
    super(`interrotto: ${cosa}`);
    this.cosa = cosa;
  }
}

/**
 * Il motore. dep = {
 *   store: { leggi() → { coda, pratiche }, salvaPratica(p) },
 *   esegui(cmd, args, { cwd, input, timeoutMs }) → { code, stdout, out },   // out = stdout + stderr
 *   claude({ ruolo, prompt, cwd, addDirs, nome }) → { ok, testo, costo, errore },
 *   verifica(wtApp) → { ok, entry, dirty }, pubblica() → { code, out }, filoAperto() → bool,
 *   carico() → { cpu, liberaGB }, dormi(ms), log(riga), ora() → ISO,
 *   percorsi: { radice, wt(slug), serverRadice ('' se manca), wtServer(slug), note, regole },
 *   fs: { esiste(p), collega(verso, link), scollega(link) }, annota(numero o id, testo), richiestaDi(num),
 * }
 * smetti('calma'): nessuna istanza nuova, i passi in corso arrivano in fondo. smetti('subito'): i processi li ferma chi
 * lancia, e il motore rimette dov'erano i passi interrotti (#1043).
 */
export function creaMotore(dep, opzioni = {}) {
  const opz = { ...OPZIONI_BASE, ...opzioni };
  const P = dep.percorsi;
  let chiusure = 0;
  let chiusura = '';
  let segnaCalma;
  let segnaSubito;
  const suCalma = new Promise((ok) => { segnaCalma = ok; });
  const suSubito = new Promise((ok) => { segnaSubito = ok; });
  let vive = 0;
  let ultimoAvvio = -Infinity;
  // Chi aspetta il posto per un'istanza, in ordine d'arrivo; chi è pronto a chiudere, o chiude, ferma le istanze nuove (#1041).
  const fila = [];
  const inChiusura = new Set();
  const inVolo = new Set();

  function smetti(modo = 'calma') {
    if (modo === 'subito') { chiusura = 'subito'; segnaSubito(); } else if (!chiusura) chiusura = 'calma';
    segnaCalma();
    return chiusura;
  }

  const adesso = () => Date.parse(dep.ora()) || Date.now();
  // Un'attesa che una chiusura chiesta abbandona: il passo resta da fare.
  async function attendi(ms, cosa) {
    if (chiusura) throw new Interrotto(cosa);
    await Promise.race([dep.dormi(ms), suCalma]);
    if (chiusura) throw new Interrotto(cosa);
  }
  // Una pausa dentro una chiusura già partita: con calma la si finisce, la ferma solo «subito».
  async function pausa(ms, cosa) {
    if (chiusura === 'subito') throw new Interrotto(cosa);
    await Promise.race([dep.dormi(ms), suSubito]);
    if (chiusura === 'subito') throw new Interrotto(cosa);
  }
  // Dopo «subito» l'esito di un processo fermato a metà non vale niente: il passo si rifà.
  async function esegui(cmd, args, o) {
    const cosa = cmd === 'node' ? String(args[0] || 'node') : `${cmd} ${args[0] || ''}`.trim();
    if (chiusura === 'subito') throw new Interrotto(cosa);
    const r = await dep.esegui(cmd, args, o);
    if (chiusura === 'subito') throw new Interrotto(`${cosa} fermato a metà`);
    return r;
  }
  const depM = { ...dep, esegui };

  const salva = (p) => { p.aggiornato = dep.ora(); dep.store.salvaPratica(p); };
  const git = (cwd, ...args) => esegui('git', args, { cwd });
  const node = (cwd, args, timeoutMs) => esegui('node', args, { cwd, timeoutMs });
  const numero = (r) => (r.code === 0 ? Number(String(r.out).trim()) || 0 : 0);

  function ferma(p, motivo, domanda = '', altro = {}) {
    // Un processo fermato da «subito» non è una fermata: niente nota all'owner, il passo si rifà.
    if (chiusura === 'subito') throw new Interrotto(primaRiga(motivo));
    const dove = p.fase;
    const verdetto = chiaveVerdetto(((dep.verifica(P.wt(p.slug)) || {}).entry) || null);
    p.fase = 'fermo';
    p.attesa = '';
    p.fermo = { motivo, ...(domanda ? { domanda } : {}), dove, ...(verdetto ? { verdetto } : {}), ...altro, at: dep.ora() };
    dep.log(`#${p.num} fermo: ${primaRiga(motivo)}`);
    if (dep.annota) {
      const avvisa = (perche) => { avvisaUnaVolta(p, `nota per l’owner non scritta sulla pratica: ${perche}`); salva(p); };
      const v = Promise.resolve()
        .then(() => dep.annota(p.feedbackId || String(p.num), notaPerOwner(p, p.fermo)))
        .then((r) => { if (r && r.ok === false) avvisa(r.motivo || 'rifiutata'); }, (e) => avvisa(primaRiga(String((e && e.message) || e))))
        .finally(() => inVolo.delete(v));
      inVolo.add(v);
    }
    return 'fermo';
  }

  const avanti = async (cwd) => numero(await git(cwd, 'rev-list', '--count', 'origin/main..HEAD'));
  const serverAvanti = async (p) => (P.serverRadice ? numero(await git(P.serverRadice, 'rev-list', '--count', `origin/main..refs/heads/${ramoDi(p)}`)) : 0);
  const wtServerSeC = (p) => {
    const w = P.serverRadice ? P.wtServer(p.slug) : '';
    return w && dep.fs.esiste(w) ? w : '';
  };
  const aspettaCalma = async (perChiusura, cosa) => {
    while (!caricoBasta(await dep.carico(), opz, perChiusura)) await pausa(opz.pausaMs, cosa);
  };

  async function prepara(p) {
    const wt = P.wt(p.slug);
    // Una richiesta di soli spazi arriverebbe vuota a lavoratore e verifica (#1027): vale quella del feedback.
    if (!String(p.richiesta || '').trim()) p.richiesta = String(await dep.richiestaDi(p.num) || '').trim();
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

  const altraChiude = (p) => [...inChiusura].some((n) => n !== p.num);

  // Il posto per un'istanza nuova (#1041): prima chi aspetta da più tempo, mai mentre un altro lavoro chiude; con altre
  // istanze vive solo a macchina sotto le soglie e dopo una pausa dall'ultimo avvio, perché il carico nuovo si faccia vedere.
  async function postoIstanza(p, cosa) {
    fila.push(p.num);
    try {
      for (;;) {
        if (chiusura) throw new Interrotto(cosa);
        if (fila[0] === p.num && !altraChiude(p)) {
          const ok = !vive || (adesso() - ultimoAvvio >= opz.pausaMs && caricoBasta(await dep.carico(), opz));
          if (chiusura) throw new Interrotto(cosa);
          if (ok && !altraChiude(p)) { vive += 1; ultimoAvvio = adesso(); return; }
        }
        await attendi(opz.pausaMs, cosa);
      }
    } finally {
      fila.splice(fila.indexOf(p.num), 1);
    }
  }

  // Un'istanza di Claude: il posto, il segno «in corso» per chi guarda, il costo registrato anche se poi la si ferma.
  async function lancia(p, ruolo, args) {
    await postoIstanza(p, `${ruolo} non lanciato`);
    p.inCorso = { cosa: ruolo, da: dep.ora() };
    salva(p);
    let r;
    try {
      r = await dep.claude(args);
    } finally {
      vive -= 1;
      p.inCorso = null;
    }
    const costo = Number(r.costo) || 0;
    p.costo += costo;
    p.istanze.push({ ruolo, giro: p.giriTotali, at: dep.ora(), ok: !!r.ok, costo, riga: primaRiga(r.testo || r.errore).slice(0, 300) });
    salva(p);
    if (chiusura === 'subito') throw new Interrotto(`${ruolo} fermato a metà`);
    return r;
  }

  async function istanza(p, ruolo, prompt, nome, cartella = P.note) {
    let atteso = 0;
    const prima = (((dep.verifica(P.wt(p.slug)) || {}).entry) || {}).verdict || '';
    for (let t = 0; ; t += 1) {
      const r = await lancia(p, ruolo, { ruolo, prompt, cwd: P.wt(p.slug), addDirs: [cartella, P.serverRadice].filter(Boolean), nome });
      if (!r.ok && passoFatto(p, ruolo, prima)) {
        dep.log(`#${p.num} ${ruolo}: uscito con errore dopo aver fatto il suo passo, non lo rilancio`);
        return r;
      }
      const attesa = r.ok ? 0 : attesaLimite(`${r.errore || ''}\n${r.testo || ''}`, adesso(), opz);
      if (attesa && atteso + attesa <= opz.oreLimite * 60 * 60_000) {
        atteso += attesa;
        t -= 1;
        dep.log(`#${p.num} ${ruolo}: limite d’uso raggiunto, riprovo fra ${Math.round(attesa / 60_000)} min`);
        await attendi(attesa, `${ruolo} in attesa del limite d’uso`);
        continue;
      }
      if (attesa) return { ...r, errore: `limite d’uso ancora attivo dopo ${opz.oreLimite} ore di attesa: ${primaRiga(r.errore)}` };
      if (r.ok || t >= opz.ritenta || !eTransitorio(r.errore)) return r;
      dep.log(`#${p.num} ${ruolo}: errore transitorio, riprovo`);
      await attendi(opz.pausaMs, `${ruolo} da rilanciare dopo un errore transitorio`);
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
    const ruolo = ruoloDelLavoro(p);
    dep.log(`#${p.num} ${ruolo} (${p.compito})`);
    const r = await istanza(p, ruolo, promptLavoratore({ p, regole: P.regole, wtApp, wtServer: wtServerSeC(p), cartellaNote: P.note, crit, giaLavoro }), `filo #${p.num} ${ruolo}`);
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
    if (opz.tetto && p.giri >= opz.tetto) return ferma(p, `tetto dei giri raggiunto (${opz.tetto}) senza un esito superato`);
    if (chiusura) throw new Interrotto('verifica non partita');
    const wt = P.wt(p.slug);
    if ((await preStart(p, wt)) === 'riallinea') return riallinea(p, 'il merge di origin/main va in conflitto');
    const primo = !((dep.verifica(wt) || {}).entry || {}).request;
    const args = ['scripts/verify-local.mjs', 'start', ...(primo ? [richiestaArg(p.richiesta), '--feedback', String(p.num)] : [])];
    let s;
    for (let t = 0; ; t += 1) {
      s = await node(wt, args);
      if (s.code === 0 || t >= opz.ritenta || !eTransitorio(s.out)) break;
      await attendi(opz.pausaMs, 'verify-local start da rilanciare');
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
    const cv = cartellaVerificatore(P.note, p.num);
    const r = await istanza(p, 'verificatore', promptVerificatore({ p, regole: P.regole, wtApp: wt, wtServer: wtServerSeC(p), brief, cartellaNote: cv }), `filo #${p.num} verifica ${p.giriTotali}`, cv);
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

  // Un processo lungo della chiusura, segnato «in corso» per chi guarda e per chi chiede di smettere.
  async function conInCorso(p, cosa, fare) {
    p.inCorso = { cosa, da: dep.ora() };
    salva(p);
    try {
      return await fare();
    } finally {
      p.inCorso = null;
    }
  }

  async function conRitenta(p, fare, cosa) {
    for (let t = 0; ; t += 1) {
      const r = await fare();
      if (r.code === 0 || t >= opz.ritenta || !eTransitorio(r.out)) return r;
      dep.log(`#${p.num} ${cosa}: rosso transitorio, riprovo a macchina più calma`);
      await pausa(opz.pausaMs, cosa);
      await aspettaCalma(true, cosa);
    }
  }

  async function fondiApp(p, wt) {
    for (let t = 0; ; t += 1) {
      const r = await conInCorso(p, 'finish', () => node(wt, ['scripts/finish-local.mjs', '--feedback', String(p.num)], 4 * 60 * 60_000));
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
        await pausa(opz.pausaMs, 'finish');
        await aspettaCalma(true, 'finish');
        continue;
      }
      return ferma(p, `npm run finish non ha fuso (${k}):\n${coda(r.out)}`);
    }
  }

  // Server su main, poi l'app (che chiude la pratica), poi il deploy che incorpora il main pubblico appena fuso; infine i
  // rilievi rimasti come feedback e i worktree tolti. Una chiusura partita arriva in fondo anche se si chiede di smettere.
  async function fondi(p) {
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

    inChiusura.add(p.num);
    try {
      // Il carico si misura con un'attesa: dopo, il posto si rilegge senza altre attese prima di prenderlo, o due chiusure partono insieme.
      while (chiusure > 0 || !caricoBasta(await dep.carico(), opz, true) || chiusure > 0) {
        dep.log(`#${p.num} chiusura in attesa: un'altra chiusura in corso o macchina carica`);
        await attendi(opz.pausaMs, 'chiusura non partita');
      }
      chiusure += 1;
      try {
        if (nSrv && !p.fusa.server) {
          await git(P.serverRadice, 'push', 'origin', `refs/heads/${ramoDi(p)}:refs/heads/${ramoDi(p)}`);
          const args = ['scripts/server-fondi-pratica.mjs', ramoDi(p), '--feedback', String(p.num), ...(nApp || p.fusa.app ? [] : ['--solo-server'])];
          dep.log(`#${p.num} server:fondi`);
          const r = await conInCorso(p, 'server:fondi', () => conRitenta(p, () => node(wt, args, 60 * 60_000), 'server:fondi'));
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
          const r = await conInCorso(p, 'server:pubblica', () => conRitenta(p, () => dep.pubblica(), 'server:pubblica'));
          if (r.code !== 0) return ferma(p, `fuso, ma il deploy del server non è andato:\n${coda(r.out)}`);
          p.fusa.deploy = true;
          salva(p);
        }
      } finally {
        chiusure -= 1;
      }
    } finally {
      inChiusura.delete(p.num);
    }
    await apriDerivati(p);
    if (!opz.tieniWorktree) await pulisci(p);
    p.fusioneFatta = true;
    salva(p);
    return 'ok';
  }

  async function statoCheckout() {
    const R = P.radice;
    if (dep.filoAperto && await dep.filoAperto()) return { filoAperto: true };
    const f = await git(R, 'fetch', 'origin', 'main');
    if (f.code !== 0) return { reteGiu: coda(f.out, 1) || 'git fetch non riuscito' };
    const uscita = (r) => String(r.stdout !== undefined ? r.stdout : r.out);
    const testo = async (...a) => { const r = await git(R, ...a); return r.code === 0 ? uscita(r).trim() : ''; };
    const ramo = await testo('rev-parse', '--abbrev-ref', 'HEAD');
    const st = await git(R, 'status', '--porcelain', '--', ...FILE_REGOLE);
    return {
      ramo: ramo === 'HEAD' ? '' : ramo,
      testa: await testo('rev-parse', 'HEAD'),
      origine: await testo('rev-parse', 'origin/main'),
      indietro: (await git(R, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main')).code === 0,
      toccati: st.code === 0 ? uscita(st).split('\n').map((x) => x.slice(3).trim()).filter(Boolean) : [],
    };
  }

  // Regole cambiate: le pubblica il motore stesso, a Filo chiuso e dal main allineato; se Filo è aperto aspetta (#1036).
  async function pubblicaRegole(p) {
    const riprendiCmd = `\`npm run orchestra -- riprendi ${p.num}\``;
    let allineamenti = 0;
    for (let t = 0; ;) {
      const d = decidiRegole(await statoCheckout(), p.num);
      if (d.azione === 'aspetta') {
        if (p.attesa !== d.motivo) { p.attesa = d.motivo; salva(p); dep.log(`#${p.num} ${d.motivo}`); }
        await attendi(opz.pausaMs, 'regole cambiate ancora da pubblicare');
        continue;
      }
      p.attesa = '';
      if (d.azione === 'owner') return ferma(p, d.motivo, '', { azione: d.fai });
      if (d.azione === 'allinea') {
        allineamenti += 1;
        const r = allineamenti > 3 ? { code: 1, out: 'il checkout resta indietro dopo tre allineamenti' } : await git(P.radice, 'merge', '--ff-only', 'origin/main');
        if (r.code !== 0) {
          return ferma(p, `fuso, ma le regole cambiate non si pubblicano: il checkout principale non si allinea a origin/main:\n${coda(r.out)}`, '', { azione: `allinealo tu (git pull --ff-only), poi ${riprendiCmd}.` });
        }
        dep.log(`#${p.num} checkout principale allineato a origin/main per pubblicare le regole`);
        continue;
      }
      dep.log(`#${p.num} regole:pubblica`);
      const r = await conInCorso(p, 'regole:pubblica', () => node(P.radice, ['scripts/regole-pubblica.mjs'], 30 * 60_000));
      if (r.code === 0) {
        p.regolePubblicate = true;
        salva(p);
        return 'ok';
      }
      if (eTransitorio(r.out) && t < opz.ritenta) {
        t += 1;
        dep.log(`#${p.num} regole:pubblica: errore transitorio, riprovo`);
        await attendi(opz.pausaMs, 'regole:pubblica da rilanciare');
        continue;
      }
      return ferma(p, `fuso, ma regole:pubblica non è andato:\n${coda(r.out)}`, '', { azione: `guarda l’errore in \`npm run orchestra -- stato\`, poi ${riprendiCmd}.` });
    }
  }

  async function chiudi(p) {
    if (!p.fusioneFatta) {
      const e = await fondi(p);
      if (e !== 'ok' || p.fase !== 'chiusura') return e;
    }
    if (toccaRegole(p.fileApp) && !p.regolePubblicate) {
      const e = await pubblicaRegole(p);
      if (e !== 'ok') return e;
    }
    p.fase = 'fuso';
    p.fermo = null;
    p.risposta = '';
    p.attesa = '';
    dep.log(`#${p.num} fuso`);
    return 'ok';
  }

  const apriDerivati = (p) => apriDerivatiDi(depM, p, { derivati: opz.derivati, salva });

  async function pulisci(p) {
    p.avvisi.push(...await togliWorktree(depM, p));
  }

  async function guida(p) {
    for (;;) {
      if (chiusura) return p;
      const prima = { fase: p.fase, compito: p.compito, giri: p.giri, giriTotali: p.giriTotali };
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
        if (e instanceof Interrotto || chiusura === 'subito') {
          Object.assign(p, prima, { inCorso: null, attesa: '' });
          p.interrotto = { fase: prima.fase, cosa: e instanceof Interrotto ? e.cosa : primaRiga(String((e && e.message) || e)), come: chiusura || 'calma', at: dep.ora() };
          dep.log(`#${p.num} lasciato a metà (${p.interrotto.cosa}): il prossimo avvia riparte da ${prima.fase}`);
          salva(p);
          return p;
        }
        esito = ferma(p, `errore dell'orchestratore: ${String((e && e.stack) || e).split('\n').slice(0, 3).join(' · ')}`);
      }
      // Dopo ogni passo, non solo alla fusione: un lavoro che si ferma o viene tolto non tiene nascosti esterni e messi da parte.
      if (p.fase !== 'fuso') {
        try { await apriDerivati(p); } catch (e) {
          if (!(e instanceof Interrotto)) avvisaUnaVolta(p, `feedback dei rilievi non aperti: ${primaRiga(String((e && e.message) || e))}`);
        }
      }
      salva(p);
      if (esito === 'fermo') return p;
    }
  }

  // Solo lettura: non passa dal controllo di «subito», o l'ammissione di un lavoro cadrebbe a metà.
  async function toccatiDa(p) {
    if (!dep.fs.esiste(P.wt(p.slug))) return [];
    const r = await dep.esegui('git', ['diff', '--name-only', 'origin/main...HEAD'], { cwd: P.wt(p.slug) });
    return r.code === 0 ? String(r.out).split('\n').map((x) => x.trim()).filter(Boolean) : [];
  }

  /** Fa partire i lavori uno per volta (file in comune, carico, chiusure); esce quando non resta niente da guidare o è stato chiesto di smettere. */
  async function avvia() {
    const attivi = new Map();
    for (;;) {
      const stato = dep.store.leggi();
      const daFare = (stato.coda || []).map((n) => stato.pratiche[n])
        .filter((p) => p && !FASI_FINITE.includes(p.fase) && !attivi.has(p.num));
      if (!attivi.size && (chiusura || !daFare.length)) {
        await Promise.allSettled([...inVolo]);
        return dep.store.leggi();
      }
      // Un lavoro nuovo per giro, e solo se nessuno aspetta un posto né sta chiudendo: le istanze le regola postoIstanza.
      if (!chiusura && !fila.length && !inChiusura.size && !(opz.paralleli && attivi.size >= opz.paralleli)) {
        const vivi = [];
        for (const a of attivi.values()) vivi.push({ file: a.p.file, toccati: await toccatiDa(a.p) });
        for (const p of daFare) {
          const io = { file: p.file, toccati: await toccatiDa(p) };
          if (vivi.some((v) => siSovrappongono(io, v))) continue;
          if ((attivi.size && !caricoBasta(await dep.carico(), opz)) || chiusura) break;
          p.tentativi = p.tentativi || {};
          if (p.fase === 'in-coda' || p.ripreso) p.giri = 0;
          for (const k of ['ripreso', 'interrotto', 'inCorso', 'attesa']) delete p[k];
          p.derivati = opz.derivati;
          dep.log(`#${p.num} parte (${p.fase})`);
          const corsa = guida(p).finally(() => attivi.delete(p.num));
          attivi.set(p.num, { p, corsa });
          break;
        }
      }
      const corse = [...attivi.values()].map((a) => a.corsa);
      if (chiusura && !corse.length) continue;
      await Promise.race(chiusura ? corse : [...corse, Promise.race([dep.dormi(opz.pausaMs), suCalma])]);
    }
  }

  return { avvia, guida, opz, smetti, chiusura: () => chiusura };
}
