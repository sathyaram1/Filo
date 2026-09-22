// Giro 1 di verifica del feedback #572 — «controlli automatici rossi: nessuna
// versione pubblicata».
//
// Il sintomo, visto da chi aspetta la versione nuova: il cancello che pubblica
// gira su `windows-latest`, dove git ha di serie `core.autocrlf=true`. Lì ogni
// file di testo finisce nella copia di lavoro con CRLF, e i byte che il codice
// legge non sono più quelli che stanno in git: gli hook che bash esegue non
// partono (ed escono 0, quindi nessuno se ne accorge) e le regex ancorate a
// fine riga non riconoscono più i file del repo. Su Linux e su Mac non succede
// mai — è per questo che il rosso lo vedeva solo il cancello.
//
// Qui la lamentela si riproduce per davvero, senza un Windows sotto mano: si
// clona il repo ESATTAMENTE come lo clona il contenitore del cancello
// (`-c core.autocrlf=true`) e si guarda cosa arriva nella copia di lavoro.
// Senza la correzione questo file è rosso: provato su un clone di `main`, dove
// la stessa clonazione porta CRLF in tutto (PATTERNS.md, CLAUDE.md, i quattro
// hook di `.claude/hooks/`) e i controlli che eseguono gli hook diventano rossi.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Le estensioni che sono testo davvero: in un .png un `\r` è un byte come un
// altro. I due PDF di prova hanno un controllo tutto loro più sotto.
const TESTO = ['.mjs', '.js', '.cjs', '.md', '.json', '.html', '.css', '.yml',
  '.yaml', '.txt', '.sh', '.rules', '.gitignore', '.gitattributes', '.firebaserc'];
const diTesto = (f) => TESTO.some((e) => f.endsWith(e));

let clone = '';

const git = (args, cwd) => execFileSync('git', args, {
  cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});

test.beforeAll(() => {
  test.setTimeout(180_000);
  clone = join(cartellaTemporanea('filo-572-'), 'copia-windows');
  // La stessa clonazione del cancello: autocrlf acceso, come su windows-latest.
  git(['clone', '--quiet', '-c', 'core.autocrlf=true', ROOT, clone], ROOT);
  // I moduli servono solo a far girare i controlli dentro al clone.
  try { symlinkSync(join(ROOT, 'node_modules'), join(clone, 'node_modules'), 'junction'); } catch (_) {}
});

test.afterAll(() => {
  if (clone) { try { rmSync(resolve(clone, '..'), { recursive: true, force: true }); } catch (_) {} }
});

test('#572 — clonato come fa il cancello su Windows, nessun file di testo arriva con CRLF', () => {
  const tracciati = git(['ls-files', '-z'], clone).split('\0').filter(Boolean);
  expect(tracciati.length).toBeGreaterThan(100);
  const conCrlf = tracciati
    .filter(diTesto)
    .filter((f) => existsSync(join(clone, f)))
    .filter((f) => readFileSync(join(clone, f)).includes(0x0d));
  expect(conCrlf, 'su un clone con core.autocrlf acceso questi file di testo arrivano con CRLF: '
    + 'gli hook non partono e le regex ancorate a fine riga non riconoscono più niente').toEqual([]);
});

test('#572 — gli hook che bash esegue arrivano con lo shebang pulito', () => {
  const hooks = git(['ls-files', '-z', '.claude/hooks'], clone).split('\0')
    .filter((f) => f.endsWith('.sh'));
  expect(hooks.length, 'nessun hook trovato: il controllo non sta guardando niente')
    .toBeGreaterThan(0);
  for (const h of hooks) {
    const prima = readFileSync(join(clone, h), 'utf8').split('\n')[0];
    expect(prima.startsWith('#!'), `${h}: manca lo shebang`).toBe(true);
    expect(prima.includes('\r'), `${h}: shebang con ritorno carrello — bash ci passa sopra ed esce 0, `
      + 'e il salvataggio automatico smette di committare senza dirlo').toBe(false);
  }
});

test('#572 — PATTERNS.md conserva le sue voci anche a una regex ancorata a fine riga', () => {
  // È il modo in cui il guasto si è mostrato: l'indice risultava «senza nessuna
  // voce» perché per una regex `\r` è già fine riga e `$` non ci arriva mai.
  const testo = readFileSync(join(clone, 'PATTERNS.md'), 'utf8');
  const voci = testo.split('\n').filter((r) => /^- \*\*\[.+\]\(patterns\/.+\.md\)\*\* — .+$/.test(r));
  expect(voci.length, 'PATTERNS.md nel clone risulta senza voci riconoscibili').toBeGreaterThan(10);
});

test('#572 — i PDF di prova arrivano identici al byte', () => {
  const pdf = git(['ls-files', '-z'], clone).split('\0').filter((f) => f.endsWith('.pdf'));
  expect(pdf.length, 'nessun PDF di prova trovato').toBeGreaterThan(0);
  for (const f of pdf) {
    const inGit = execFileSync('git', ['cat-file', 'blob', `HEAD:${f}`], { cwd: clone, maxBuffer: 64 * 1024 * 1024 });
    const suDisco = readFileSync(join(clone, f));
    const impronta = (b) => createHash('md5').update(b).digest('hex');
    expect(impronta(suDisco), `${f}: la copia di lavoro non è quella che sta in git — `
      + 'un file senza byte nulli viene convertito come se fosse testo').toBe(impronta(inGit));
  }
});

test('#572 — nel clone alla maniera di Windows i controlli che eseguono gli hook restano verdi', () => {
  test.setTimeout(180_000);
  // Su un clone di `main` questi diventano rossi: gli hook vengono eseguiti da
  // bash, e con un CRLF bash non trova nemmeno la cartella in cui entrare.
  const esito = execFileSync(process.execPath,
    ['--test', 'tests/unit/autoCommitGate.test.mjs', 'tests/unit/fineRigaLf.test.mjs'],
    { cwd: clone, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 150_000 });
  expect(esito).toMatch(/\n# fail 0\n/);
});
