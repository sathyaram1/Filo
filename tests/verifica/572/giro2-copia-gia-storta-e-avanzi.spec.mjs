// Giro 2 di verifica del feedback #572 — «controlli automatici rossi: nessuna
// versione pubblicata».
//
// Il giro 1 aveva chiuso la porta principale (un clone nuovo alla maniera di
// Windows nasce con i fine riga giusti) e aveva lasciato aperte due cose:
//
//   • una copia di lavoro che ESISTE GIÀ resta storta anche dopo aver preso la
//     correzione, e il rosso che la denuncia deve dire una cura che funziona
//     davvero — le due strade che vengono in mente per prime non funzionano;
//   • il repo si portava dietro degli avanzi (cartelle di lavoro registrate per
//     sbaglio, uno scarto vuoto) che viaggiano in ogni copia.
//
// Qui si prova che tutt'e due sono chiuse, senza un Windows sotto mano.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const TESTO = ['.mjs', '.js', '.cjs', '.md', '.json', '.html', '.css', '.yml',
  '.yaml', '.txt', '.sh', '.rules', '.gitignore', '.gitattributes', '.firebaserc'];
const diTesto = (f) => TESTO.some((e) => f.endsWith(e));

let base = '';

const git = (args, cwd) => execFileSync('git', args, {
  cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});

const tracciati = (cwd) => git(['ls-files', '-z'], cwd).split('\0').filter(Boolean);

const conRitornoCarrello = (cwd) => tracciati(cwd)
  .filter(diTesto)
  .filter((f) => existsSync(join(cwd, f)))
  .filter((f) => readFileSync(join(cwd, f)).includes(0x0d));

