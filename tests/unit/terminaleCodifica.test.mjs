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
import { writeFileSync, rmSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));

// Da solo un comando qui dura pochi secondi; fra gli unit test in parallelo PowerShell sulla macchina dell'owner
// ne ha presi 61 e il tetto di 60 faceva un rosso finto. Le prove misurano l'esito, non la velocità.
const ATTESA = 300_000;

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
  // L'ORDINE si controlla sul codice, uguale su ogni sistema. Se il preludio
  // finisse dopo il comando, la console avrebbe già scritto l'output con la
  // codifica sbagliata e il nome sarebbe perso.
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'terminal.js'), 'utf8');
  assert.match(src, /const toRun = encodingPrelude\(usedShell\) \+ \(/);
});

test('il preludio è quello della shell che gira, non di quella chiesta', () => {
  // Su Windows «sh» gira come PowerShell, fuori da Windows «powershell» gira
  // come sh: il preludio sbagliato arriva a una shell che non lo capisce (#714).
  for (const chiesta of ['sh', 'bash', 'powershell', 'cmd', 'zsh', '', undefined]) {
    const vera = T.resolveShell(chiesta);
    assert.equal(typeof T.PRELUDI_CODIFICA[vera], 'string', `nessun preludio per la shell ${vera}`);
    assert.equal(
      T.encodingPrelude(chiesta), T.PRELUDI_CODIFICA[vera],
      `chiesta «${chiesta}», gira «${vera}»: il preludio non è il suo`,
    );
  }
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
  const out = await T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
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
  const out = await T.runCommand('echo ciao', { cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
  assert.equal(out.code, 0);
  assert.equal(out.stdout.trim(), 'ciao');
  assert.equal(out.cwd, TMP);
  assert.ok(!out.stdout.includes('__FILO_ONESHOT_CWD'), 'il marcatore non va mostrato all\'utente');
});

// ───────── l'altra metà: il nome non si rompe FRA una lettura e l'altra ──────
//
// #551, secondo giro di verifica. Il preludio chiude il guasto dentro la
// shell; questo chiude quello che sta fra la shell e Filo. L'output di un
// comando non arriva in un pezzo solo: arriva man mano, e ogni pezzo finisce
// dove capita. Una «à» occupa due byte e un'emoji quattro: se la lettura cade
// in mezzo e ogni pezzo diventa testo per conto suo, quei byte non vogliono
// dire niente né di qua né di là e diventano rombi di sostituzione. Il nome
// torna storpiato come prima, su Windows come su Linux, perché qui la shell
// non c'entra: c'entra dove cade la lettura. Succede su ogni comando che
// scrive un po' alla volta invece che in un colpo, cioè su una ricerca dentro
// una cartella grande: esattamente quello che Filo fa per trovare un file.

test('il nome non si rompe se l\'output del comando arriva in due pezzi', async () => {
  // I due byte della «à» (0xC3 0xA0) stampati in due momenti diversi: fra
  // l'uno e l'altro Filo legge, e si trova in mano mezzo carattere.
  const comando = process.platform === 'win32'
    ? '[Console]::Out.Write("RELAZIONE $([char]0x2014) attivit"); Start-Sleep -Milliseconds 500; '
      + '[Console]::Out.Write("$([char]0xE0) finale.txt`n")'
    : `printf 'RELAZIONE \\342\\200\\224 attivit\\303'; sleep 0.5; printf '\\240 finale.txt\\n'`;
  const out = await T.runCommand(comando, { cwd: TMP, timeoutMs: ATTESA });
  assert.ok(
    !out.stdout.includes('�'),
    `un carattere si è perso fra una lettura e l'altra: ${JSON.stringify(out.stdout)}`,
  );
  assert.ok(
    out.stdout.includes(NOME_DIFFICILE),
    `il nome è tornato storpiato.\nAtteso: ${NOME_DIFFICILE}\nRicevuto: ${JSON.stringify(out.stdout)}`,
  );
});

test('anche un messaggio di errore spezzato a metà carattere arriva intero', async () => {
  // Stessa causa, altra porta: gli errori dei comandi passano dalla stessa
  // lettura dell'output normale.
  const comando = process.platform === 'win32'
    ? '[Console]::Error.Write("citt"); Start-Sleep -Milliseconds 500; [Console]::Error.Write("$([char]0xE0) non trovata")'
    : `printf 'citt\\303' >&2; sleep 0.5; printf '\\240 non trovata\\n' >&2`;
  const out = await T.runCommand(comando, { cwd: TMP, timeoutMs: ATTESA });
  assert.ok(
    !out.stderr.includes('�'),
    `un carattere si è perso nel messaggio di errore: ${JSON.stringify(out.stderr)}`,
  );
  assert.ok(out.stderr.includes('città non trovata'), `errore storpiato: ${JSON.stringify(out.stderr)}`);
});

test('il taglio dell\'output enorme non lascia mezza emoji in fondo', async () => {
  // L'output oltre il tetto viene tagliato, e il taglio cade dove capita: se
  // cade fra le due metà di un'emoji, in fondo resta una metà che da sola non
  // è nessun carattere. Un carattere in meno è meglio di uno rotto.
  const riempimento = 'a'.repeat(T.MAX_OUTPUT_CHARS - 1);
  const comando = process.platform === 'win32'
    ? `[Console]::Out.Write("${riempimento}"); [Console]::Out.Write([char]::ConvertFromUtf32(0x1F4C4) + " finale")`
    : `printf '%s' '${riempimento}'; printf '\\360\\237\\223\\204 finale\\n'`;
  const out = await T.runCommand(comando, { cwd: TMP, timeoutMs: ATTESA });
  assert.equal(out.truncated, true, 'l\'output doveva essere tagliato');
  const mezzoCarattere = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.ok(
    !mezzoCarattere.test(out.stdout),
    `il taglio ha lasciato mezzo carattere: ${JSON.stringify(out.stdout.slice(-4))}`,
  );
});

// ── #551, terzo giro di verifica ────────────────────────────────────────────

test('il preludio di PowerShell cambia la tabella della console PRIMA di dire che si parla UTF-8', () => {
  // Due versi, una riga sola. `chcp` cambia la tabella della CONSOLE: è quella
  // che i programmi esterni usano per scrivere E per leggere. Senza, dire a
  // PowerShell «i programmi esterni parlano UTF-8» è una bugia (il programma
  // scrive ancora in OEM), e quello che l'utente digita nella casella di
  // risposta a un programma in corso gli arriva storpiato.
  const p = T.PRELUDI_CODIFICA.powershell;
  assert.ok(/chcp\s+65001/.test(p), 'il preludio non porta la console a UTF-8');
  assert.ok(
    p.indexOf('chcp') < p.indexOf('OutputEncoding'),
    'la tabella della console va cambiata prima di dichiarare la codifica dei programmi esterni',
  );
  // Deve poter fallire senza fermare il comando dell'utente, e senza stampare
  // la riga «Tabella codici attiva».
  assert.ok(/try \{ chcp 65001 > \$null \} catch \{\}/.test(p), 'chcp non è protetto o stampa');
});

test('un comando che stampa moltissimo non fa perdere cartella ed esito', async () => {
  // Il marcatore con cui la shell riporta cartella ed esito sta in CODA
  // all'output. Oltre il tetto di raccolta non arrivava più: il `cd` non
  // valeva per il comando dopo e un comando FALLITO risultava riuscito.
  // È lo scenario di ogni ricerca dentro una cartella grande, cioè quello che
  // Filo fa quando non sa ancora dove sta il file che gli hanno chiesto.
  const righe = Math.ceil((T.MAX_OUTPUT_CHARS * 3) / 15);
  const comando = process.platform === 'win32'
    ? `1..${righe} | ForEach-Object { "riga-di-elenco" }; cmd /c exit 3`
    : `for i in $(seq 1 ${righe}); do echo riga-di-elenco; done; exit 3`;
  const out = await T.runCommand(comando, { cwd: TMP, timeoutMs: ATTESA, trackCwd: true });
  assert.equal(out.truncated, true, 'l\'output doveva sfondare il tetto');
  assert.equal(out.code, 3, `l'esito del comando si è perso: ${out.code}`);
  assert.ok(out.cwd, 'la cartella riportata si è persa');
  assert.ok(
    !out.stdout.includes('__FILO_ONESHOT_CWD'),
    'il marcatore interno non deve mai comparire nell\'output mostrato',
  );
});

test('la cartella in cui il comando è finito torna anche con un output enorme', async () => {
  const sotto = join(TMP, 'sottocartella');
  try { rmSync(sotto, { recursive: true, force: true }); } catch (_) {}
  const righe = Math.ceil((T.MAX_OUTPUT_CHARS * 3) / 15);
  const comando = process.platform === 'win32'
    ? `mkdir "${sotto}" | Out-Null; Set-Location "${sotto}"; 1..${righe} | ForEach-Object { "riga-di-elenco" }`
    : `mkdir -p "${sotto}"; cd "${sotto}"; for i in $(seq 1 ${righe}); do echo riga-di-elenco; done`;
  const out = await T.runCommand(comando, { cwd: TMP, timeoutMs: ATTESA, trackCwd: true });
  assert.equal(out.cwd, sotto, `dopo un output lungo Filo crede di essere altrove: ${out.cwd}`);
});

// ── La cartella in cui il comando gira può essere sparita (#551, 4° giro) ────

test('se la cartella di prima non c\'è più, il comando gira lo stesso e lo dice', async () => {
  // L'utente rinomina la cartella dal gestore dei file, stacca la chiavetta, o
  // la cancella Filo perché gliel'ha chiesto. Avviare una shell lì dentro non
  // fa fallire il comando: fa fallire la SHELL prima di leggerlo, con un motivo
  // che parla del programma («spawn … ENOENT») e non della cartella.
  const sparita = join(TMP, 'cartella-che-sparisce');
  mkdirSync(sparita, { recursive: true });
  const prima = await T.runCommand('echo ciao', { cwd: sparita, trackCwd: true, timeoutMs: ATTESA });
  assert.ok(prima.stdout.includes('ciao'), 'il comando non gira nemmeno a cartella viva');
  rmSync(sparita, { recursive: true, force: true });

  const dopo = await T.runCommand('echo ciao', { cwd: sparita, trackCwd: true, timeoutMs: ATTESA });
  assert.ok(
    dopo.stdout.includes('ciao'),
    `il comando non gira più: ${JSON.stringify(dopo.stderr.slice(0, 120))}`,
  );
  assert.equal(dopo.cwdPersa, true, 'la cartella sparita non viene dichiarata a chi legge');
  assert.notEqual(dopo.cwd, sparita, 'Filo resta appuntato su una cartella che non esiste');
});

test('da una cartella sparita si può ancora andare altrove', async () => {
  // La via d'uscita ovvia. Se nemmeno questa passa, in quella scheda il
  // terminale è finito finché l'utente non la chiude, e nessuno glielo dice.
  const sparita = join(TMP, 'cartella-senza-uscita');
  mkdirSync(sparita, { recursive: true });
  rmSync(sparita, { recursive: true, force: true });
  const dove = process.platform === 'win32' ? `Set-Location "${TMP}"` : `cd "${TMP}"`;
  const out = await T.runCommand(dove, { cwd: sparita, trackCwd: true, timeoutMs: ATTESA });
  assert.equal(out.cwd, TMP, `non si riesce ad andarsene: ${out.cwd} (${out.stderr.slice(0, 120)})`);
});

test('l\'uscita di un comando non può scriversi la riga di servizio', async () => {
  // #551, ottavo giro di verifica. La riga con cui la sonda riporta cartella ed
  // esito la scrive Filo, ma arriva mescolata a quello che il comando ha
  // stampato — e quello lo scrive chi ha scritto il file letto, la pagina
  // scaricata, la risposta del servizio. Finché il segno che la distingue era
  // una costante scritta nel programma, e finché si guardava l'uscita capata
  // invece della coda tenuta per intero, bastava un file abbastanza lungo con
  // dentro quella riga: da lì in poi Filo credeva di essere in una cartella
  // scelta da un estraneo, ci faceva girare il comando dopo, la annunciava nel
  // popup di conferma, e un comando fallito risultava riuscito.
  const dir = join(TMP, 'riga-di-servizio');
  const altrove = join(dir, 'altrove');
  mkdirSync(altrove, { recursive: true });

  // Il marcatore non è più una costante: ogni comando ne ha uno suo.
  const uno = T.nuovoMarcatore();
  const due = T.nuovoMarcatore();
  assert.notEqual(uno, due, 'il marcatore è uguale a ogni comando: si fa scrivere da fuori');
  assert.ok(uno.startsWith(T.CWD_MARK_PREFIX), 'il prefisso serve alle guardie che lo cercano');

  // Il file scaricato, con dentro la vecchia riga di servizio e abbastanza
  // lungo da far cadere quella vera.
  const riga = 'riga di testo qualunque, scaricata da internet\n';
  const finto = `${T.CWD_MARK_PREFIX}8b9cb__:0:${altrove}\n`;
  const file = join(dir, 'scaricato.txt');
  writeFileSync(file, riga.repeat(200) + finto + riga.repeat(6000), 'utf8');

  const leggi = process.platform === 'win32' ? `Get-Content "${file}"` : `cat "${file}"`;
  const out = await T.runCommand(leggi, { cwd: dir, trackCwd: true, timeoutMs: ATTESA });
  assert.notEqual(out.cwd, altrove, 'la cartella la sceglie chi ha scritto il file');
  assert.equal(out.cwd, TMP_CANONICO(dir), `cartella riportata: ${out.cwd}`);

  // E un comando fallito resta fallito, per quanto stampi.
  const manca = join(dir, 'manca.txt');
  const fallisce = process.platform === 'win32'
    ? `Get-Content "${file}"; Get-Content "${manca}"`
    : `cat "${file}" "${manca}"`;
  const ko = await T.runCommand(fallisce, { cwd: dir, trackCwd: true, timeoutMs: ATTESA });
  assert.notEqual(ko.code, 0, 'un comando fallito viene riportato come riuscito');
  assert.notEqual(ko.cwd, altrove, 'e intanto si sposta dove dice il file');

  rmSync(dir, { recursive: true, force: true });
});

// ── #714: l'esito che arriva all'assistente è quello vero ───────────────────
// In PowerShell $LASTEXITCODE lo scrivono solo i programmi esterni: un cmdlet
// fallito lo lasciava a 0, e l'assistente leggeva «riuscito» un comando fallito.

const SU_WINDOWS = process.platform === 'win32';

test('un comando fallito risulta fallito, con la cartella tracciata come senza', async () => {
  const altrove = join(TMP, 'cartella-che-non-esiste');
  const casi = SU_WINDOWS
    ? [`Get-Content "${join(TMP, 'manca.txt')}"`, `Get-Content "${join(TMP, 'relazione — attività mancante.txt')}"`,
      `Set-Location "${altrove}"`]
    : [`cat "${join(TMP, 'manca.txt')}"`, `cat "${join(TMP, 'relazione — attività mancante.txt')}"`, `cd "${altrove}"`];
  for (const comando of casi) {
    const conSonda = await T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
    const senza = await T.runCommand(comando, { cwd: TMP, timeoutMs: ATTESA });
    assert.notEqual(conSonda.code, 0, `riportato come riuscito: ${comando}`);
    assert.equal(conSonda.code, senza.code, `la sonda cambia l'esito di: ${comando}`);
    assert.equal(conSonda.cwd, TMP, `dopo il fallimento Filo crede di essere altrove: ${conSonda.cwd}`);
  }
});

test('un errore che interrompe il comando lo fa risultare fallito, nella cartella raggiunta', async () => {
  // In sh non c'è un errore che salta il resto senza chiudere la shell: l'equivalente è un comando fallito in coda.
  const sotto = join(TMP, 'fermo-qui');
  mkdirSync(sotto, { recursive: true });
  const comando = SU_WINDOWS ? `Set-Location "${sotto}"; throw "fermo"` : `cd "${sotto}"; false`;
  const out = await T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
  assert.notEqual(out.code, 0, 'un comando interrotto da un errore risulta riuscito');
  assert.equal(out.cwd, sotto);
});

test('exit decide l\'esito anche con la cartella tracciata', async () => {
  // exit salta la riga della sonda che calcola l'esito: lì deve valere quello del processo, zero compreso.
  for (const [comando, atteso] of [['exit 3', 3], ['exit 0', 0]]) {
    const out = await T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
    assert.equal(out.code, atteso, `«${comando}» riportato con codice ${out.code}`);
  }
});

test('come in bash, conta l\'esito dell\'ultimo comando', async () => {
  const manca = join(TMP, 'manca-anche-questo.txt');
  const comando = SU_WINDOWS ? `Get-Content "${manca}"; Write-Output ok` : `cat "${manca}"; echo ok`;
  const out = await T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
  assert.equal(out.code, 0, 'l\'ultimo comando è riuscito');
  assert.equal(out.stdout.trim(), 'ok');
});

test('un commento in coda non impedisce al comando di girare', async () => {
  const comando = SU_WINDOWS ? 'Write-Output ciao # saluto' : 'echo ciao # saluto';
  const out = await T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
  assert.equal(out.stdout.trim(), 'ciao', `il comando non è girato: ${out.stderr.slice(0, 160)}`);
  assert.equal(out.code, 0);
  assert.equal(out.cwd, TMP);
});

test('nel terminale della dashboard un comando fallito risulta fallito', async () => {
  // Il comando accentato viaggia codificato (vedi sopra): il suo esito va preso dentro, non dopo.
  const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));
  const sessione = S.createSession({ shell: 'powershell', cwd: TMP });
  const esegui = (comando) => new Promise((risolvi, rifiuta) => {
    let uscita = '';
    const stop = setTimeout(() => rifiuta(new Error(`la shell non ha risposto: ${comando}`)), 30_000);
    sessione.exec(comando, {
      onData: ({ chunk, stream }) => { if (stream === 'stdout') uscita += chunk; },
      onExit: ({ code }) => { clearTimeout(stop); risolvi({ code, uscita }); },
      onError: ({ message }) => { clearTimeout(stop); rifiuta(new Error(message)); },
    });
  });
  const leggi = SU_WINDOWS ? 'Get-Content' : 'cat';
  const scrivi = SU_WINDOWS ? 'Write-Output' : 'echo';
  try {
    for (const nome of ['manca.txt', 'relazione — attività mancante.txt']) {
      const r = await esegui(`${leggi} "${join(TMP, nome)}"`);
      assert.notEqual(r.code, 0, `«${nome}» mancante risulta letto`);
    }
    const ok = await esegui(`${scrivi} "città"`);
    assert.equal(ok.code, 0, 'un comando accentato riuscito risulta fallito');
    assert.equal(ok.uscita.trim(), 'città');
  } finally {
    sessione.kill();
  }
});

