// Le prove del giro cancellate o cambiate dopo la critica (o dopo la pulizia) si rilanciano com'erano, sul
// codice nuovo: una ancora rossa ferma la consegna. Lo usano verify-local e dispatch, anche per la pulizia.
// Regola: patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { preparaLancioElectron } from './schermo-virtuale.mjs';
import { diffDopoLaVerifica, soloProveTolte, vociNameStatus } from './solo-tolte.mjs';

const PROVE_GIRO = 'tests/verifica/';
const SHA = /^[0-9a-f]{7,40}$/i;
// Stessa profondità della cartella d'origine, così gli import `../../fixtures/…` risolvono uguali.
// Gitignorata: il salvataggio automatico non deve mai committarla.
export const PREFISSO_RIPRISTINO = '_tolte-';

const PROVA = /\.spec\.m?js$/;
const CONFIG_PLAYWRIGHT = /^playwright\.config\.[cm]?[jt]s$/;
const nelGiro = (f) => f.startsWith(PROVE_GIRO) && f.split('/').length >= 4
  && !f.split('/').includes('..') && !f.split('/')[2].startsWith(PREFISSO_RIPRISTINO);
const percorsi = (l) => (Array.isArray(l) ? l : []).map((f) => String(f || '').replace(/\\/g, '/'));
const cartellaDi = (f) => String(f).split('/').slice(0, 3).join('/');

/** Dai file cancellati, le prove che Playwright raccoglierebbe dentro tests/verifica/<cartella>/. PURA. */
export function proveTolte(cancellati) {
  return percorsi(cancellati).filter((f) => nelGiro(f) && PROVA.test(f));
}

/** I file di supporto di una cartella del giro (aiuti, pagine, dati): non sono prove, ma le prove li usano. PURA. */
export function supportoDelGiro(files) {
  return percorsi(files).filter((f) => nelGiro(f) && !PROVA.test(f));
}

/** Gli aiuti comuni dei test fuori dalle cartelle del giro (fixture, helpers): anche quelli le prove del giro li usano. PURA. */
export function aiutiFuoriDalGiro(files) {
  return percorsi(files).filter((f) => f.startsWith('tests/') && !f.startsWith(PROVE_GIRO) && !f.startsWith('tests/unit/')
    && !PROVA.test(f) && !f.split('/').includes('..'));
}

const comeTesto = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CODICE = /\.[cm]?[jt]sx?$/i;
// Anche senza estensione: Playwright risolve `./aiuto` in `aiuto.mjs`.
const nomina = (testo, f) => {
  const nome = f.split('/').pop();
  if (new RegExp(`(?:^|[^\\w.-])${comeTesto(nome)}(?![\\w-])`).test(testo)) return true;
  return CODICE.test(nome) && new RegExp(`/${comeTesto(nome.replace(CODICE, ''))}['"\`]`).test(testo);
};

/**
 * Le prove che usano i file di supporto `cambiati`, anche passando per un altro aiuto: chi nomina il file, nella
 * stessa cartella del giro; per un aiuto comune fuori dal giro, ovunque fra `testi`. `testi`: `[{ path, testo }]`.
 * `via`: per ogni prova, i file da cui dipende. PURA.
 */
export function proveCheDipendono(testi, cambiati) {
  const elenco = (Array.isArray(testi) ? testi : []).filter((t) => t && t.path)
    .map((t) => ({ path: String(t.path).replace(/\\/g, '/'), testo: String(t.testo || '') }));
  const via = {};
  for (const c of [...supportoDelGiro(cambiati), ...aiutiFuoriDalGiro(cambiati)]) {
    const vicino = nelGiro(c) ? (t) => cartellaDi(t.path) === cartellaDi(c) : () => true;
    const raggiunti = new Set([c]);
    for (let nuovi = [c]; nuovi.length;) {
      nuovi = elenco.filter((t) => !raggiunti.has(t.path) && vicino(t)
        // Una prova non la importa nessuno (Playwright lo vieta): il suo nome scritto altrove non è una dipendenza.
        && nuovi.some((n) => !PROVA.test(n) && nomina(t.testo, n))).map((t) => t.path);
      for (const n of nuovi) raggiunti.add(n);
    }
    for (const p of proveTolte([...raggiunti])) (via[p] ||= []).push(c);
  }
  return { prove: Object.keys(via), via };
}

/** Dove una prova tolta torna a vivere per il rilancio. PURA. */
export function percorsoRipristino(prova, etichetta) {
  const parti = String(prova).split('/');
  parti[2] = `${PREFISSO_RIPRISTINO}${parti[2]}-${etichetta}`;
  return parti.join('/');
}

/**
 * Cosa fare dopo il rilancio. PURA. Le prove dei rilievi messi da parte se ne sono andate prima, nel
 * commit della pulizia, che è la base del confronto: qui ogni rossa riproduce un rilievo da chiudere.
 * `via`: le prove rilanciate perché è cambiato un file di supporto che usano, con quei file.
 */
const nomeAiuto = (x) => (x.startsWith(PROVE_GIRO) ? x.split('/').slice(3).join('/') : x);

