// Verifica #569, giro 1 — «Controlli automatici rossi: nessuna versione pubblicata».
//
// IL SINTOMO
//   Il cancello prima della pubblicazione ha trovato due controlli automatici
//   rossi sul ramo principale: la versione non è uscita e gli utenti sono
//   rimasti sull'ultima buona (dall'11 al 15 settembre 2026). Il file delle
//   regole era giusto: a cambiare era il CHECKOUT. Sul runner della
//   pubblicazione Git for Windows riscrive i fini riga in CRLF, e una
//   sentinella che cercava `indexOf('allow update: if\n        isAdmin()')`
//   non trovava più niente — accusando un file in cui quel ramo c'era.
//
// COSA PROVA QUESTO FILE
//   1. che le regole si leggano allo stesso modo da un checkout con CRLF
//      (la porta che si era rotta);
//   2. che `.gitattributes` tolga la differenza alla radice, e che la sua
//      premessa regga (nessun file del repo ha bisogno di CRLF);
//   3. che il lettore condiviso normalizzi davvero;
//   4. che nessun altro test, OVUNQUE sotto tests/, analizzi un file del repo
//      con una ricerca che un CRLF spezza.
//
//   Il punto 4 è più largo della sentinella del ramo (tests/unit/finiDiRiga),
//   che guarda la sola cartella tests/unit e non scende nelle sottocartelle:
//   è la porta accanto da cui il #565 è rientrato come #569.
//
// Si lancia con `node --test tests/verifica/569/`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { leggiTestoRepo, normalizzaFiniRiga } from '../../helpers/testo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const TESTS = join(ROOT, 'tests');

// Il ritaglio del ramo di update: la stessa forma che la sentinella del ramo
// usa, riscritta qui perché questa prova deve reggere da sé.
function bloccoUpdate(testo, guardia) {
  const inizio = new RegExp(`allow update: if\\s+${guardia}\\(\\)`).exec(testo);
  assert.notEqual(inizio, null, `manca il ramo di update con ${guardia}()`);
  const resto = testo.slice(inizio.index);
  const dopo = /\n\s*allow /.exec(resto.slice(1));
  return dopo ? resto.slice(0, dopo.index + 1) : resto;
}

test('#569 giro 1: le regole dei livelli si leggono uguali da un checkout LF e da uno CRLF', () => {
  const lf = leggiTestoRepo(join(ROOT, 'firestore.rules'));
  const comeSuWindows = lf.replace(/\n/g, '\r\n');
  assert.ok(comeSuWindows.includes('\r\n'), 'la copia di prova deve avere davvero i CRLF');

  for (const guardia of ['isAdmin', 'isRoutine']) {
    for (const [etichetta, testo] of [['LF', lf], ['CRLF', comeSuWindows]]) {
      const blocco = bloccoUpdate(testo, guardia);
      assert.match(blocco, /'livelli'/, `${guardia} (${etichetta}): 'livelli' deve stare nell'hasOnly`);
      assert.match(
        blocco,
        /livelliValidi\(request\.resource\.data\)/,
        `${guardia} (${etichetta}): il vincolo di forma va applicato`,
      );
    }
  }
});

test('#569 giro 1: la forma che si era rotta resta rotta — è il motivo per cui non si usa più', () => {
  // La prova che il difetto era davvero questo: la ricerca con un «a capo» in
  // mezzo trova su LF e NON trova su CRLF. Se un giorno questa prova diventasse
  // verde su tutte e due, vorrebbe dire che il file ha cambiato forma e che la
  // memoria di questo giro va riletta.
  const lf = leggiTestoRepo(join(ROOT, 'firestore.rules'));
  const crlf = lf.replace(/\n/g, '\r\n');
  const cercata = "allow update: if\n        isAdmin()";
  assert.notEqual(lf.indexOf(cercata), -1, 'su LF la vecchia ricerca trovava');
  assert.equal(crlf.indexOf(cercata), -1, 'su CRLF la vecchia ricerca non trova: è il rosso del cancello');
});

test('#569 giro 1: .gitattributes pretende LF, e la sua premessa regge', () => {
  const percorso = join(ROOT, '.gitattributes');
  assert.ok(existsSync(percorso), 'manca .gitattributes: i fini riga li deciderebbe la macchina che scarica il repo');
  const riga = leggiTestoRepo(percorso)
    .split('\n')
    .map((r) => r.trim())
    .find((r) => r.startsWith('*') && /text=auto/.test(r));
  assert.ok(riga, '.gitattributes deve dichiarare `* text=auto`');
  assert.match(riga, /eol=lf/, `la regola c'è ma non fissa i fini riga: "${riga}"`);

  // La premessa scritta nel file: nel repo non c'è niente che abbia BISOGNO di
  // CRLF. Se un domani entra un .bat/.cmd/.ps1, LF per tutti lo romperebbe e
  // questa riga va ripensata insieme a lui.
  const tracciati = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  const chiVuoleCrlf = tracciati.filter((f) => /\.(bat|cmd|ps1)$/i.test(f));
  assert.deepEqual(
    chiVuoleCrlf,
    [],
    'questi file vogliono CRLF: `* text=auto eol=lf` glielo toglie, servono una riga loro in .gitattributes',
  );
});

