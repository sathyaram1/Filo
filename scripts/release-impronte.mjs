// release-impronte.mjs — la sezione «Verifica» nella pagina di una versione: commit, corsa e SHA-256 di ogni file scaricabile.
// Aggiunge o aggiorna le righe della propria piattaforma senza toglierne altre, e scrive le stesse impronte nel riassunto della corsa.
// Garanzie: tests/unit/releaseImpronte.test.mjs; il posto nella ricetta lo tiene tests/unit/releaseSuite.test.mjs.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** I file che chi scarica si porta sul disco: gli installer e il pacchetto che l'aggiornamento automatico del Mac installa. */
export const SCARICABILI = {
  Windows: ['Filo-Setup.exe'],
  Mac: ['Filo-Mac.dmg', 'Filo-Mac.zip'],
  Linux: ['Filo-Linux.AppImage'],
};

export const INIZIO = '<!-- filo-verifica:inizio -->';
export const FINE = '<!-- filo-verifica:fine -->';
const DATI = /<!-- filo-verifica:dati ([\s\S]*?) -->/;

export const COME_CONTROLLARE = 'Per controllare un file scaricato, calcola la sua impronta e confrontala con quella della tabella. '
  + 'Su Windows apri PowerShell e scrivi `Get-FileHash <file> -Algorithm SHA256`. Le lettere escono maiuscole, l\'impronta è la stessa. '
  + 'Su Mac e Linux scrivi `shasum -a 256 <file>` nel terminale; se su Linux non c\'è, `sha256sum <file>` dà la stessa impronta.';
export const PERCHE_LA_CORSA = 'Ricostruire dal sorgente non dà un file identico, perché la costruzione ci mette dentro le chiavi di default. '
  + 'Il riferimento è l\'impronta che la corsa ha scritto qui.';

// Tutto ciò che entra nella pagina passa da qui: un valore fuori forma potrebbe chiudere il commento dei dati o scrivere markup.
const FORMA = {
  nome: /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/,
  sha256: /^[0-9a-f]{64}$/,
  commit: /^[0-9a-f]{40}$/,
  corsa: /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/,
};
const VERSIONE = /^v\d+\.\d+\.\d+$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const rigaValida = (r) => !!r && typeof r === 'object'
  && Object.entries(FORMA).every(([k, re]) => typeof r[k] === 'string' && re.test(r[k]));

const ORDINE = Object.values(SCARICABILI).flat();
const posto = (nome) => (ORDINE.includes(nome) ? ORDINE.indexOf(nome) : ORDINE.length);

/** Le righe vecchie restano; una nuova con lo stesso nome prende il posto della vecchia. PURA. */
export function unisciRighe(vecchie, nuove) {
  const perNome = new Map();
  for (const r of [...(vecchie || []), ...(nuove || [])]) {
    if (rigaValida(r)) perNome.set(r.nome, { nome: r.nome, sha256: r.sha256, commit: r.commit, corsa: r.corsa });
  }
  return [...perNome.values()].sort((a, b) => posto(a.nome) - posto(b.nome) || a.nome.localeCompare(b.nome));
}

/** La sezione già nella pagina, se c'è, con le sue righe e il testo che le sta intorno. PURA. */
export function leggiSezione(corpo) {
  const testo = String(corpo ?? '');
  const i = testo.indexOf(INIZIO);
  if (i < 0) return { trovata: false, leggibile: true, righe: [], scartate: 0, prima: testo, dopo: '' };
  const f = testo.indexOf(FINE, i);
  const fineSezione = f < 0 ? testo.length : f + FINE.length;
  const m = testo.slice(i, fineSezione).match(DATI);
  let grezze = null;
  try {
    const dati = m ? JSON.parse(m[1]) : null;
    if (dati && Array.isArray(dati.righe)) grezze = dati.righe;
  } catch { /* resta null: si dice, non si indovina */ }
  const righe = (grezze || []).filter(rigaValida);
  return {
    trovata: true,
    leggibile: grezze !== null,
    righe,
    scartate: grezze ? grezze.length - righe.length : 0,
    prima: testo.slice(0, i),
    dopo: testo.slice(fineSezione),
  };
}

const unico = (valori) => (new Set(valori).size === 1 ? valori[0] : '');
const radiceRepo = (corsa) => corsa.replace(/\/actions\/runs\/\d+$/, '');
const numeroCorsa = (corsa) => corsa.match(/(\d+)$/)[1];
const linkCommit = (r) => `[\`${r.commit}\`](${radiceRepo(r.corsa)}/commit/${r.commit})`;
const linkCorsa = (corsa) => `[corsa ${numeroCorsa(corsa)} di GitHub Actions](${corsa})`;