export function esitoProveTolte({ rosse = [], dallaPulizia = [], shaPrima = '', conPulizia = true, messi = 0, via = {} } = {}) {
  if (!rosse.length && !dallaPulizia.length) return { ferma: false, testo: '' };
  const dove = via && typeof via === 'object' ? via : {};
  const riga = (f) => `  · ${f}${Array.isArray(dove[f]) && dove[f].length ? ` (usa ${dove[f].map(nomeAiuto).join(', ')})` : ''}`;
  // Un file che copriva anche un rilievo messo da parte: la pulizia gli ha tolto un caso, e quello che resta è da correggere.
  const casi = dallaPulizia.length ? [
    'Consegna respinta: a queste prove la pulizia ha tolto il caso di un rilievo messo da parte (o righe di un file di',
    'supporto che usano), e il caso che resta riproduce un rilievo da correggere. Sul codice nuovo è ancora rosso:',
    dallaPulizia.map(riga).join('\n'),
    'Correggi finché è verde, e consegna di nuovo.',
  ] : [];
  if (!rosse.length) return { ferma: true, testo: casi.join('\n') };
  const rimetti = `git checkout ${String(shaPrima).slice(0, 12) || '<commit della critica>'} -- <file>`;
  const supporto = rosse.some((f) => Array.isArray(dove[f]) && dove[f].length);
  // Senza pulizia registrata una rossa può essere di un rilievo messo da parte: quello aspetta l'owner, non si corregge qui.
  const perche = conPulizia ? [
    'Le prove dei rilievi messi da parte sono uscite prima, nel commit della pulizia: ognuna di queste riproduce',
    `un rilievo da chiudere, e la porta è ancora aperta. Rimetti la prova (${rimetti}),`,
    'correggi finché è verde, e consegna di nuovo.',
  ] : Number(messi) > 0 ? [
    'Nessuna pulizia è stata registrata dopo la critica. Se una di queste è la prova di un rilievo messo da parte,',
    `rimettila com'era (${rimetti}) e lasciala lì: quel rilievo non si corregge in questo giro, e la sua prova`,
    'esce quando il lavoro passa. Le altre riproducono un rilievo da chiudere: rimettile, correggi finché sono verdi,',
    'e consegna di nuovo.',
  ] : [
    `Ognuna di queste riproduce un rilievo da chiudere, e la porta è ancora aperta. Rimetti la prova (${rimetti}),`,
    'correggi finché è verde, e consegna di nuovo.',
  ];
  return {
    ferma: true,
    testo: [
      supporto
        ? 'Consegna respinta: hai cancellato o cambiato prove del giro, o file di supporto che usano, e com\'erano sul codice nuovo sono ancora rosse.'
        : 'Consegna respinta: hai cancellato o cambiato prove del giro che, com\'erano, sul codice nuovo sono ancora rosse.',
      rosse.map(riga).join('\n'),
      ...perche,
      ...(supporto ? ['Un file di supporto, della cartella del giro o un aiuto comune dei test, si rimette com\'era allo stesso modo: indebolirlo spegne le prove che lo usano.'] : []),
      'Una prova, o un suo caso, si toglie solo verde, insieme alla prova durevole che la sostituisce.',
      ...casi,
    ].join('\n'),
  };
}

/**
 * La base del confronto: il commit della pulizia se discende da quello della critica, altrimenti la
 * critica. Uno sha di pulizia rimasto da un giro vecchio non deve spostare la base di quello nuovo.
 */
export function baseDelConfronto(shaCritica, shaPulizia, root) {
  const critica = String(shaCritica || '');
  const pulizia = String(shaPulizia || '');
  if (!SHA.test(pulizia) || !SHA.test(critica)) return critica;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', critica, pulizia], { cwd: root, stdio: 'ignore' });
    return pulizia;
  } catch (_) { return critica; }
}

// Il sigillo che il rilascio del verificatore lascia sulla punta del ramo.
export const SIGILLO_VERIFICATORE = 'release:verifier';

/**
 * Dopo un «pass» la pulizia non si registra: la sigilla il rilascio di chi ha verificato. È il SUO punto fermo più
 * recente che discende dalla critica e da lei ha solo tolto prove del giro, o ''. Il sigillo di un altro ruolo
 * (chi riallinea che rilascia dopo aver tolto una prova) non lo diventa mai (#880, #679).
 */
export function puliziaDelPass(shaCritica, punti, root) {
  const critica = String(shaCritica || '');
  if (!SHA.test(critica)) return '';
  const shas = (Array.isArray(punti) ? punti : []).filter((p) => p && p.by === SIGILLO_VERIFICATORE)
    .map((p) => String(p.sha || '')).filter((s) => SHA.test(s) && s !== critica);
  for (const sha of [...new Set(shas.reverse())]) {
    try { execFileSync('git', ['merge-base', '--is-ancestor', critica, sha], { cwd: root, stdio: 'ignore' }); } catch (_) { continue; }
    const tol = soloProveTolte(diffDopoLaVerifica(critica, sha, root));
    if (tol.ok && proveTolte(tol.files).length) return sha;
  }
  return '';
}

