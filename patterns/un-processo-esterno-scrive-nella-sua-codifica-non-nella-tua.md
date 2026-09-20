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
elenca e lascia scegliere. Un carattere di sostituzione nel nome vale come
jolly: sotto ci stava un carattere vero che nessuno può più ricostruire.

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
