// Unit test: la shell deve PARLARE UTF-8 (#551).
//
// Il guasto, visto dal vivo. L'utente chiede a Filo di leggere un file; Filo
// elenca la cartella col terminale e riceve «SPECIFICHE SEO E METADATI -
// singolarita.txt» e «SPECIFICHE TIPOGRAFICHE - Singolarit<27>.txt». Il file
// vero si chiama «SPECIFICHE SEO E METADATI — singolarita.txt», con il
// trattino LUNGO. Su Windows la console non scrive in UTF-8: scrive nella
// tabella OEM del sistema (cp850), dove il trattino lungo non esiste e diventa
// «-», e la «à» diventa un byte che in UTF-8 non vuol dire niente. Noi
// leggiamo lo stdout come UTF-8, quindi il modello legge nomi sbagliati, li
// ricopia, e ogni lettura successiva fallisce su un nome mai esistito.
//
// Qui si asserisce il SUCCESSO dal punto di vista dell'utente: il nome del suo
// file, con accenti e trattino lungo, torna dal terminale IDENTICO a com'è sul
// disco. Senza il preludio di codifica, su Windows, questo test è rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));

// Il nome che rompeva tutto: un trattino lungo e una «à». Entrambi assenti
// dalla tabella OEM di Windows.
const NOME_DIFFICILE = 'RELAZIONE — attività finale.txt';

const TMP = cartellaTemporanea('filo-codifica-');
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

// ───────────────────────── il preludio, per shell ────────────────────────────
// Le costanti si controllano su OGNI piattaforma: il preludio di PowerShell
// nessuno di noi lo esegue mai (si sviluppa su Windows, ma le routine girano su
// Linux), e senza questo controllo una modifica sbagliata si scoprirebbe solo
// dal vivo, settimane dopo, sulla macchina di un utente.

test('il preludio di PowerShell mette in UTF-8 sia la console sia la pipeline', () => {
  const p = T.PRELUDI_CODIFICA.powershell;
  // La codifica con cui la console SCRIVE su stdout: è questa che storpiava i nomi.
  assert.match(p, /\[Console\]::OutputEncoding\s*=/);
  // La codifica con cui PowerShell passa testo a un programma esterno.
  assert.match(p, /\$OutputEncoding\s*=/);
  // UTF-8 senza BOM: col BOM la prima riga di ogni output inizierebbe con «ï»¿».
  assert.match(p, /UTF8Encoding \$false/);
  // Il setter di [Console] può rifiutare senza una console vera attaccata, e
  // `New-Object` è vietato in modalità ristretta: il comando dell'utente deve
  // girare lo stesso, non morire sul preludio. Nessuna riga fuori da try/catch.
  const righe = p.split('\n').filter((r) => r.trim());
  assert.ok(righe.length > 0);
  for (const r of righe) {
    assert.match(r, /^try \{.*\} catch \{\}$/, `riga del preludio non protetta: ${r}`);
  }
  // Va anteposto a stdin e a righe di comando: deve finire con un a-capo.
  assert.ok(p.endsWith('\n'), 'il preludio deve finire con un a-capo');
});

test('il preludio di cmd passa alla tabella 65001 senza stampare niente', () => {
  const p = T.PRELUDI_CODIFICA.cmd;
  assert.match(p, /chcp 65001/);
  // Senza redirezione, «Tabella codici attiva: 65001» finirebbe in testa
  // all'output di ogni comando.
  assert.match(p, />nul/);
  assert.ok(p.endsWith('\r\n'));
});

test('bash e sh non hanno preludio: lo stdout è già UTF-8', () => {
  assert.equal(T.PRELUDI_CODIFICA.bash, '');
  assert.equal(T.PRELUDI_CODIFICA.sh, '');
});

test('il preludio precede il comando dell\'utente, non lo segue', () => {
  // Su Linux `resolveShell` risolve tutto in sh, quindi il preludio di Windows
  // da qui non si vede mai girare: l'ORDINE si controlla sul codice. Se il
  // preludio finisse dopo il comando, la console avrebbe già scritto l'output
  // con la codifica sbagliata e il nome sarebbe perso.
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'terminal.js'), 'utf8');
  assert.match(src, /const toRun = encodingPrelude\(usedShell\) \+ \(/);
  // Fuori da Windows non si tocca niente.
  assert.equal(T.encodingPrelude('sh'), '');
  assert.equal(T.encodingPrelude('bash'), '');
});

// ───────────── la shell persistente della dashboard usa lo stesso ────────────
// Cammini equivalenti: i comandi dell'assistente e il terminale che l'utente
// digita nella dashboard aprono shell diverse, e il guasto è identico in tutte
// e due. Qui si guarda il codice perché su Linux `shellConfig` non arriva mai
// ai rami di Windows: una copia a mano del preludio, o un ramo che se lo
// dimentica, diventa rossa subito invece che dal vivo.

