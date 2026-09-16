#!/usr/bin/env node
// suite-verdict.mjs — legge l'esito JSON della suite Playwright e dice se c'è
// un rosso NUOVO, cioè fuori dai rossi noti del contenitore senza schermo.
//
// PERCHÉ ESISTE
//   Dal 2026-09-15 la suite completa gira SOLO in GitHub Actions, nel lavoro
//   di release, prima di pubblicare (.github/workflows/release.yml, job
//   `suite`). Lì un rosso non vale per forza «non pubblicare»: nel contenitore
//   senza schermo ci sono casi che sono rossi da sempre e per motivi
//   d'ambiente (una cattura dello schermo, un sito esterno), scritti in
//   tests/rossi-noti.json → contenitore.specs. Senza questo confronto la
//   suite sarebbe rossa a ogni giro e nessuna versione uscirebbe più; col
//   confronto fatto «a occhio» da un agente, il giudizio cambiava a ogni giro.
//
// COSA CONTA COME ROSSO
//   Un caso il cui esito finale è «unexpected» (fallito in tutti i tentativi,
//   compresi i retry). Un caso «flaky» (rosso a un tentativo, verde dopo) non è
//   un rosso: è già il compito dei retry assorbirlo. Gli «skipped» non contano.
//
// COME SI COPRE UN ROSSO
//   Una voce di contenitore.specs con `spec` e `caso` copre QUEL caso (`caso`
//   può essere una stringa o un elenco di titoli: certe voci coprono due test
//   sorelle). Una voce con solo `spec` copre tutto lo spec. Il percorso si
//   confronta senza badare a barre, al prefisso `tests/` e al suffisso
//   `.spec.mjs`: Playwright scrive il file relativo alla cartella dei test,
//   l'elenco lo scrive con `tests/` davanti.
//
// CODICI D'USCITA
//   0  nessun rosso nuovo (verde, o solo rossi noti)
//   1  almeno un rosso nuovo: l'elenco sta nel file di --out e a schermo
//   2  il JSON manca, non si legge o non contiene casi: la suite NON è
//      partita, e questo non è un verde (un cancello che non gira non è un
//      cancello aperto)
//
// USO
//   node scripts/suite-verdict.mjs <risultato.json> [--out <rossi-nuovi.txt>]
//                                  [--rossi <rossi-noti.json>]
//
//   Come si produce il JSON (Playwright ≥ 1.49):
//   PLAYWRIGHT_JSON_OUTPUT_NAME=suite.json npx playwright test --reporter=list,json

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * Il nome di uno spec in forma confrontabile: barre normali, senza `./`,
 * senza `tests/` davanti, senza `.spec.mjs`/`.spec.js` in coda. PURA.
 */
export function normalizzaSpec(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^tests\//, '')
    .replace(/\.spec\.(mjs|js)$/, '')
    .trim();
}

/** Un titolo in forma confrontabile: spazi ripetuti a uno, senza bordi. PURA. */
export function normalizzaTitolo(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

/**
 * Lo stato finale di un test del JSON di Playwright: 'expected', 'unexpected',
 * 'flaky' o 'skipped'. Playwright lo scrive in `test.status`; se manca (un
 * JSON scritto a mano, una versione diversa) si ricava dai tentativi. PURA.
 */
export function statoFinale(test) {
  const s = test && typeof test.status === 'string' ? test.status : '';
  if (['expected', 'unexpected', 'flaky', 'skipped'].includes(s)) return s;
  const results = Array.isArray(test?.results) ? test.results : [];
  if (!results.length) return 'skipped';
  const esiti = results.map((r) => String(r?.status || ''));
  const ultimo = esiti[esiti.length - 1];
  if (ultimo === 'passed') return esiti.some((e) => e !== 'passed') ? 'flaky' : 'expected';
  if (ultimo === 'skipped') return 'skipped';
  return 'unexpected'; // failed, timedOut, interrupted
}

/**
 * Tutti i casi del JSON, appiattiti: { spec, titolo, titoloCompleto, stato }.
 * `titoloCompleto` porta anche i describe che lo contengono (« › » fra un
 * livello e l'altro), così una voce dei rossi noti può citare il titolo nudo o
 * quello con la sua cornice. PURA.
 */
export function raccogliCasi(json) {
  const out = [];
  const visita = (suite, file, cornice, radice) => {
    if (!suite || typeof suite !== 'object') return;
    const fileQui = suite.file || file || '';
    // Il titolo della suite radice è il nome del file: non è una cornice.
    // Sotto, ogni suite è un describe e il suo titolo entra nella cornice.
    const corniceQui = radice ? [] : [...cornice, normalizzaTitolo(suite.title)];
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      const titolo = normalizzaTitolo(spec?.title);
      const specFile = spec?.file || fileQui;
      for (const t of Array.isArray(spec?.tests) ? spec.tests : []) {
        out.push({
          spec: normalizzaSpec(specFile),
          titolo,
          titoloCompleto: [...corniceQui, titolo].join(' › '),
          stato: statoFinale(t),
        });
      }
    }
    for (const s of Array.isArray(suite.suites) ? suite.suites : []) visita(s, fileQui, corniceQui, false);
  };
  for (const s of Array.isArray(json?.suites) ? json.suites : []) visita(s, '', [], true);
  return out;
}