/** Il testo della sezione. Commit e corsa vanno in testa se sono gli stessi per tutti i file, altrimenti in ogni riga. PURA. */
export function componiSezione(righe) {
  const tutte = unisciRighe([], righe);
  const commit = unico(tutte.map((r) => r.commit));
  const corsa = unico(tutte.map((r) => r.corsa));
  let testa;
  if (commit && corsa) testa = `La ${linkCorsa(corsa)} ha costruito questa versione dal commit ${linkCommit(tutte[0])}.`;
  else if (commit) testa = `Questa versione viene dal commit ${linkCommit(tutte[0])}. Accanto a ogni file c'è la corsa di GitHub Actions che l'ha costruito.`;
  else if (corsa) testa = `La ${linkCorsa(corsa)} ha costruito questa versione. Accanto a ogni file c'è il commit da cui viene.`;
  else testa = 'Accanto a ogni file ci sono il commit da cui viene e la corsa di GitHub Actions che l\'ha costruito.';

  const colonne = ['File', 'SHA-256', ...(commit ? [] : ['Commit']), ...(corsa ? [] : ['Corsa'])];
  const riga = (r) => ['`' + r.nome + '`', '`' + r.sha256 + '`',
    ...(commit ? [] : [linkCommit(r)]), ...(corsa ? [] : [`[${numeroCorsa(r.corsa)}](${r.corsa})`])];
  const tabella = [colonne, colonne.map(() => '---'), ...tutte.map(riga)].map((c) => `| ${c.join(' | ')} |`);

  return [
    INIZIO,
    '## Verifica',
    '',
    testa,
    '',
    ...tabella,
    '',
    COME_CONTROLLARE,
    '',
    PERCHE_LA_CORSA,
    '',
    `<!-- filo-verifica:dati ${JSON.stringify({ righe: tutte })} -->`,
    FINE,
  ].join('\n');
}

/** Il testo della pagina con la sezione aggiornata; il resto del testo non si tocca. PURA. */
export function aggiornaCorpo(corpo, nuove) {
  const s = leggiSezione(corpo);
  const righe = unisciRighe(s.righe, nuove);
  const avvisi = [];
  if (s.trovata && !s.leggibile) {
    avvisi.push('la sezione «Verifica» c\'era ma i suoi dati non si leggono: restano solo le righe di questo passaggio, le altre vanno rimesse ripubblicando le loro piattaforme');
  }
  if (s.scartate) avvisi.push(`${s.scartate} righe della sezione «Verifica» erano fuori forma e sono state tolte`);
  const sezione = componiSezione(righe);
  const nuovo = s.trovata
    ? s.prima + sezione + s.dopo
    : (s.prima.trim() ? `${s.prima.trimEnd()}\n\n${sezione}\n` : `${sezione}\n`);
  return { corpo: nuovo, righe, avvisi };
}

/** Le righe di questo passaggio sono nella pagina, con le stesse impronte? PURA. */
export function presenti(corpo, nuove) {
  const lette = new Map(leggiSezione(corpo).righe.map((r) => [r.nome, r]));
  return nuove.every((n) => {
    const r = lette.get(n.nome);
    return !!r && r.sha256 === n.sha256 && r.commit === n.commit && r.corsa === n.corsa;
  });
}

/**
 * Il file che GitHub fa scaricare è quello costruito qui? GitHub dichiara il SHA-256 di ogni allegato e lo mostra
 * accanto al file: un'impronta diversa nella sezione farebbe sembrare manomesso un file buono. PURA.
 */
export function confrontaAllegati(allegati, righe) {
  const perNome = new Map((Array.isArray(allegati) ? allegati : []).map((x) => [x?.name, x]));
  const problemi = [];
  const senzaImpronta = [];
  for (const r of righe) {
    const allegato = perNome.get(r.nome);
    if (!allegato) { problemi.push(`${r.nome} non è fra gli allegati della versione`); continue; }
    const dichiarata = String(allegato.digest ?? '').trim().toLowerCase();
    if (!dichiarata) senzaImpronta.push(r.nome);
    else if (dichiarata !== `sha256:${r.sha256}`) problemi.push(`${r.nome}: GitHub dichiara ${dichiarata}, il file costruito qui ha sha256:${r.sha256}`);
  }
  return { problemi, senzaImpronta };
}

