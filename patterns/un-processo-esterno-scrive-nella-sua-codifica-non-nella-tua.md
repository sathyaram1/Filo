# Un processo esterno scrive nella sua codifica, non nella tua

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Quando Filo avvia un programma e ne legge l'uscita, la codifica
si concorda PRIMA che il programma scriva — con un preludio che gliela impone —
e poi si legge con quella. A valle non c'è niente da riparare: un carattere
perso non torna. E il testo che quell'uscita produce (un nome di file, un
percorso) va trattato come «quasi giusto», non come vangelo: chi lo riceve
tollera la svista invece di rimbalzarla all'utente.

## Il caso

Feedback #551, visto dal vivo. L'utente chiede a Filo di leggere un file. Filo
lo cerca col terminale e ottiene due nomi:

```
SPECIFICHE SEO E METADATI - singolarita.txt
SPECIFICHE TIPOGRAFICHE - Singolarit<27>.txt
```

Poi chiede di leggere il primo, e il lettore di documenti risponde onestamente
che a quel percorso non c'è nessun file. Il file esiste: si chiama
`SPECIFICHE SEO E METADATI — singolarita.txt`, con il trattino **lungo**.

Su Windows PowerShell non scrive in UTF-8: scrive nella tabella OEM del sistema
(cp850 dalle nostre parti). Il trattino lungo lì non esiste e diventa `-`; la
`à` diventa un byte che in UTF-8 non vale niente e arriva come carattere di
sostituzione. Noi leggiamo lo stdout come UTF-8 — ed è giusto così. Risultato:
il modello legge nomi sbagliati, li ricopia nel passo dopo, e ogni lettura
successiva fallisce in modo impeccabile su un nome mai esistito.

Riguarda qualunque nome con accenti o segni tipografici: quasi tutti i file di
un utente italiano.

## La diagnosi che sembrava giusta e non lo era

Filo aveva proposto una segnalazione: «bug di risoluzione del percorso nel
lettore di documenti». Era il sintomo. La tilde, gli spazi e i percorsi lunghi
il lettore li gestiva benissimo; il nome che gli arrivava era già rotto tre
passi prima. Il segnale che avrebbe dovuto insospettire: `-` al posto di `—` e
un carattere di sostituzione nello stesso elenco — due sintomi diversi della
stessa tabella di codici, non due bug.

## Le due cure, ed entrambe servono

**A monte.** Il preludio vive in `src/main/services/terminal.js`
(`PRELUDI_CODIFICA`) e viene anteposto a ogni comando, prima ancora della sonda
che riporta la cartella corrente. Per PowerShell sono due codifiche e servono
tutte e due: `[Console]::OutputEncoding` (con cosa la console scrive su stdout)
e `$OutputEncoding` (con cosa PowerShell passa testo a un programma esterno).
Per `cmd` è `chcp 65001`, con l'uscita soppressa perché stampa una riga. Per
bash e sh non serve niente. La shell persistente della modalità terminale
(`src/main/services/shell.js`) prende le stesse stringhe da lì: è lo stesso
guasto su un cammino equivalente, e due copie divergono.

**A valle.** `src/main/services/documentRead.js` non si arrende al primo
`stat` fallito: cerca nella cartella un nome che combaci a meno di maiuscole,
accenti, tipo di trattino e spazi doppi, segmento per segmento (la storpiatura
non risparmia i nomi delle cartelle). Se il candidato è **uno solo** apre
quello e DICE quale file ha aperto davvero; se sono due o più non indovina, li
elenca e lascia scegliere. Un carattere perso nel nome vale come jolly, perché
sotto ci stava un carattere vero che nessuno può ricostruire: il rombo di
sostituzione, e anche il `?` che Windows scrive da sé quando nella tabella un
carattere non ha proprio dove andare (su Windows un nome di file non può
contenerlo, quindi lì un `?` è sempre un carattere perso).

**Il jolly vale UN carattere, non un pezzo di nome.** Con «uno o più caratteri
qualsiasi» bastava perdere la `o` di `Bilancio` per farsi aprire `Bilancio 2019
definitivo riservato`; e il controllo che pretende «del nome vero sotto i
jolly» va fatto sul nome SENZA estensione, altrimenti `.txt` da sola gli basta
e un nome sparito del tutto apre l'unico file di testo della cartella. Trovati
al primo giro di verifica di #551.

