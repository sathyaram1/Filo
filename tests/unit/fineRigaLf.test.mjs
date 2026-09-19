// Sentinella: in ogni copia di lavoro i file di testo finiscono con LF.
//
// Perché conta, e perché non basta correggere le singole regex. Il cancello che
// pubblica le versioni gira su `windows-latest`, dove git ha di serie
// `core.autocrlf=true`: senza una regola esplicita ogni file di testo viene
// scritto nella copia di lavoro con CRLF, e i byte che il codice legge non sono
// più quelli che stanno in git. Su Linux e su Mac non succede mai, quindi il
// danno non lo vede nessuno finché non si ferma la pubblicazione:
//
//   • gli hook di `.claude/hooks/*.sh` vengono ESEGUITI da bash. Con un CRLF
//     bash legge `cd /percorso\r`, non trova la cartella, tira dritto ed esce
//     0. Il salvataggio automatico — che è il TRASPORTO del lavoro, non solo il
//     paracadute — smette di committare e di spedire senza dirlo a nessuno;
//   • ogni sentinella che legge un file del repo con una regex ancorata a fine
//     riga smette di riconoscere alcunché: per una regex `\r` è già fine riga,
//     quindi `$` non ci arriva mai. PATTERNS.md è risultato «senza nessuna
//     voce» e la pubblicazione si è fermata lì (feedback #565, poi #572).
//
// La cura sta in `.gitattributes` ed è una sola per tutti i casi. Questi assert
// servono a non riaprire la porta: sono rossi in millisecondi sulla macchina di
// chi scrive la modifica, invece che in un cancello che nessuno guarda.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATTRIBUTI = join(ROOT, '.gitattributes');

// I file che git tiene sotto controllo, chiesti a git: l'elenco vero, senza
// ricostruirlo a mano e senza incappare in ciò che .gitignore esclude.
function fileTracciati() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

// Le estensioni che sono testo per davvero. I binari (.png, .ico, .pdf) restano
// fuori: lì un `\r` è un byte come un altro e non vuol dire niente.
const TESTO = ['.mjs', '.js', '.cjs', '.md', '.json', '.html', '.css', '.yml',
  '.yaml', '.txt', '.sh', '.rules', '.gitignore', '.gitattributes', '.firebaserc'];

const diTesto = (f) => TESTO.some((e) => f.endsWith(e)) || f.split('/').pop().startsWith('.git');

// La cura per una copia di lavoro che è GIÀ storta.
//
// `.gitattributes` decide come nasce un file al checkout, quindi vale su un
// clone nuovo. Su una copia che esiste già non succede niente: una fusione
// riscrive solo i file che cambiano, e tutti gli altri — gli hook compresi —
// restano com'erano. Le due strade che vengono in mente per prime non
// funzionano, provate tutte e due: `git checkout -- .` non riscrive un file che
// per git è a posto, e `git add --renormalize .` sistema l'indice, non il disco.
// Quella che funziona è svuotare l'indice e ripristinare dai byte che stanno in
// git. Senza questa riga chi legge il rosso qui sotto non sa come uscirne.
const CURA = 'Una copia di lavoro che è già storta non si raddrizza da sola: '
  + '`.gitattributes` vale al prossimo checkout di quel file, e una fusione tocca solo ciò '
  + 'che cambia. Per rimetterla a posto tutta: `git rm --cached -r .` e poi `git reset --hard` '
  + '(attenzione: `--hard` butta le modifiche non committate), oppure riclona il repo. '
  + '`git checkout -- .` e `git add --renormalize .` NON bastano: provati, lasciano i file come sono.';

// Il nome dei colpevoli senza scaricare mille righe addosso a chi legge: i
// primi otto e il numero VERO di tutti gli altri. Un elenco tagliato in
// silenzio farebbe credere che i file rotti siano otto.
function elenco(nomi) {
  const primi = nomi.slice(0, 8).join(', ');
  if (nomi.length <= 8) return primi;
  return `${primi} … e altri ${nomi.length - 8} (${nomi.length} in tutto)`;
}