/** I titoli che una voce dei rossi noti dichiara: stringa o elenco. PURA. */
export function casiDellaVoce(voce) {
  const c = voce?.caso;
  if (Array.isArray(c)) return c.map(normalizzaTitolo).filter(Boolean);
  const s = normalizzaTitolo(c);
  return s ? [s] : [];
}

/**
 * La voce dei rossi noti che copre questo caso, o null. Spec uguale (a meno di
 * forma) e: nessun caso dichiarato → copre tutto lo spec; altrimenti uno dei
 * titoli dichiarati è il titolo del caso, o il suo titolo completo, o una
 * coda di quest'ultimo (« describe › titolo » cita il describe, la voce no).
 * PURA.
 */
export function vocePerCaso(caso, noti) {
  const spec = normalizzaSpec(caso.spec);
  for (const voce of Array.isArray(noti) ? noti : []) {
    if (normalizzaSpec(voce?.spec) !== spec) continue;
    const titoli = casiDellaVoce(voce);
    if (!titoli.length) return voce;
    for (const t of titoli) {
      if (t === caso.titolo || t === caso.titoloCompleto) return voce;
      if (caso.titoloCompleto.endsWith(` › ${t}`)) return voce;
    }
  }
  return null;
}

/** Lo spec fittizio dei rossi che non appartengono a nessun caso. */
export const FUORI_DAI_CASI = '(fuori dai casi)';

/**
 * La prima riga di un errore fuori dai casi, senza i colori del terminale
 * (Playwright li scrive nel JSON così come li stampa). PURA.
 */
export function primaRiga(e) {
  return String(e?.message || JSON.stringify(e))
    .replace(/\[[0-9;]*m/g, '')
    .split('\n')[0]
    .trim();
}

/**
 * Gli errori fuori dai casi (un file che non si carica, un fixture rotto, un
 * worker che non chiude) divisi in ROSSI e AVVISI. Playwright li mette in
 * `json.errors`, e i casi del file colpito possono non comparire affatto: per
 * questo di regola contano come rossi nuovi, tacerli farebbe passare un file
 * intero sparito dalla suite. L'eccezione è «Worker teardown timeout»:
 * un teardown scaduto è lo strascico di un caso appeso, e se quel caso è già un
 * rosso noto il cancello non deve restare chiuso per il suo strascico. Quindi
 * i teardown sono rossi solo se nella stessa corsa c'è almeno un rosso nuovo
 * (un caso, o un altro errore fuori dai casi); altrimenti restano avvisi, col
 * numero e il testo. PURA.
 */
export function classificaErroriGlobali(errori, ciSonoRossiNuovi) {
  const teardown = [];
  const altri = [];
  for (const e of Array.isArray(errori) ? errori : []) {
    const riga = primaRiga(e);
    (/^Worker teardown timeout/i.test(riga) ? teardown : altri).push(riga);
  }
  const teardownSonoRossi = Boolean(ciSonoRossiNuovi) || altri.length > 0;
  return {
    rossi: teardownSonoRossi ? [...altri, ...teardown] : altri,
    avvisi: teardownSonoRossi ? [] : teardown,
  };
}

/**
 * Il verdetto: conta i casi per esito e separa i rossi in coperti (da una voce
 * dei rossi noti) e NUOVI. Gli errori fuori dai casi entrano fra i nuovi
 * (spec FUORI_DAI_CASI) o fra gli avvisi, secondo classificaErroriGlobali.
 * PURA.
 */
export function verdetto(json, noti) {
  const casi = raccogliCasi(json);
  const v = { totale: casi.length, verdi: 0, flaky: 0, saltati: 0, notiCoperti: [], nuovi: [], avvisi: [] };
  for (const c of casi) {
    if (c.stato === 'expected') v.verdi += 1;
    else if (c.stato === 'flaky') v.flaky += 1;
    else if (c.stato === 'skipped') v.saltati += 1;
    else {
      const voce = vocePerCaso(c, noti);
      if (voce) v.notiCoperti.push({ ...c, feedback: voce.feedback || '' });
      else v.nuovi.push(c);
    }
  }
  const globali = classificaErroriGlobali(json?.errors, v.nuovi.length > 0);
  for (const riga of globali.rossi) v.nuovi.push({ spec: FUORI_DAI_CASI, titolo: riga, titoloCompleto: riga });
  v.avvisi = globali.avvisi;
  return v;
}

/**
 * Una riga per rosso: «tests/<spec>.spec.mjs › <titolo completo>», oppure
 * «errore fuori dai casi: <testo>» per un rosso senza caso. PURA.
 */
export function rigaRosso(c) {
  if (c.spec === FUORI_DAI_CASI) return `errore fuori dai casi: ${c.titolo}`;
  return `tests/${c.spec}.spec.mjs › ${c.titoloCompleto || c.titolo}`;
}

/** Il riassunto a schermo. Non taglia niente: l'elenco è quello intero. PURA. */
export function testoRiassunto(v) {
  const avvisi = Array.isArray(v.avvisi) ? v.avvisi : [];
  const righe = [
    `Casi: ${v.totale} · verdi: ${v.verdi} · flaky (verdi dopo un tentativo): ${v.flaky} · saltati: ${v.saltati}`,
    `Rossi noti del contenitore, coperti: ${v.notiCoperti.length}`,
    ...v.notiCoperti.map((c) => `  (noto ${c.feedback || '?'}) ${rigaRosso(c)}`),
    `Rossi NUOVI: ${v.nuovi.length}`,
    ...v.nuovi.map((c) => `  ✗ ${rigaRosso(c)}`),
    `AVVISI (teardown scaduti dopo un rosso noto, non fermano): ${avvisi.length}`,
    ...avvisi.map((a) => `  ! ${a}`),
  ];
  return righe.join('\n');
}

/** Le opzioni della riga di comando. PURA. */
export function leggiArgomenti(argv) {
  const out = { file: '', out: '', rossi: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out' || a === '--rossi') {
      const k = a.slice(2);
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) throw new Error(`${a} vuole un percorso`);
      out[k] = val;
      i += 1;
    } else if (a.startsWith('--')) {
      throw new Error(`Opzione non capita: ${a}. Opzioni: --out <file> --rossi <file>`);
    } else if (!out.file) {
      out.file = a;
    } else {
      throw new Error(`Argomento di troppo: ${a}`);
    }
  }
  return out;
}