// La sentinella del repo, eseguita DENTRO la copia in esame: è quello che vede
// chi lancia i controlli su quella cartella.
function sentinella(cwd) {
  try {
    const out = execFileSync(process.execPath, ['--test', 'tests/unit/fineRigaLf.test.mjs'],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    return { verde: true, testo: out };
  } catch (e) {
    return { verde: false, testo: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test.beforeAll(() => {
  base = cartellaTemporanea('filo-572-g2-');
});

test.afterAll(() => {
  if (base) { try { rmSync(base, { recursive: true, force: true }); } catch (_) {} }
});

test('#572 giro 2 — una copia di lavoro già storta: il rosso dice una cura che funziona davvero', () => {
  test.setTimeout(300_000);
  const copia = join(base, 'copia-vecchia');
  // Come la clona git di Windows, con core.autocrlf acceso di serie.
  git(['clone', '--quiet', '-c', 'core.autocrlf=true', ROOT, copia], ROOT);

  // La copia che esisteva PRIMA della correzione: si torna indietro allo stato
  // senza la regola di fine riga, si rifà il checkout (e lì autocrlf scrive
  // CRLF dappertutto), poi si riprende la correzione come farebbe una fusione
  // — che riscrive solo il file cambiato e lascia storto tutto il resto.
  const comeGit = ['-c', 'user.email=prova@filo.test', '-c', 'user.name=prova'];
  git(['rm', '--quiet', '.gitattributes'], copia);
  git([...comeGit, 'commit', '--quiet', '-m', 'senza attributi, come prima'], copia);
  const senzaAttributi = git(['rev-parse', 'HEAD'], copia).trim();
  git(['rm', '--cached', '-r', '.', '--quiet'], copia);
  git(['reset', '--hard', '--quiet'], copia);
  expect(conRitornoCarrello(copia).length,
    'senza la regola di fine riga il clone non si è sporcato: la prova non sta provando niente')
    .toBeGreaterThan(100);
  git([...comeGit, 'revert', '--no-edit', '--no-commit', senzaAttributi], copia);
  git([...comeGit, 'commit', '--quiet', '-m', 'arriva la correzione'], copia);
  expect(existsSync(join(copia, '.gitattributes')),
    'la correzione non è arrivata nella copia').toBe(true);
  // È qui la trappola: per git i file di testo storti non risultano nemmeno
  // modificati (li normalizza prima di confrontarli), quindi non c'è niente
  // che dica a chi guarda che la sua copia è da buttare. Si muovono solo i
  // binari, che una conversione l'avevano subita davvero.
  const sporchi = git(['status', '--porcelain'], copia).split('\n')
    .map((r) => r.slice(3).trim()).filter(Boolean).filter(diTesto);
  expect(sporchi, 'git segnala da sé i file di testo storti: la prova non è il caso vero')
    .toEqual([]);
  expect(conRitornoCarrello(copia).length,
    'la copia si è raddrizzata da sola prendendo la correzione: non è il caso da provare')
    .toBeGreaterThan(100);

  // Il rosso arriva, e dice cosa fare. Senza la riga della cura chi lo legge
  // resta davanti a milleduecento nomi e nessuna strada.
  const rosso = sentinella(copia);
  expect(rosso.verde, 'la sentinella non si accorge di una copia di lavoro tutta a CRLF').toBe(false);
  expect(rosso.testo, 'il rosso non dice come si rimette a posto una copia già storta')
    .toContain('git rm --cached -r .');
  expect(rosso.testo).toContain('git reset --hard');
  expect(rosso.testo, 'il rosso non avverte che `--hard` butta le modifiche non committate')
    .toMatch(/modifiche non committate/);

  // Le due strade che vengono in mente per prime non funzionano: il rosso lo
  // dice, e qui si controlla che lo dica perché è vero.
  git(['checkout', '--', '.'], copia);
  expect(conRitornoCarrello(copia).length,
    '`git checkout -- .` raddrizza la copia: allora il rosso sta dicendo una cosa falsa').toBeGreaterThan(100);
  git(['add', '--renormalize', '.'], copia);
  expect(conRitornoCarrello(copia).length,
    '`git add --renormalize .` raddrizza la copia: allora il rosso sta dicendo una cosa falsa').toBeGreaterThan(100);

  // La cura scritta nel rosso, eseguita alla lettera.
  git(['rm', '--cached', '-r', '.', '--quiet'], copia);
  git(['reset', '--hard', '--quiet'], copia);

  expect(conRitornoCarrello(copia),
    'dopo la cura restano file a CRLF: la strada indicata non porta da nessuna parte').toEqual([]);
  expect(git(['status', '--porcelain'], copia).trim(),
    'dopo la cura la copia non è pulita: chi la segue si ritrova un cantiere aperto').toBe('');
  for (const h of tracciati(copia).filter((f) => f.startsWith('.claude/hooks/') && f.endsWith('.sh'))) {
    const prima = readFileSync(join(copia, h), 'utf8').split('\n')[0];
    expect(prima.includes('\r'), `${h}: lo shebang è ancora sporco dopo la cura`).toBe(false);
  }
  expect(sentinella(copia).verde, 'dopo la cura la sentinella è ancora rossa').toBe(true);
});

test('#572 giro 2 — in ogni copia del repo non arrivano più avanzi (cartelle di lavoro, scarti)', () => {
  test.setTimeout(120_000);
  const copia = join(base, 'copia-pulita');
  git(['clone', '--quiet', '-c', 'core.autocrlf=true', ROOT, copia], ROOT);

  const gitlink = git(['ls-files', '-s'], copia).split('\n')
    .filter((r) => r.startsWith('160000')).map((r) => r.split('\t').pop());
  expect(gitlink, 'chi clona si ritrova cartelle vuote che puntano a commit che non esistono')
    .toEqual([]);

  const ignoratiMaTracciati = git(['ls-files', '-i', '-c', '--exclude-standard'], copia)
    .split('\n').filter(Boolean);
  expect(ignoratiMaTracciati, 'file che il repo dice di escludere viaggiano lo stesso in ogni copia')
    .toEqual([]);

  // Gli scarti dei comandi andati storti: nati vuoti in radice, committati per
  // sbaglio, mai più guardati.
  const scarti = tracciati(copia).filter((f) => f.endsWith('.err'));
  expect(scarti, 'scarti di comandi andati storti ancora dentro al repo').toEqual([]);
});