## La codifica giusta non basta: conta anche DOVE cade la lettura

Il preludio chiude il guasto dentro la shell. Fra la shell e Filo ne resta un
altro, e non ha niente a che fare con Windows: l'output di un processo non
arriva in un pezzo solo. Arriva man mano, e ogni pezzo finisce dove capita.
Una `à` occupa due byte, un'emoji quattro: se la lettura cade nel mezzo e ogni
pezzo viene trasformato in testo per conto suo, quei byte non vogliono dire
niente né di qua né di là e diventano rombi di sostituzione. Il nome torna
storpiato esattamente come prima del preludio, su ogni sistema.

Non è un caso di laboratorio: capita su ogni comando che scrive un po' alla
volta invece che in un colpo, cioè su una ricerca dentro una cartella grande —
proprio quello che Filo fa quando non sa ancora dove sta il file che gli hanno
chiesto. E da lì non si torna indietro: il perdono sui nomi quasi giusti vale
per la lettura di un documento, non per la shell, quindi il comando dopo cerca
un nome che non esiste.

**Regola: un flusso che porta testo si dichiara `setEncoding('utf8')`, mai
`chunk.toString()` pezzo per pezzo.** `setEncoding` mette davanti allo stream
il decodificatore che tiene da parte i byte di un carattere ancora incompleto e
li riattacca al pezzo dopo. La shell persistente del terminale della dashboard
lo faceva da sempre e infatti non ha mai avuto questo guasto; i comandi
one-shot dell'assistente no, ed era l'unica differenza fra due strade che
l'utente vede come la stessa cosa. Trovato al secondo giro di verifica di #551.

Stessa famiglia, un passo più in là: anche **tagliare** un testo lo può
rompere. Il tetto sull'output si conta in unità di testo, e un'emoji ne occupa
due: tagliare a numero tondo lascia in fondo una metà di coppia, che da sola
non è nessun carattere. Se l'ultima unità è la prima metà di una coppia, si
lascia fuori tutta la coppia.

## Vale anche nel verso opposto: quello che TU scrivi al processo

Il preludio sistema la codifica in scrittura. In lettura no, e il guasto è
identico: Windows PowerShell decodifica il suo stdin con la tabella della
console, mentre Node gli scrive UTF-8. Il terminale della dashboard manda i
comandi per lo stdin, quindi un comando che l'utente digita con un accento
dentro arrivava storpiato e la shell rispondeva che il file non esiste. Con
`cmd` non succede: `chcp 65001` vale in tutti e due i versi.

`[Console]::InputEncoding` qui è peggio del male: il setter di .NET butta via
il lettore dello stdin insieme a tutto quello che aveva già letto in avanti, e
la riga di «pronto» parte nello stesso pezzo del preludio. La sessione
resterebbe muta per sempre. La cura è **non far viaggiare caratteri non ASCII
sul filo**: il comando parte codificato e lo rimette insieme PowerShell, che
non passa da nessuna tabella. Solo quando serve, però: un comando di soli
caratteri ASCII parte identico, così `exit`, `cd` e le variabili continuano a
comportarsi come si sono sempre comportati.

La seconda cura non è un cerotto sulla prima. La stessa svista la fa un utente
che il nome lo scrive a mano, o a cui il nome è stato dettato al telefono, e la
filosofia di Filo è esplicita: un typo ogni tre parole non deve essere un
problema.

## Come si verifica senza avere la macchina sotto mano

Su Linux `resolveShell` risolve tutto in `sh`: i rami di Windows da lì non
girano mai. Quindi le stringhe del preludio si controllano come costanti, su
ogni piattaforma, e l'ordine (preludio PRIMA del comando) si controlla sul
codice — `tests/unit/terminaleCodifica.test.mjs`. Il giro vero —
creare un file con un trattino lungo e una `à`, elencarlo con la shell della
piattaforma, pretendere il nome identico — gira ovunque: `Get-ChildItem` su
Windows, `ls` altrove.

## Anche un FILE dichiara la sua codifica