test('#569 giro 1: il lettore condiviso normalizza CRLF e CR soli', () => {
  assert.equal(normalizzaFiniRiga('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(normalizzaFiniRiga('a\rb'), 'a\nb');
  assert.equal(normalizzaFiniRiga('a\nb'), 'a\nb');
  for (const f of ['firestore.rules', 'storage.rules', 'PATTERNS.md']) {
    assert.ok(!leggiTestoRepo(join(ROOT, f)).includes('\r'), `${f}: il lettore deve toglierli tutti`);
  }
});

// I file del repo che un test ANALIZZA riga per riga: lì un CRLF è un test che
// mente, non un carattere in più.
const FILE_ANALIZZATI = /(firestore\.rules|storage\.rules|PATTERNS\.md|patterns[/\\])/;

function tuttiIFileDiTest(cartella, dentro = []) {
  for (const nome of readdirSync(cartella)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const p = join(cartella, nome);
    if (statSync(p).isDirectory()) tuttiIFileDiTest(p, dentro);
    else if (nome.endsWith('.mjs')) dentro.push(p);
  }
  return dentro;
}

test('#569 giro 1: nessun test, in nessuna cartella sotto tests/, cerca in un file del repo con un «a capo» in mezzo', () => {
  // Più largo della sentinella del ramo, che guarda la sola tests/unit senza
  // scendere: una prova messa in tests/, in tests/rules/ o in una verifica
  // passerebbe di lì senza che nessuno se ne accorga. È esattamente come il
  // #565 è rientrato dalla porta accanto ed è diventato il #569.
  const conACapoInMezzo = /\.(indexOf|lastIndexOf|includes|startsWith|endsWith|split)\(\s*(['"`])(?:(?!\2)[^\\])+\\n/;
  const colpevoli = [];
  for (const percorso of tuttiIFileDiTest(TESTS)) {
    const rel = relative(ROOT, percorso).replace(/\\/g, '/');
    if (rel.endsWith('tests/unit/finiDiRiga.test.mjs')) continue; // si nomina da sé
    if (rel.startsWith('tests/verifica/569/')) continue; // questo file, idem
    let sorgente;
    try { sorgente = leggiTestoRepo(percorso); } catch { continue; }
    if (!FILE_ANALIZZATI.test(sorgente)) continue; // non legge nessuno di quei file
    sorgente.split('\n').forEach((riga, i) => {
      if (conACapoInMezzo.test(riga)) colpevoli.push(`${rel}:${i + 1}: ${riga.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    colpevoli,
    [],
    'una stringa da cercare con un «a capo» in mezzo non regge un checkout con CRLF: usa una regex con \\s+, '
    + 'oppure leggi il file con leggiTestoRepo() — è il difetto del #569',
  );
});

test('#569 giro 1: la sentinella del ramo riconosce la forma malata (non è una prova che non può diventare rossa)', () => {
  // Si dà in pasto alla stessa regex della sentinella un pezzo di test scritto
  // com'era scritto quello che ha fermato la pubblicazione: deve riconoscerlo.
  const conACapoInMezzo = /\.(indexOf|lastIndexOf|includes|startsWith|endsWith|split)\(\s*(['"`])(?:(?!\2)[^\\])+\\n/;
  const malata = String.raw`  const i = regole.indexOf('allow update: if\n        isAdmin()');`;
  assert.ok(conACapoInMezzo.test(malata), 'la forma del #569 deve essere riconosciuta');

  // E non deve gridare su quella sana: un «a capo» in TESTA regge (il \r sta
  // prima), e una regex con \s+ è la cura, non il difetto.
  const sanaInTesta = String.raw`  const j = RULES.indexOf('\n    match /', i + 10);`;
  const sanaRegex = String.raw`  const inizio = new RegExp('allow update: if\\s+' + guardia).exec(testo);`;
  assert.ok(!conACapoInMezzo.test(sanaInTesta), 'un «a capo» in testa non è un difetto');
  assert.ok(!conACapoInMezzo.test(sanaRegex), 'la cura non deve essere segnalata come difetto');
});

test('#569 giro 1: ogni test che analizza un file del repo passa dal lettore condiviso', () => {
  const colpevoli = [];
  for (const percorso of tuttiIFileDiTest(TESTS)) {
    const rel = relative(ROOT, percorso).replace(/\\/g, '/');
    if (rel.endsWith('tests/unit/finiDiRiga.test.mjs')) continue;
    if (rel.startsWith('tests/verifica/')) continue; // memoria dei giri passati: non si riscrive
    const sorgente = readFileSync(percorso, 'utf8');
    sorgente.split(/\r?\n/).forEach((riga, i) => {
      if (!/readFileSync\s*\(/.test(riga)) return;
      if (!FILE_ANALIZZATI.test(riga)) return;
      colpevoli.push(`${rel}:${i + 1}: ${riga.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    colpevoli,
    [],
    'questi file del repo vengono analizzati riga per riga: leggili con leggiTestoRepo() (tests/helpers/testo.mjs)',
  );
});