// Con lo stderr rediretto PowerShell spegne $? a ogni riga che un programma scrive lì, anche se è riuscito:
// git lo fa a ogni checkout o push, e il modello scrive 2>&1 spesso. Conta il codice del programma.
test('un programma esterno riuscito che scrive su stderr resta riuscito anche con lo stderr rediretto', async () => {
  const node = SU_WINDOWS ? `& "${process.execPath}"` : `"${process.execPath}"`;
  const avvisa = `${node} -e "console.error('avviso')"`;
  const redirezioni = SU_WINDOWS ? ['2>&1', '2>$null', '*>&1', '2>&1 | Out-String'] : ['2>&1', '2>/dev/null'];
  const manca = SU_WINDOWS ? `Get-Content "${join(TMP, 'manca.txt')}"` : `cat "${join(TMP, 'manca.txt')}"`;
  const casi = [
    ...redirezioni.map((r) => [`${avvisa} ${r}`, 0]),
    [`${node} -e "console.error('avviso'); process.exit(4)" 2>&1`, 4],
    // Il segno dello stderr non deve coprire un comando fallito dopo di lui.
    [`${avvisa} 2>&1; ${manca}`, 'fallito'],
  ];
  const giusto = (code, atteso) => (atteso === 'fallito' ? code !== 0 : code === atteso);

  for (const [comando, atteso] of casi) {
    const out = await T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: ATTESA });
    assert.ok(giusto(out.code, atteso), `assistente, «${comando}»: codice ${out.code}, atteso ${atteso}`);
  }

  const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));
  const sessione = S.createSession({ shell: 'powershell', cwd: TMP });
  const esegui = (comando) => new Promise((risolvi, rifiuta) => {
    const stop = setTimeout(() => rifiuta(new Error(`la shell non ha risposto: ${comando}`)), 30_000);
    sessione.exec(comando, {
      onExit: ({ code }) => { clearTimeout(stop); risolvi(code); },
      onError: ({ message }) => { clearTimeout(stop); rifiuta(new Error(message)); },
    });
  });
  try {
    for (const [comando, atteso] of casi) {
      const code = await esegui(comando);
      assert.ok(giusto(code, atteso), `dashboard, «${comando}»: codice ${code}, atteso ${atteso}`);
    }
    if (SU_WINDOWS) {
      // Nella sessione restano gli errori dei comandi di prima: uno vecchio non decide l'esito di quello dopo.
      const zitto = await esegui(`${manca} -ErrorAction Ignore`);
      assert.notEqual(zitto, 0, 'un comando fallito in silenzio risulta riuscito per colpa di un errore vecchio');
    }
  } finally {
    sessione.kill();
  }
});

// La cartella com'è scritta nel sistema: la shell riporta la forma canonica.
function TMP_CANONICO(p) {
  try { return realpathSync.native(p); } catch (_) { return p; }
}