/** Le stesse impronte per il riassunto della corsa. PURA. */
export function testoRiassunto({ piattaforma, versione, righe }) {
  return [
    `### Impronte SHA-256 dei file per ${piattaforma}`,
    '',
    `Versione ${versione}, commit \`${righe[0].commit}\`.`,
    '',
    '| File | SHA-256 |',
    '| --- | --- |',
    ...righe.map((r) => `| \`${r.nome}\` | \`${r.sha256}\` |`),
    '',
  ].join('\n');
}

export function impronta(file) {
  return new Promise((ok, ko) => {
    const h = createHash('sha256');
    createReadStream(file).on('error', ko).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex')));
  });
}

const OPZIONI = ['piattaforma', 'cartella', 'versione', 'repo', 'commit', 'corsa', 'verifica-dopo'];

/** Gli argomenti, controllati: un valore sbagliato ferma il passo prima di toccare la pagina. PURA. */
export function leggiArgomenti(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    const chiave = String(argv[i] || '').replace(/^--/, '');
    if (!OPZIONI.includes(chiave) || !String(argv[i]).startsWith('--')) throw new Error(`argomento sconosciuto: ${argv[i]}`);
    if (i + 1 >= argv.length) throw new Error(`manca il valore di --${chiave}`);
    a[chiave] = String(argv[i + 1]).trim();
  }
  for (const k of OPZIONI.filter((o) => o !== 'verifica-dopo')) if (!a[k]) throw new Error(`manca --${k}`);
  if (!SCARICABILI[a.piattaforma]) throw new Error(`piattaforma «${a.piattaforma}» sconosciuta: sono ${Object.keys(SCARICABILI).join(', ')}`);
  if (!VERSIONE.test(a.versione)) throw new Error(`versione «${a.versione}» fuori forma: serve vX.Y.Z`);
  if (!REPO.test(a.repo)) throw new Error(`repo «${a.repo}» fuori forma: serve proprietario/nome`);
  if (!FORMA.commit.test(a.commit)) throw new Error(`commit «${a.commit}» fuori forma: serve lo sha intero, 40 cifre esadecimali minuscole`);
  if (!FORMA.corsa.test(a.corsa)) throw new Error(`corsa «${a.corsa}» fuori forma: serve il link .../actions/runs/<numero>`);
  const dopo = a['verifica-dopo'] === undefined ? 0 : Number(a['verifica-dopo']);
  if (!Number.isFinite(dopo) || dopo < 0) throw new Error(`--verifica-dopo «${a['verifica-dopo']}» non è un numero di secondi`);
  return { ...a, verificaDopo: dopo };
}

/** Un gh appeso oltre questo tetto viene fermato e riprovato: la finestra fra lettura e scrittura resta sotto i GH_TETTO_MS * 2. */
export const GH_TETTO_MS = 20_000;
export const ATTESE_RIPROVA_S = [15, 30];
export const GIRI = 4;

// Di un gh fallito conta quello che ha detto lui, non la riga «Command failed» che Node gli mette davanti.
const primaRiga = (e) => String(e?.stderr || '').trim().split('\n')[0] || String(e?.message ?? e).split('\n')[0];

async function conRiprova(fare, { attendi, log, cosa }) {
  for (let t = 0; ; t++) {
    try {
      return await fare();
    } catch (e) {
      if (t >= ATTESE_RIPROVA_S.length) throw new Error(`${cosa}: ${primaRiga(e)}`);
      log(`${cosa} non riuscita (${primaRiga(e)}): riprovo fra ${ATTESE_RIPROVA_S[t]} s`);
      await attendi(ATTESE_RIPROVA_S[t] * 1000);
    }
  }
}

/**
 * Il lavoro intero, con gh e attese passati da fuori. Due piattaforme possono scrivere la pagina nello stesso momento
 * e l'ultima cancellerebbe le righe dell'altra: con `verificaDopo` si rilegge dopo più della finestra di scrittura altrui
 * e, se le proprie righe non ci sono più, si riscrive sopra quello che c'è.
 */
