// Le prove del giro cancellate o cambiate dopo la critica (o dopo la pulizia) si rilanciano com'erano, sul
// codice nuovo: una ancora rossa ferma la consegna. Lo usano verify-local e dispatch, anche per la pulizia.
// Regola: patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { preparaLancioElectron } from './schermo-virtuale.mjs';
import { diffDopoLaVerifica, soloProveTolte } from './solo-tolte.mjs';

const PROVE_GIRO = 'tests/verifica/';
const SHA = /^[0-9a-f]{7,40}$/i;
// Stessa profondità della cartella d'origine, così gli import `../../fixtures/…` risolvono uguali.
// Gitignorata: il salvataggio automatico non deve mai committarla.
export const PREFISSO_RIPRISTINO = '_tolte-';

/** Dai file cancellati, le prove che Playwright raccoglierebbe dentro tests/verifica/<cartella>/. PURA. */
export function proveTolte(cancellati) {
  return (Array.isArray(cancellati) ? cancellati : [])
    .map((f) => String(f || '').replace(/\\/g, '/'))
    .filter((f) => f.startsWith(PROVE_GIRO) && f.split('/').length >= 4 && /\.spec\.m?js$/.test(f)
      && !f.split('/').includes('..') && !f.split('/')[2].startsWith(PREFISSO_RIPRISTINO));
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
 */
export function esitoProveTolte({ rosse = [], dallaPulizia = [], shaPrima = '', conPulizia = true, messi = 0 } = {}) {
  if (!rosse.length && !dallaPulizia.length) return { ferma: false, testo: '' };
  // Un file che copriva anche un rilievo messo da parte: la pulizia gli ha tolto un caso, e quello che resta è da correggere.
  const casi = dallaPulizia.length ? [
    'Consegna respinta: a queste prove la pulizia ha tolto il caso di un rilievo messo da parte, e il caso che resta',
    'riproduce un rilievo da correggere. Sul codice nuovo è ancora rosso:',
    dallaPulizia.map((f) => `  · ${f}`).join('\n'),
    'Correggi finché è verde, e consegna di nuovo.',
  ] : [];
  if (!rosse.length) return { ferma: true, testo: casi.join('\n') };
  const rimetti = `git checkout ${String(shaPrima).slice(0, 12) || '<commit della critica>'} -- <file>`;
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
      'Consegna respinta: hai cancellato o cambiato prove del giro che, com\'erano, sul codice nuovo sono ancora rosse.',
      rosse.map((f) => `  · ${f}`).join('\n'),
      ...perche,
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

/**
 * Il commit della pulizia, fra la critica e HEAD: solo prove o casi TOLTI, tutti da una cartella del
 * giro (`cartella`, o una sola se non la si sa). Stessa regola di «dopo un verdetto si può solo togliere».
 * `{ ok, motivo, sha, files, cancellate, cambiate, vecchie }`: `motivo` è già la frase per chi l'ha lanciata;
 * `vecchie` (null senza `avvio`) sono le prove tolte che la verifica non ha né scritto né rinominato.
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
  if (!tol.files.length) return { ok: false, motivo: 'dopo la critica non è stata tolta nessuna prova del giro.' };
  const cartelle = [...new Set(tol.files.map((f) => f.replace(/\\/g, '/').split('/').slice(0, 3).join('/')))];
  const attesa = String(cartella || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const fuori = attesa ? cartelle.filter((c) => c !== attesa) : (cartelle.length > 1 ? cartelle : []);
  if (fuori.length) {
    return { ok: false, motivo: `le prove tolte stanno in più cartelle, o fuori da quella del giro${attesa ? ` (${attesa})` : ''}: ${cartelle.join(', ')}.` };
  }
  const cancellata = (v) => String(v.stato || '').toUpperCase().startsWith('D');
  return {
    ok: true, motivo: '', sha: head, files: tol.files,
    cancellate: voci.filter(cancellata).map((v) => v.path),
    cambiate: voci.filter((v) => !cancellata(v)).map((v) => v.path),
    vecchie: proveVecchie(proveTolte(tol.files), avvio, critica, root),
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

// Le prove del giro cancellate o cambiate fra `shaPrima` e HEAD (null se git non risponde): togliere il
// caso rosso e tenere il file è la stessa porta aperta che cancellarlo.
export function proveTolteDal(shaPrima, root, principale = riferimentoPrincipale(root)) {
  try {
    const out = gitOut(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=DM', shaPrima, 'HEAD', '--', PROVE_GIRO], root);
    return toccateDalRamo(proveTolte(out.split('\0').filter(Boolean)), shaPrima, root, principale);
  } catch (_) { return null; }
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
export function rilanciaProveTolte(prove, shaPrima, root, { lancia = spawnSync, log = console.log, prepara = preparaLancioElectron } = {}) {
  const schermo = prepara('npx', []);
  if (!schermo.ok) return { rosse: [], motivo: schermo.motivo };
  const etichetta = `${process.pid}`;
  const cartelle = [...new Set(prove.map((p) => p.split('/').slice(0, 3).join('/')))];
  const rosse = [];
  try {
    for (const c of cartelle) {
      const files = gitOut(['ls-tree', '-r', '-z', '--name-only', shaPrima, '--', `${c}/`], root).split('\0').filter(Boolean);
      for (const f of files) {
        const dest = resolve(root, percorsoRipristino(f, etichetta));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, execFileSync('git', ['show', `${shaPrima}:${f}`], { cwd: root, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }));
      }
    }
    log(`Rilancio com'${prove.length === 1 ? 'era' : 'erano'} ${prove.length} ${prove.length === 1 ? 'prova' : 'prove'} del giro cancellate o cambiate in questa correzione, sul codice nuovo:`);
    for (const p of prove) {
      const l = prepara('npx', ['playwright', 'test', percorsoRipristino(p, etichetta), '--retries=1']);
      const r = lancia(l.cmd, l.args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...(l.env ? { env: l.env } : {}) });
      if (!r || r.status !== 0) rosse.push(p);
    }
    return { rosse, motivo: '' };
  } catch (e) {
    return { rosse, motivo: `non sono riuscito a rimettere le prove tolte com'erano a ${String(shaPrima).slice(0, 8)}: ${e.message}` };
  } finally {
    for (const c of cartelle) rmSync(resolve(root, percorsoRipristino(`${c}/x`, etichetta), '..'), { recursive: true, force: true });
  }
}

/**
 * Tutto il controllo, per chi consegna: `{ ferma, testo }`. `shaPrima` è la base (baseDelConfronto).
 * Senza non si sa cosa è stato tolto: lo si dice e non si ferma (la verifica dopo rilancia la cartella).
 */
export function controllaProveTolte({ shaPrima, root, log = console.log, lancia, prepara, conPulizia = true, messi = 0 } = {}) {
  if (!SHA.test(String(shaPrima || ''))) {
    return { ferma: false, testo: 'Non so da che commit è partita la correzione: le prove del giro cancellate o cambiate non le rilancio.' };
  }
  const prove = proveTolteDal(shaPrima, root);
  if (prove === null) return { ferma: false, testo: 'Git non mi dice quali prove del giro sono state cancellate o cambiate: non le rilancio.' };
  if (!prove.length) return { ferma: false, testo: '' };
  const r = rilanciaProveTolte(prove, shaPrima, root, { log, ...(lancia ? { lancia } : {}), ...(prepara ? { prepara } : {}) });
  if (r.motivo) return { ferma: true, testo: `Consegna respinta: ${r.motivo}` };
  return esitoProveTolte({ rosse: r.rosse, shaPrima, conPulizia, messi });
}