function leggiNoti(percorso) {
  const j = JSON.parse(readFileSync(percorso, 'utf8'));
  const specs = j?.contenitore?.specs;
  return Array.isArray(specs) ? specs : [];
}

async function main() {
  let opt;
  try {
    opt = leggiArgomenti(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message || e));
    console.error('Uso: node scripts/suite-verdict.mjs <risultato.json> [--out <rossi-nuovi.txt>] [--rossi <rossi-noti.json>]');
    process.exit(2);
  }
  if (!opt.file) {
    console.error('Manca il JSON dei risultati. Uso: node scripts/suite-verdict.mjs <risultato.json> [--out <file>] [--rossi <file>]');
    process.exit(2);
  }
  const fileJson = resolve(opt.file);
  if (!existsSync(fileJson)) {
    console.error(`La suite NON è partita: il JSON dei risultati non c'è (${fileJson}). Non è un verde.`);
    process.exit(2);
  }
  let json;
  try {
    json = JSON.parse(readFileSync(fileJson, 'utf8'));
  } catch (e) {
    console.error(`La suite NON ha lasciato un esito leggibile (${fileJson}): ${String(e.message || e)}. Non è un verde.`);
    process.exit(2);
  }
  let noti;
  const fileNoti = opt.rossi ? resolve(opt.rossi) : resolve(ROOT, 'tests', 'rossi-noti.json');
  try {
    noti = leggiNoti(fileNoti);
  } catch (e) {
    console.error(`L'elenco dei rossi noti non si legge (${fileNoti}): ${String(e.message || e)}.`);
    process.exit(2);
  }

  const v = verdetto(json, noti);
  const erroriGlobali = Array.isArray(json.errors) ? json.errors : [];
  if (v.totale === 0) {
    console.error('La suite NON ha eseguito nessun caso: non è un verde.');
    for (const e of erroriGlobali) console.error(`  errore: ${String(e?.message || JSON.stringify(e)).split('\n')[0]}`);
    process.exit(2);
  }
  console.log(testoRiassunto(v));
  if (erroriGlobali.length) {
    // Errori fuori dai casi (un file che non si carica, un fixture rotto):
    // Playwright li mette qui e i casi di quel file non compaiono. Si dicono,
    // e si contano come rossi nuovi: tacerli farebbe passare un file intero
    // sparito dalla suite.
    console.log(`Errori fuori dai casi: ${erroriGlobali.length}`);
    for (const e of erroriGlobali) {
      const riga = String(e?.message || JSON.stringify(e)).split('\n')[0];
      console.log(`  ✗ ${riga}`);
      v.nuovi.push({ spec: '(fuori dai casi)', titolo: riga, titoloCompleto: riga });
    }
  }
  if (opt.out) {
    const righe = v.nuovi.map((c) => (c.spec === '(fuori dai casi)' ? `errore fuori dai casi: ${c.titolo}` : rigaRosso(c)));
    writeFileSync(resolve(opt.out), righe.length ? `${righe.join('\n')}\n` : '', 'utf8');
  }
  process.exit(v.nuovi.length ? 1 : 0);
}

const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) main();