describe('fine riga: LF in ogni copia di lavoro', () => {
  test('.gitattributes impone LF a tutto, e agli .sh per nome', () => {
    assert.ok(existsSync(ATTRIBUTI),
      '.gitattributes non c\'è: senza, su Windows ogni file di testo esce con CRLF '
      + 'e il salvataggio automatico smette di funzionare in silenzio');
    const testo = readFileSync(ATTRIBUTI, 'utf8');
    const righe = testo.split(/\r?\n/).map((r) => r.trim()).filter((r) => r && !r.startsWith('#'));
    assert.ok(
      righe.some((r) => /^\*\s+text=auto\s+eol=lf$/.test(r)),
      'manca la regola generale `* text=auto eol=lf`: è quella che vince su core.autocrlf '
      + `qualunque cosa abbia configurato chi clona. Righe trovate: ${JSON.stringify(righe)}`,
    );
    assert.ok(
      righe.some((r) => /^\*\.sh\s+text\s+eol=lf$/.test(r)),
      'manca `*.sh text eol=lf`: gli hook vengono eseguiti da bash, lì un CRLF è uno script che non parte',
    );
  });

  test('nessun file di testo tracciato contiene un ritorno carrello', () => {
    const colpevoli = [];
    for (const f of fileTracciati()) {
      if (!diTesto(f)) continue;
      const p = join(ROOT, f);
      if (!existsSync(p)) continue; // cancellato ma ancora in indice: non è affar nostro
      if (readFileSync(p).includes(0x0d)) colpevoli.push(f);
    }
    assert.equal(colpevoli.length, 0,
      `file di testo con un ritorno carrello dentro: ${elenco(colpevoli)}. `
      + 'Una regex ancorata a fine riga non li riconosce più, e un .sh così non parte. '
      + CURA);
  });

  test('gli hook che bash esegue cominciano con uno shebang pulito', () => {
    // Il caso peggiore ha una firma sua: se la riga dello shebang porta un
    // `\r`, bash non fallisce — prosegue e esce 0. Vale la pena guardarlo da
    // vicino invece di fidarsi solo del controllo qui sopra.
    const hooks = fileTracciati().filter((f) => f.startsWith('.claude/hooks/') && f.endsWith('.sh'));
    assert.ok(hooks.length > 0, 'nessun hook .sh trovato: il controllo non sta guardando niente');
    const rotti = hooks.filter((f) => {
      const prima = readFileSync(join(ROOT, f), 'utf8').split('\n')[0];
      return !prima.startsWith('#!') || prima.includes('\r');
    });
    assert.equal(rotti.length, 0,
      `hook con lo shebang sporco: ${elenco(rotti)}. Bash ci passa sopra, non committa e `
      + 'non spedisce, ed esce 0: il salvataggio automatico è fermo e non lo dice. ' + CURA);
  });

  test('nessun sorgente tracciato contiene un NUL scritto grezzo', () => {
    // Un NUL dentro un sorgente fa considerare il file BINARIO a git: sparisce
    // dai diff e — quello che conta qui — `text=auto` NON lo normalizza più,
    // quindi si tiene i suoi CRLF mentre tutto il resto è a posto. È l'unica
    // via d'uscita dalla regola generale, ed è capitata davvero (uno spec
    // scriveva il carattere invece dell'escape `\u0000`).
    const colpevoli = [];
    for (const f of fileTracciati()) {
      if (!diTesto(f)) continue;
      const p = join(ROOT, f);
      if (!existsSync(p)) continue;
      if (readFileSync(p).includes(0x00)) colpevoli.push(f);
    }
    assert.equal(colpevoli.length, 0,
      `sorgenti con un NUL vero dentro: ${elenco(colpevoli)}. Scrivilo come escape `
      + '(`\\u0000`), altrimenti git li tratta da binari e la regola di fine riga non li tocca');
  });
});