export async function esegui({ argv, gh, attendi, riassunto = () => {}, log = () => {}, caso = Math.random }) {
  const a = leggiArgomenti(argv);
  const nomi = SCARICABILI[a.piattaforma];
  const mancanti = nomi.filter((n) => !existsSync(join(a.cartella, n)));
  if (mancanti.length) throw new Error(`in ${a.cartella} mancano ${mancanti.join(', ')}: non scrivo impronte di file che non ho`);

  const righe = [];
  for (const nome of nomi) righe.push({ nome, sha256: await impronta(join(a.cartella, nome)), commit: a.commit, corsa: a.corsa });
  for (const r of righe) log(`${r.nome}  sha256 ${r.sha256}`);
  riassunto(testoRiassunto({ piattaforma: a.piattaforma, versione: a.versione, righe }));

  const leggi = () => {
    const dati = JSON.parse(gh(['release', 'view', a.versione, '--repo', a.repo, '--json', 'body,isDraft,assets']));
    return { corpo: String(dati.body ?? ''), bozza: !!dati.isDraft, allegati: dati.assets };
  };
  const dir = mkdtempSync(join(tmpdir(), 'filo-impronte-'));
  let bozza = null;
  try {
    const primo = await conRiprova(leggi, { attendi, log, cosa: `la lettura di ${a.versione}` });
    bozza = primo.bozza;
    const { problemi, senzaImpronta } = confrontaAllegati(primo.allegati, righe);
    for (const n of senzaImpronta) log(`::warning::${a.versione}: GitHub non dichiara l'impronta di ${n}, non la posso confrontare con quella del file costruito qui`);
    if (problemi.length) {
      throw new Error(`il file che GitHub fa scaricare non è quello costruito qui (${problemi.join('; ')}): non scrivo un'impronta che chi scarica non ritroverebbe`);
    }
    for (let giro = 1; giro <= GIRI; giro++) {
      await conRiprova(() => {
        const letto = leggi();
        bozza = letto.bozza;
        const { corpo, avvisi } = aggiornaCorpo(letto.corpo, righe);
        for (const av of avvisi) log(`::warning::${a.versione}: ${av}`);
        const file = join(dir, 'corpo.md');
        writeFileSync(file, corpo);
        gh(['release', 'edit', a.versione, '--repo', a.repo, '--notes-file', file]);
      }, { attendi, log, cosa: `la scrittura della sezione «Verifica» di ${a.versione}` });
      if (a.verificaDopo > 0) await attendi(Math.round((a.verificaDopo + caso() * a.verificaDopo / 3) * 1000));
      const riletto = await conRiprova(leggi, { attendi, log, cosa: `la rilettura di ${a.versione}` });
      if (presenti(riletto.corpo, righe)) {
        log(`Sezione «Verifica» di ${a.versione}: ci sono le righe di ${nomi.join(', ')}.`);
        return { righe, giri: giro, bozza };
      }
      log(`Le righe di ${a.piattaforma} non ci sono più in ${a.versione}: un altro lavoro ha scritto la pagina nello stesso momento. Le rimetto.`);
    }
    throw new Error(`dopo ${GIRI} giri le righe di ${a.piattaforma} non restano nella pagina di ${a.versione}`);
  } catch (e) {
    // Una bozza che resta tale è una versione che non esce: chi legge il riassunto deve saperlo.
    e.bozza = bozza;
    throw e;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ghVero = (args) => execFileSync('gh', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TETTO_MS, maxBuffer: 16 * 1024 * 1024,
});

async function main() {
  const fileRiassunto = process.env.GITHUB_STEP_SUMMARY;
  const riassunto = (t) => { if (fileRiassunto) appendFileSync(fileRiassunto, t + '\n'); };
  try {
    await esegui({
      argv: process.argv.slice(2),
      gh: ghVero,
      attendi: (ms) => new Promise((ok) => setTimeout(ok, ms)),
      riassunto,
      log: (t) => console.log(t),
    });
  } catch (e) {
    console.error(`::error::sezione «Verifica» non scritta: ${primaRiga(e)}`);
    riassunto(testoFallimento(e));
    process.exit(1);
  }
}

/** Il riassunto di un passo fermo: il motivo, e se la versione resta una bozza che non esce. PURA. */
export function testoFallimento(e) {
  return [
    '### La sezione «Verifica» non è stata scritta',
    '',
    `Motivo: ${primaRiga(e)}`,
    ...(e?.bozza ? ['', 'La versione è ancora una bozza e resta non pubblicata.'] : []),
    '',
  ].join('\n');
}

// Il workflow lancia una COPIA fuori dalla copia di lavoro: dietro un collegamento argv[1] e import.meta.url non
// combaciano, e senza realpath lo script uscirebbe 0 senza fare niente.
const stessoFile = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === b;
  }
};
if (process.argv[1] && stessoFile(process.argv[1], fileURLToPath(import.meta.url))) await main();