/**
 * Il commit della pulizia, fra la critica e HEAD: solo prove o casi TOLTI, tutti da una cartella del
 * giro (`cartella`, o una sola se non la si sa). Stessa regola di «dopo un verdetto si può solo togliere».
 * `{ ok, motivo, sha, files, cancellate, cambiate, vecchie }`: `motivo` è già la frase per chi l'ha lanciata;
 * `files` sono solo le prove (un file di supporto non lo è); `vecchie` (null senza `avvio`) sono le prove
 * tolte che la verifica non ha né scritto né rinominato. Cosa resta rosso lo dice controllaCasiDellaPulizia.
 */
export function controllaPulizia({ shaCritica, root, cartella = '', avvio = '' } = {}) {
  const critica = String(shaCritica || '');
  if (!SHA.test(critica)) return { ok: false, motivo: 'non so su che commit è stata registrata la critica: senza, non so cosa hai tolto.' };
  let head = '';
  try { head = gitOut(['rev-parse', 'HEAD'], root).trim(); } catch (_) { /* resta vuoto */ }
  if (!head) return { ok: false, motivo: 'git non mi dice su che commit sei.' };
  if (head === critica || head.startsWith(critica) || critica.startsWith(head)) {
    return { ok: false, motivo: 'nessun commit dopo la critica. Togli le prove dei rilievi messi da parte, `git add -A && git commit`, poi rilancia.' };
  }
  const voci = diffDopoLaVerifica(critica, head, root);
  const tol = soloProveTolte(voci);
  if (!tol.ok) return { ok: false, motivo: `il commit della pulizia deve solo togliere prove del giro, e qui ${tol.motivo}.` };
  const prove = proveTolte(tol.files);
  if (!prove.length) {
    return { ok: false, motivo: `dopo la critica non è stata tolta nessuna prova del giro${tol.files.length ? ' (un file di supporto non è una prova)' : ''}.` };
  }
  const cartelle = [...new Set(tol.files.map((f) => f.replace(/\\/g, '/').split('/').slice(0, 3).join('/')))];
  const attesa = String(cartella || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const fuori = attesa ? cartelle.filter((c) => c !== attesa) : (cartelle.length > 1 ? cartelle : []);
  if (fuori.length) {
    return { ok: false, motivo: `le prove tolte stanno in più cartelle, o fuori da quella del giro${attesa ? ` (${attesa})` : ''}: ${cartelle.join(', ')}.` };
  }
  const cancellata = (v) => String(v.stato || '').toUpperCase().startsWith('D');
  return {
    ok: true, motivo: '', sha: head, files: prove,
    cancellate: voci.filter(cancellata).map((v) => v.path),
    cambiate: voci.filter((v) => !cancellata(v)).map((v) => v.path),
    vecchie: proveVecchie(prove, avvio, critica, root),
  };
}

// Il numero nel nome di una prova che questa verifica non ha scritto né rinominato è di una critica passata, e può
// coincidere con quello di un rilievo messo da parte adesso. null se non si sa da che commit è partita.
function proveVecchie(prove, avvio, critica, root) {
  if (!SHA.test(String(avvio || ''))) return null;
  try {
    const out = gitOut(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=AM', String(avvio), critica, '--', PROVE_GIRO], root);
    const scritte = new Set(out.split('\0').filter(Boolean));
    return prove.filter((f) => !scritte.has(f));
  } catch (_) { return null; }
}

// giro<k>-r<n>[-r<m>…]-<cosa>.spec.mjs: n è il posto del rilievo nella critica che lo riporta, il primo è 1.
const NUMERI_NEL_NOME = /^giro\d+((?:-r[1-9]\d*)+)(?=[-.])/;
const nomeDi = (percorso) => String(percorso || '').replace(/\\/g, '/').split('/').pop();

/** I numeri dei rilievi che una prova del giro riproduce, letti dal nome; [] se non ne porta. PURA. */
export function numeriDelNome(percorso) {
  const m = NUMERI_NEL_NOME.exec(nomeDi(percorso));
  return m ? [...new Set(m[1].split('-r').filter(Boolean).map(Number))] : [];
}

/** Un nome che sembra numerato ma che numeriDelNome non legge per intero (r0, R3, il numero in coda…). PURA. */
export function nomeNumeratoStorto(percorso) {
  const nome = nomeDi(percorso);
  const m = NUMERI_NEL_NOME.exec(nome);
  return /(?:^|[-_.])r\d+(?=[-_.]|$)/i.test(m ? nome.slice(m[0].length) : nome);
}

/**
 * Ogni rilievo di `parte` col suo posto nella critica (`n`, da 1), ritrovato per livello, sede e testo fra
 * `tutti` (parseFindings della critica). `n` null se non si ritrova. PURA.
 */
export function numeraRilievi(tutti, parte) {
  const chiave = (f) => `${Number(f && f.level)}|${String((f && f.sede) || 'i').toLowerCase()}|${String((f && f.text) || '').trim()}`;
  const liberi = (Array.isArray(tutti) ? tutti : []).map((f, i) => ({ k: chiave(f), n: i + 1 }));
  return (Array.isArray(parte) ? parte : []).filter((f) => f && typeof f === 'object').map((f) => {
    const i = liberi.findIndex((l) => l.k === chiave(f));
    return { ...f, n: i < 0 ? null : liberi.splice(i, 1)[0].n };
  });
}

/** «- r3 [2i] testo»: la riga del rilievo col numero che le sue prove portano nel nome. PURA. */
export function rigaNumerata(f, formatta) {
  const riga = formatta(f);
  return Number.isInteger(f && f.n) ? riga.replace(/^- /, `- r${f.n} `) : riga;
}

/**
 * '' se la pulizia regge, altrimenti il rifiuto. Esce intera solo la prova che nel nome porta soli numeri di
 * rilievi messi da parte; a una che copre anche un rilievo da correggere si toglie solo il caso, e la consegna
 * rilancia quello che resta. Una senza numero non esce. `numeri`: i posti dei messi da parte nella critica. PURA.
 */
export function testoPuliziaFuoriNumero(controllo, numeri) {
  const c = controllo || {};
  const messi = new Set((Array.isArray(numeri) ? numeri : []).filter((n) => Number.isInteger(n)));
  const vecchie = new Set(Array.isArray(c.vecchie) ? c.vecchie : []);
  const r = (l) => l.map((n) => `r${n}`).join(', ');
  const fuori = [];
  const guarda = (f, intera) => {
    const n = numeriDelNome(f);
    const altri = n.filter((x) => !messi.has(x));
    if (!n.length) return `il nome non porta il numero di un rilievo (giro<k>-r<n>-<cosa>.spec.mjs)`;
    if (altri.length === n.length) return `${r(altri)} non è fra i rilievi messi da parte`;
    if (intera && altri.length) return `copre anche ${r(altri)}, che non è messo da parte: il file resta, gli si toglie solo il caso dei messi da parte`;
    if (vecchie.has(f)) return 'c\'era già prima di questa verifica, e il numero nel nome è quello di una critica passata';
    return '';
  };
  for (const [lista, intera] of [[c.cancellate, true], [c.cambiate, false]]) {
    for (const f of proveTolte(lista)) {
      const perche = guarda(f, intera);
      if (perche) fuori.push(`  · ${f}: ${perche}`);
    }
  }
  if (!fuori.length) return '';
  const elenco = messi.size ? r([...messi].sort((a, b) => a - b)) : 'nessuno porta un numero';
  return [
    `pulizia non registrata: qui esce solo la prova di un rilievo messo da parte, riconosciuta dal numero nel nome (messi da parte: ${elenco}).`,
    ...fuori,
    'Rimettile com\'erano (git checkout <commit della critica> -- <file>), `git add -A && git commit`, e rilancia la',
    'pulizia. Le prove dei rilievi da correggere restano finché non sono verdi.',
  ].join('\n');
}

function gitOut(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
}

// I testi dei file di codice di quelle cartelle a `rev`: da lì si legge chi usa un file di supporto.
function testiAl(rev, cartelle, root) {
  const testi = [];
  for (const c of new Set(cartelle)) {
    for (const f of gitOut(['ls-tree', '-r', '-z', '--name-only', rev, '--', `${c}/`], root).split('\0').filter(Boolean)) {
      if (/\.(?:[cm]?[jt]sx?|json|html?)$/i.test(f)) testi.push({ path: f, testo: gitOut(['show', `${rev}:${f}`], root) });
    }
  }
  return testi;
}

// Un file di supporto aggiunto, cambiato o tolto in una cartella del giro rilancia tutte le sue prove a `rev`: quale file
// carica una prova lo decide Playwright (senza estensione, una cartella col suo indice, un file nuovo che fa ombra), non il nome scritto.
// Un file fuori dal giro (la configurazione) vale per tutte le `cartelle`.
function proveDelleCartelle(rev, supporto, root, cartelle = supporto.map(cartellaDi)) {
  const via = {};
  for (const c of new Set(cartelle)) {
    const lista = gitOut(['ls-tree', '-r', '-z', '--name-only', rev, '--', `${c}/`], root).split('\0').filter(Boolean);
    for (const p of proveTolte(lista)) via[p] = supporto.filter((s) => !nelGiro(s) || cartellaDi(s) === c);
  }
  return { prove: Object.keys(via), via };
}

// Le prove del giro da rilanciare fra `shaPrima` e HEAD, `{ prove, via }` (null se git non risponde): togliere il caso
// rosso, o indebolire il file di supporto che lo controlla, è la stessa porta aperta che cancellare la prova.
// `fuori`: gli aiuti comuni cambiati che una prova del giro usa, e la configurazione; il rilancio li rimette com'erano in una copia a parte.
export function proveTolteDal(shaPrima, root, principale = riferimentoPrincipale(root)) {
  try {
    const cambiati = (dove, filtro) => gitOut(['diff', '--name-only', '-z', '--no-renames', `--diff-filter=${filtro}`, shaPrima, 'HEAD', '--', dove], root).split('\0').filter(Boolean);
    const nomi = cambiati(PROVE_GIRO, 'DM');
    const prove = toccateDalRamo(proveTolte(nomi), shaPrima, root, principale);
    const nellaCartella = proveDelleCartelle(shaPrima, toccateDalRamo(supportoDelGiro([...nomi, ...cambiati(PROVE_GIRO, 'A')]), shaPrima, root, principale), root);
    const aiuti = toccateDalRamo(aiutiFuoriDalGiro(cambiati('tests/', 'ADM')), shaPrima, root, principale);
    // La configurazione di Playwright la usano tutte: un filtro aggiunto lì spegne un caso rosso come un aiuto svuotato.
    const config = toccateDalRamo(cambiati('playwright.config.*', 'ADM').filter((f) => CONFIG_PLAYWRIGHT.test(f)), shaPrima, root, principale);
    const cartelle = aiuti.length || config.length ? cartelleDelRamo(nomi, root, principale) : [];
    const dipFuori = aiuti.length
      ? proveCheDipendono([...testiAl(shaPrima, cartelle, root), ...testiAiuti(shaPrima, root)], aiuti)
      : { prove: [], via: {} };
    const conConfig = config.length ? proveDelleCartelle(shaPrima, config, root, cartelle) : { via: {} };
    const tutte = { ...nellaCartella.via };
    for (const [p, l] of [...Object.entries(dipFuori.via), ...Object.entries(conConfig.via)]) tutte[p] = [...new Set([...(tutte[p] || []), ...l])];
    const via = Object.fromEntries(Object.entries(tutte).filter(([p]) => !prove.includes(p)));
    const fuori = [...aiuti.filter((a) => Object.values(dipFuori.via).some((l) => l.includes(a))), ...config];
    return { prove: [...prove, ...Object.keys(via)], via, fuori };
  } catch (_) { return null; }
}

// Le cartelle del giro di questo ramo: quelle cambiate dopo la critica e quelle che il ramo ha toccato rispetto a main.
function cartelleDelRamo(nomi, root, principale) {
  const cartelle = new Set(percorsi(nomi).filter(nelGiro).map(cartellaDi));
  // Senza main non so quali sono del ramo: tutte, che costa un rilancio più lungo e non lascia fuori niente.
  const files = principale
    ? gitOut(['diff', '--name-only', '-z', '--no-renames', gitOut(['merge-base', 'HEAD', principale], root).trim(), 'HEAD', '--', PROVE_GIRO], root)
    : gitOut(['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', PROVE_GIRO], root);
  for (const f of files.split('\0')) if (nelGiro(f)) cartelle.add(cartellaDi(f));
  return [...cartelle];
}

function testiAiuti(rev, root) {
  return aiutiFuoriDalGiro(gitOut(['ls-tree', '-r', '-z', '--name-only', rev, '--', 'tests/'], root).split('\0').filter(Boolean))
    .filter((f) => /\.(?:[cm]?[jt]sx?|json|html?)$/i.test(f))
    .map((f) => ({ path: f, testo: gitOut(['show', `${rev}:${f}`], root) }));
}

export function riferimentoPrincipale(root) {
  for (const r of ['origin/main', 'main']) {
    try { gitOut(['rev-parse', '--verify', '-q', `${r}^{commit}`], root); return r; } catch (_) { continue; }
  }
  return '';
}

function oggetto(rev, f, root) {
  try { return gitOut(['rev-parse', '-q', '--verify', `${rev}:${f}`], root).trim(); } catch (_) { return ''; }
}

// Dopo un riallineamento il commit della critica sta sulla vecchia base: il diff da lì porta dentro le prove di altri
// lavori che main ha cambiato nel frattempo. Resta solo ciò che il ramo ha toccato, prima o dopo la critica.
export function toccateDalRamo(prove, shaPrima, root, principale = riferimentoPrincipale(root)) {
  if (!principale || !prove.length) return prove;
  let vecchia = '';
  let nuova = '';
  try {
    vecchia = gitOut(['merge-base', shaPrima, principale], root).trim();
    nuova = gitOut(['merge-base', 'HEAD', principale], root).trim();
  } catch (_) { return prove; }
  if (!vecchia || !nuova || vecchia === nuova) return prove;
  return prove.filter((f) => oggetto(shaPrima, f, root) !== oggetto(vecchia, f, root)
    || oggetto('HEAD', f, root) !== oggetto(nuova, f, root));
}

/**
 * Rilancia le prove tolte, ciascuna nella sua cartella com'era a `shaPrima` e col codice di adesso.
 * `{ rosse, motivo }`: `motivo` non vuoto = non si è potuto rilanciare, e non è un via libera.
 */
export function rilanciaProveTolte(prove, shaPrima, root, opzioni = {}) {
  const r = corriCome(prove, shaPrima, root, opzioni);
  return { rosse: prove.filter((p) => r.esiti.get(p)?.rossa), motivo: r.motivo };
}

// Ogni prova nella sua cartella com'era a `sha`, col codice di adesso: `{ esiti: Map<prova, { rossa, casi }>, motivo }`.
// Con `perCaso` anche l'esito di ogni caso (casiDalReport), null se Playwright non l'ha scritto.
function corriCome(prove, sha, root, { lancia = spawnSync, log = console.log, prepara = preparaLancioElectron, titolo = '', perCaso = false, etichetta = `${process.pid}`, fuori = [] } = {}) {
  const esiti = new Map();
  const schermo = prepara('npx', []);
  if (!schermo.ok) return { esiti, motivo: schermo.motivo };
  const cartelle = [...new Set(prove.map(cartellaDi))];
  let rapporti = '';
  let copia = '';
  let base = root;
  try {
    if (perCaso) rapporti = mkdtempSync(join(tmpdir(), 'filo-casi-'));
    if (fuori.length) {
      copia = copiaConAiutiDi(sha, fuori, root);
      base = join(copia, 'albero');
      log(`Gli aiuti comuni dei test cambiati dopo la critica si rimettono com'erano, in una copia del ramo a parte: ${fuori.join(', ')}.`);
    }
    for (const c of cartelle) {
      const files = gitOut(['ls-tree', '-r', '-z', '--name-only', sha, '--', `${c}/`], root).split('\0').filter(Boolean);
      for (const f of files) {
        const dest = resolve(base, percorsoRipristino(f, etichetta));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, execFileSync('git', ['show', `${sha}:${f}`], { cwd: root, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }));
      }
    }
    const una = prove.length === 1;
    log(titolo || `Rilancio com'${una ? 'era' : 'erano'} ${una ? 'la prova' : `le ${prove.length} prove`} del giro ${una ? 'toccata' : 'toccate'} dopo la critica (cancellate, cambiate o che usano un file di supporto cambiato), sul codice nuovo:`);
    prove.forEach((p, i) => {
      const l = prepara('npx', ['playwright', 'test', percorsoRipristino(p, etichetta), '--retries=1', ...(perCaso ? ['--reporter=list,json'] : [])]);
      const rapporto = perCaso ? join(rapporti, `${i}.json`) : '';
      const env = perCaso ? { ...(l.env || process.env), PLAYWRIGHT_JSON_OUTPUT_FILE: rapporto } : l.env;
      const r = lancia(l.cmd, l.args, { cwd: base, stdio: 'inherit', shell: process.platform === 'win32', ...(env ? { env } : {}) });
      esiti.set(p, { rossa: !r || r.status !== 0, casi: perCaso ? casiDalReport(leggiJson(rapporto)) : null });
    });
    return { esiti, motivo: '' };
  } catch (e) {
    return { esiti, motivo: `non sono riuscito a rimettere le prove com'erano a ${String(sha).slice(0, 8)}: ${e.message}` };
  } finally {
    // I tentativi: su Windows i processi del rilancio appena usciti tengono ancora le cartelle per un poco (#1063).
    for (const c of cartelle) rmSync(resolve(base, percorsoRipristino(`${c}/x`, etichetta), '..'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (rapporti) try { rmSync(rapporti, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* resta nella temporanea */ }
    if (copia) togliCopia(copia, root);
  }
}

// Una copia del ramo a HEAD con gli aiuti `fuori` com'erano a `sha`: rimetterli al loro posto lascerebbe, se il
// rilancio muore a metà, un aiuto vecchio che il salvataggio automatico committerebbe sopra la correzione.
function copiaConAiutiDi(sha, fuori, root) {
  const dir = mkdtempSync(join(tmpdir(), 'filo-rilancio-'));
  const albero = join(dir, 'albero');
  mkdirSync(join(dir, 'ganci'));
  gitOut(['-c', `core.hooksPath=${join(dir, 'ganci')}`, 'worktree', 'add', '-q', '--detach', albero, 'HEAD'], root);
  if (existsSync(resolve(root, 'node_modules'))) symlinkSync(resolve(root, 'node_modules'), join(albero, 'node_modules'), 'junction');
  // I file generati che git ignora (le chiavi predefinite) servono all'app quanto i sorgenti.
  for (const f of gitOut(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', 'src'], root).split('\0').filter(Boolean)) {
    mkdirSync(dirname(join(albero, f)), { recursive: true });
    copyFileSync(resolve(root, f), join(albero, f));
  }
  for (const f of fuori) {
    // Un aiuto aggiunto dopo la critica nella copia non c'è, com'era allora.
    if (!oggetto(sha, f, root)) { rmSync(join(albero, f), { force: true }); continue; }
    mkdirSync(dirname(join(albero, f)), { recursive: true });
    writeFileSync(join(albero, f), execFileSync('git', ['show', `${sha}:${f}`], { cwd: root, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }));
  }
  return dir;
}

function togliCopia(dir, root) {
  try { gitOut(['worktree', 'remove', '--force', join(dir, 'albero')], root); } catch (_) { /* la cartella si toglie sotto */ }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* resta nella temporanea */ }
}

function leggiJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** Dal rapporto JSON di Playwright, `{ titolo: ok }` per ogni caso (describe compresi, il file no); null senza. PURA. */
export function casiDalReport(rapporto) {
  if (!rapporto || typeof rapporto !== 'object' || !Array.isArray(rapporto.suites)) return null;
  const casi = {};
  const visita = (suite, sopra) => {
    for (const s of Array.isArray(suite?.specs) ? suite.specs : []) {
      const t = [...sopra, String(s?.title ?? '')].join(' › ');
      casi[t] = casi[t] !== false && s?.ok !== false;
    }
    for (const figlia of Array.isArray(suite?.suites) ? suite.suites : []) visita(figlia, [...sopra, String(figlia?.title ?? '')]);
  };
  for (const file of rapporto.suites) visita(file, []);
  return casi;
}

const ultimo = (t) => String(t).split(' › ').pop();

/**
 * Sullo stesso codice, cosa ha spento la pulizia: `spenti` i casi rossi prima e verdi dopo, `vuota` se prima c'era un
 * rosso e dopo non ce n'è più nessuno (anche: il file non carica). Senza l'esito per caso decide quello del file. PURA.
 */
export function casiSpenti(prima, dopo) {
  const p = prima || {};
  const d = dopo || {};
  if (!p.casi || !d.casi) return { spenti: [], vuota: !!p.rossa && !d.rossa };
  const rossi = Object.keys(p.casi).filter((t) => p.casi[t] === false);
  if (!rossi.length) return { spenti: [], vuota: false };
  // Togliere le righe di un describe cambia il titolo intero, non quello del caso: lo si ritrova da quello.
  const dopoDi = (t) => (t in d.casi ? [d.casi[t]] : Object.keys(d.casi).filter((k) => ultimo(k) === ultimo(t)).map((k) => d.casi[k]));
  return { spenti: rossi.filter((t) => dopoDi(t).includes(true)), vuota: !Object.values(d.casi).includes(false) };
}

const NUMERO_NEL_TITOLO = /(?<![\p{L}\p{N}_])r([1-9]\d*)(?![\p{L}\p{N}_])/giu;

/** I numeri dei rilievi che il titolo di un caso cita (`r2 prima porta` → [2]). PURA. */
export function numeriDelTitolo(titolo) {
  return [...new Set([...String(titolo || '').matchAll(NUMERO_NEL_TITOLO)].map((m) => Number(m[1])))];
}

/**
 * I casi rossi alla critica che la pulizia ha tolto per intero senza che siano di un rilievo messo da parte: il titolo
 * deve citarne solo di messi da parte, o, se non ne cita, il nome del file. `messi`: i loro numeri nella critica. PURA.
 */
export function casiToltiNonMessi(prova, prima, dopo, messi) {
  const p = prima && prima.casi;
  const d = dopo && dopo.casi;
  if (!p || !d || !Array.isArray(messi)) return [];
  const m = new Set(messi.filter((n) => Number.isInteger(n)));
  const daParte = (n) => n.length > 0 && n.every((x) => m.has(x));
  const restano = new Set(Object.keys(d).map(ultimo));
  return Object.keys(p).filter((t) => p[t] === false && !(t in d) && !restano.has(ultimo(t))).filter((t) => {
    const n = numeriDelTitolo(ultimo(t));
    return !daParte(n.length ? n : numeriDelNome(prova));
  });
}

/** Il rifiuto della pulizia che ha spento o tolto un caso rosso da correggere, o '' se non l'ha fatto. PURA. */
export function testoCasiSpenti(fuori, via = {}, shaCritica = '') {
  const elenco = (Array.isArray(fuori) ? fuori : []).filter((x) => x && (x.vuota || (x.spenti && x.spenti.length) || (x.tolti && x.tolti.length)));
  if (!elenco.length) return '';
  const dove = via && typeof via === 'object' ? via : {};
  const casi = (l) => l.map((t) => `«${t}»`).join(', ');
  const righe = elenco.map(({ f, spenti = [], tolti = [], vuota }) => {
    const usa = Array.isArray(dove[f]) && dove[f].length ? ` (usa ${dove[f].map(nomeAiuto).join(', ')})` : '';
    const cosa = [
      spenti.length ? `${casi(spenti)} ${spenti.length === 1 ? 'era rosso ed è verde' : 'erano rossi e sono verdi'}` : '',
      tolti.length ? `${casi(tolti)} ${tolti.length === 1 ? 'era rosso ed è stato tolto, ma non è' : 'erano rossi e sono stati tolti, ma non sono'} di un rilievo messo da parte` : '',
      !spenti.length && !tolti.length && vuota ? 'non ha più un caso rosso' : '',
    ].filter(Boolean).join('; ');
    return `  · ${f}${usa}: ${cosa}`;
  });
  return [
    'pulizia non registrata: il codice è ancora quello della critica, e la pulizia ha spento o tolto casi rossi da correggere.',
    ...righe,
    'Esce solo il caso del rilievo messo da parte: quello di un rilievo da correggere resta rosso finché il codice non lo',
    `fa diventare verde. Rimetti com'erano (git checkout ${String(shaCritica).slice(0, 12) || '<commit della critica>'} -- <file>), togli solo le righe`,
    'del rilievo messo da parte, `git add -A && git commit`, e rilancia la pulizia.',
    ...(elenco.some((x) => x.tolti && x.tolti.length)
      ? ['In una prova che copre più rilievi un caso tolto è di un rilievo messo da parte solo se il suo titolo ne porta il numero (r<n>).']
      : []),
  ].join('\n');
}

// Le prove toccate dalla pulizia, `{ prove, via }`: quelle a cui ha tolto un caso, e quelle che usano un file di
// supporto che ha cambiato (lette alla critica, dove c'era ancora). null se git non risponde.
function toccateDallaPulizia(shaCritica, shaPulizia, root) {
  const critica = String(shaCritica || '');
  if (!SHA.test(critica) || !SHA.test(String(shaPulizia || '')) || critica === String(shaPulizia)) return null;
  try {
    const voci = vociNameStatus(gitOut(['diff', '--name-status', '-z', '--no-renames', critica, String(shaPulizia), '--', PROVE_GIRO], root));
    const uscite = new Set(voci.filter((v) => v.stato === 'D').map((v) => v.path));
    const dirette = proveTolte(voci.filter((v) => v.stato === 'M').map((v) => v.path));
    const dip = proveDelleCartelle(critica, supportoDelGiro(voci.map((v) => v.path)), root);
    const via = Object.fromEntries(Object.entries(dip.via).filter(([p]) => !uscite.has(p) && !dirette.includes(p)));
    return { prove: [...dirette, ...Object.keys(via)], via, dirette };
  } catch (_) { return null; }
}

/**
 * Prima di registrare la pulizia: ogni caso rosso di una prova che ha toccato resta rosso, perché il codice è ancora
 * quello della critica. Si rilancia com'è dopo; com'era alla critica solo dove dopo c'è un verde da spiegare.
 */
export function controllaCasiDellaPulizia({ shaCritica, sha, root, log = console.log, lancia, prepara, messi } = {}) {
  const toccate = toccateDallaPulizia(shaCritica, sha, root);
  if (!toccate) return { ferma: true, testo: 'pulizia non registrata: git non mi dice quali prove del giro ha toccato.' };
  const n = toccate.prove.length;
  if (!n) return { ferma: false, testo: '' };
  const opz = { log, perCaso: true, ...(lancia ? { lancia } : {}), ...(prepara ? { prepara } : {}) };
  const dopo = corriCome(toccate.prove, sha, root, {
    ...opz, etichetta: `${process.pid}-dopo`,
    titolo: `Rilancio ${n === 1 ? 'la prova toccata' : `le ${n} prove toccate`} dalla pulizia, sul codice della critica: ogni caso rosso deve restare rosso.`,
  });
  if (dopo.motivo) return { ferma: true, testo: `pulizia non registrata: ${dopo.motivo}` };
  const conUnVerde = toccate.prove.filter((p) => {
    const e = dopo.esiti.get(p) || {};
    return e.casi ? Object.values(e.casi).some(Boolean) || !Object.values(e.casi).includes(false) : !e.rossa;
  });
  // Con i numeri dei messi da parte si guarda anche quali casi rossi la pulizia ha tolto per intero.
  const confronta = [...new Set([...conUnVerde, ...(Array.isArray(messi) ? toccate.dirette : [])])];
  if (!confronta.length) return { ferma: false, testo: '' };
  const prima = corriCome(confronta, shaCritica, root, {
    ...opz, etichetta: `${process.pid}-prima`, titolo: 'E com\'erano alla critica, per vedere quali casi erano rossi:',
  });
  if (prima.motivo) return { ferma: true, testo: `pulizia non registrata: ${prima.motivo}` };
  const testo = testoCasiSpenti(confronta.map((f) => ({
    f, ...casiSpenti(prima.esiti.get(f), dopo.esiti.get(f)), tolti: casiToltiNonMessi(f, prima.esiti.get(f), dopo.esiti.get(f), messi),
  })), toccate.via, shaCritica);
  return { ferma: !!testo, testo };
}

/**
 * Tutto il controllo, per chi consegna: `{ ferma, testo }`. `shaPrima` è la base (baseDelConfronto).
 * Senza non si sa cosa è stato tolto: lo si dice e non si ferma (la verifica dopo rilancia la cartella).
 * Con `shaCritica` si rilanciano anche le prove che la pulizia ha toccato, com'erano dopo di lei.
 */
export function controllaProveTolte({ shaPrima, root, log = console.log, lancia, prepara, conPulizia = true, messi = 0, shaCritica = '' } = {}) {
  if (!SHA.test(String(shaPrima || ''))) {
    return { ferma: false, testo: 'Non so da che commit è partita la correzione: le prove del giro cancellate o cambiate non le rilancio.' };
  }
  const dal = proveTolteDal(shaPrima, root);
  if (dal === null) return { ferma: false, testo: 'Git non mi dice quali prove del giro sono state cancellate o cambiate: non le rilancio.' };
  const { prove } = dal;
  // Chi corregge può non toccarle mai: senza rilanciarle, un caso da correggere uscito al posto di uno messo da parte non si vedrebbe.
  const pulite = conPulizia ? toccateDallaPulizia(shaCritica, shaPrima, root) : null;
  const accorciate = pulite ? pulite.prove.filter((f) => !prove.includes(f)) : [];
  if (!prove.length && !accorciate.length) return { ferma: false, testo: '' };
  const r = rilanciaProveTolte([...prove, ...accorciate], shaPrima, root, { log, fuori: dal.fuori || [], ...(lancia ? { lancia } : {}), ...(prepara ? { prepara } : {}) });
  if (r.motivo) return { ferma: true, testo: `Consegna respinta: ${r.motivo}` };
  return esitoProveTolte({
    rosse: r.rosse.filter((f) => prove.includes(f)), dallaPulizia: r.rosse.filter((f) => accorciate.includes(f)),
    shaPrima, conPulizia, messi, via: { ...(pulite ? pulite.via : {}), ...dal.via },
  });
}