Stessa regola, dall'altra parte del disco. Un file di testo non è «UTF-8 finché
non si dimostra il contrario»: la codifica la dichiara lui, nei primi byte, e su
Windows quella a due byte per carattere sta dappertutto — Windows PowerShell 5.1
la usa per ogni file prodotto mandando l'uscita di un comando in un file (cioè
per i file che Filo stesso crea col terminale), e il Blocco note la offre come
«Unicode». Letto come UTF-8 un file così diventa una fila di caratteri vuoti
alternati alle lettere: non un errore, un testo. Il lettore dichiara di aver
letto, il modello riceve spazzatura e risponde sul nulla. Si guarda la firma in
testa prima di decidere (`bomDueByte` in `src/main/services/documentRead.js`), e
un file pieno di byte nulli che quella firma ce l'ha non è binario.

## E la codifica «senza firma» di Windows tocca proprio i segni tipografici

Un file salvato come «ANSI» (il Blocco note fino a ieri, Excel che esporta un
CSV) non dichiara niente in testa. Se letto come UTF-8 fallisce e si ripiega,
il ripiego non può essere latin1: le due tabelle coincidono ovunque tranne in
una fascia di 32 caratteri, ed è ESATTAMENTE dove Windows tiene i segni
tipografici — trattino lungo e medio, virgolette e apostrofi curvi, euro,
puntini di sospensione. Con latin1 gli accenti tornano giusti e quei segni
diventano caratteri di controllo invisibili: non resta nemmeno un rombo a dire
che manca qualcosa. «12 €» arriva al modello come «12 », e la risposta è su un
testo bucato. La tabella di 32 voci sta in `daCp1252`
(`src/main/services/documentRead.js`).

## «Quanti rombi?» è la domanda sbagliata: «sono validi?» è quella giusta

Per scegliere fra UTF-8 e la tabella di Windows si contavano i rombi che
venivano fuori leggendo come UTF-8, e si ripiegava sopra uno ogni mille
caratteri. Una percentuale è una soglia, e una soglia sbaglia in tutte e due le
direzioni:

- **sotto soglia**, un documento salvato in ANSI con pochi segni speciali
  rispetto alla sua lunghezza resta letto come UTF-8 e li perde tutti. Non è un
  caso di laboratorio: è la specifica tecnica quasi tutta in caratteri semplici
  col titolo accentato, ed è il CSV che il foglio di calcolo esporta, righe di
  numeri e tre voci con l'euro e l'accento. La cura scritta per i file corti
  passava le prove e non copriva i file veri;
- **sopra soglia**, un documento scritto BENE in UTF-8 che contiene davvero
  qualche rombo — gli appunti in cui l'utente ha ricopiato i nomi storpiati che
  il terminale gli mostrava, un registro di errori — viene riletto tutto con la
  tabella di Windows, e allora si storpiano gli accenti che erano giusti.

«Questi byte sono UTF-8 valido?» ha una risposta esatta e nessuna soglia da
tarare (`eUtf8Valido`, cioè un `TextDecoder` in modalità severa). Stessa cosa
per il testo a due byte senza firma in testa: la firma è una cortesia, ma la
forma resta riconoscibile — metà dei byte nulli, tutti dalla stessa parte delle
coppie, cosa che un testo normale non ha mai (`pareDueByte`).

## Un jolly in un'espressione regolare si paga a raddoppi

Il confronto «questi due nomi sono lo stesso nome a meno delle sviste» girava
come un'espressione regolare con un jolly per ogni carattere perso. Corretta,
ma il suo tempo RADDOPPIA a ogni jolly in più: ventidue caratteri persi un
decimo di secondo, ventotto otto secondi, trenta trentaquattro — per UN file,
che la cartella moltiplica. Il conto gira nel processo principale, che è uno
solo: mentre gira, Filo non risponde a nient'altro.

Il punto non è il caso limite: è **chi sceglie l'input**. Quel nome lo ricopia
il modello da quello che il terminale gli ha stampato o da un documento che sta
leggendo, cioè da fuori — e chi scrive quel testo decide per quanto tempo Filo
resta fermo. Su input che arriva da fuori un'espressione regolare con dei jolly
non si scrive: si avanza per posizioni possibili, che sono al massimo quante
sono le lettere del nome, e il costo torna a crescere con la lunghezza invece
che con i buchi (`combaciaSezionato`).