test('il comando digitato dall\'utente non arriva a PowerShell con byte fuori dall\'ASCII', () => {
  // #551, primo giro di verifica, l'altro verso. Il preludio mette la shell in
  // UTF-8 quando SCRIVE. Quando LEGGE no: Windows PowerShell decodifica lo
  // stdin con la tabella di codici della console, mentre Node gli scrive UTF-8.
  // Così un comando che contiene «attività» arrivava storpiato e la shell
  // rispondeva che il file non esiste: lo stesso guasto della segnalazione,
  // dalla parte opposta. La cura è non far viaggiare caratteri non ASCII.
  const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

  // Un comando di soli caratteri ASCII parte identico a prima: `exit`, `cd`,
  // le variabili e tutto quello che un utente digita di solito non cambiano.
  for (const c of ['exit', 'cd ..', '$x = 5', 'Get-ChildItem -Name', '']) {
    assert.equal(S.comandoPerPowerShell(c), c);
  }

  // Un comando accentato parte in una forma che sul filo è solo ASCII…
  const comando = 'Get-Content "RELAZIONE — attività finale.txt"';
  const sulFilo = S.comandoPerPowerShell(comando);
  assert.ok(sulFilo !== comando, 'un comando accentato non può partire così com\'è');
  assert.ok(
    // eslint-disable-next-line no-control-regex
    /^[\x00-\x7F]*$/.test(sulFilo),
    `sul filo ci sono ancora byte fuori dall'ASCII: ${sulFilo}`,
  );

  // …e PowerShell lo rimette insieme IDENTICO a quello che l'utente ha
  // digitato. Qui si rifà il giro che farebbe lui: si ripesca il testo
  // codificato e lo si riporta a caratteri.
  const b64 = (sulFilo.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/) || [])[1];
  assert.ok(b64, 'il comando deve viaggiare codificato, non interpolato');
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), comando);
  // Niente del comando dell'utente finisce dritto nella riga: se ci finisse,
  // una virgoletta basterebbe a uscire dalla stringa e a farsi eseguire altro.
  assert.ok(!sulFilo.includes('attività'));
});

test('la shell persistente antepone gli stessi preludi (nessuna copia a mano)', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'shell.js'), 'utf8');
  assert.match(src, /PRELUDI_CODIFICA\.cmd\}prompt FILO_RDY_/);
  assert.match(src, /PRELUDI_CODIFICA\.powershell\}"FILO_RDY_/);
  // Nessuna seconda copia delle stringhe: devono venire da terminal.js.
  assert.ok(!/chcp 65001/.test(src), 'il preludio di cmd va preso da terminal.js, non ricopiato');
  assert.ok(!/OutputEncoding/.test(src), 'il preludio di PowerShell va preso da terminal.js, non ricopiato');
});

// ───────────────── il giro vero: il nome torna identico ──────────────────────

test('elencare una cartella restituisce il nome col trattino lungo e la «à» intatti', async () => {
  writeFileSync(join(TMP, NOME_DIFFICILE), 'contenuto\n', 'utf8');
  // Il comando di elenco della shell vera della piattaforma: Get-ChildItem su
  // Windows (dove il guasto vive), `ls` altrove.
  const comando = process.platform === 'win32' ? 'Get-ChildItem -Name' : 'ls';
  const out = await T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: 30_000 });
  assert.equal(out.code, 0, `il comando è fallito: ${out.stderr}`);
  assert.ok(
    out.stdout.includes(NOME_DIFFICILE),
    `il nome è tornato storpiato.\nAtteso: ${NOME_DIFFICILE}\nRicevuto:\n${out.stdout}`,
  );
  // Nessun carattere di sostituzione: se ce n'è uno, un byte si è perso per
  // strada ed è proprio il guasto che stiamo chiudendo.
  assert.ok(!out.stdout.includes('�'), 'nell\'output c\'è un carattere di sostituzione');
});

test('il marcatore della cartella corrente sopravvive al preludio', async () => {
  // Il preludio si infila prima della sonda: se rompesse il protocollo, la cwd
  // smetterebbe di persistere tra un comando e l'altro dell'assistente.
  const out = await T.runCommand('echo ciao', { cwd: TMP, trackCwd: true, timeoutMs: 30_000 });
  assert.equal(out.code, 0);
  assert.equal(out.stdout.trim(), 'ciao');
  assert.equal(out.cwd, TMP);
  assert.ok(!out.stdout.includes('__FILO_ONESHOT_CWD'), 'il marcatore non va mostrato all\'utente');
});
