# La fine riga la decide il repo, non la macchina che clona

[← Tutti i pattern](../PATTERNS.md)

Un file di testo non arriva sul disco come sta in git. Git for Windows installa di
serie `core.autocrlf=true`, e la stessa impostazione ce l'hanno i contenitori
`windows-latest` di GitHub Actions — dove gira il cancello che pubblica le versioni di
Filo. Con quella impostazione ogni file di testo viene scritto nella copia di lavoro con
CRLF: i byte che il codice legge **non** sono quelli che qualcuno ha committato.

Su Linux e su Mac non succede mai. Ed è proprio questo il guaio: chi scrive la modifica
la prova dove il difetto non esiste, e il difetto lo scopre una macchina sola, giorni
dopo, quando ha già fermato qualcosa.

## I due danni, che sembrano scollegati

**Uno script che non parte, e non lo dice.** Gli hook di `.claude/hooks/*.sh` vengono
eseguiti da bash. Con le righe a CRLF bash legge `cd /percorso\r`, non trova quella
cartella, tira dritto e **esce 0**. Il salvataggio automatico — che è il trasporto del
lavoro, non solo il paracadute — smette di committare e di spedire senza che compaia un
errore da nessuna parte. È la forma peggiore di guasto: invisibile.

**Una sentinella che non riconosce più niente.** Per una regex `\r` è già un fine riga,
quindi `$` non ci arriva mai: qualunque controllo che legga un file del repo con una
regex ancorata a fine riga smette di trovare alcunché. È così che PATTERNS.md è risultato
«senza nessuna voce riconoscibile» e la pubblicazione si è fermata lì — due volte
(feedback #565 e #572).

## Perché correggere le regex non chiude niente

La prima volta la cura fu aggiungere `\r?` alla regex che si era rotta. Ha funzionato per
quella regex. Poi il cancello si è fermato di nuovo: su un checkout a CRLF le prove
rosse erano **24**, sparse fra gli hook, i controlli che leggono file del repo e gli
strumenti da riga di comando. Ogni nuova regex scritta su un file del repo riapre la
porta da sola, e nessuno se ne accorge finché non tocca a lei.

**Regola.** La fine riga si decide una volta per tutte in `.gitattributes`, con
`* text=auto eol=lf`. `eol=lf` vince su `core.autocrlf` qualunque cosa abbia configurato
chi clona, quindi la copia di lavoro nasce con gli stessi byte su tutte e tre le
piattaforme, e `text=auto` normalizza a LF anche ciò che viene committato da Windows. Gli
`.sh` si dichiarano anche per nome, perché lì un CRLF non è una sfumatura ma uno script
che non parte. Se un giorno servisse un file che pretende CRLF davvero — un `.bat`, un
`.cmd` — si aggiunge lui con `eol=crlf`, non si toglie la regola generale.

## La via d'uscita da chiudere: il NUL scritto grezzo

`text=auto` non tocca i file che git considera **binari**, e basta un byte NUL dentro un
sorgente per farlo considerare tale. Sei spec di Filo scrivevano il carattere NUL vero
dentro una stringa (casi di input avversariale: «byte nullo») invece dell'escape
`\u0000`. Quei file sparivano dai diff e restavano fuori dalla normalizzazione: la regola
generale c'era e su di loro non valeva. Un NUL in un sorgente si scrive sempre come
escape — è identico per JavaScript e lascia il file a essere testo.

## Una copia di lavoro che esiste già non si raddrizza da sola

`.gitattributes` decide come nasce un file **al checkout**. Su un clone nuovo quindi vale
subito; su una copia che c'era già prima, no: una fusione riscrive solo i file che
cambiano, e tutti gli altri restano com'erano. Chi tira dentro questa regola su una
cartella storta si ritrova gli hook storti come prima, e il salvataggio automatico fermo
senza dirlo.

Le due strade che vengono in mente per prime non funzionano, provate tutte e due:
`git checkout -- .` non riscrive un file che per git è già a posto, e
`git add --renormalize .` sistema l'indice, non il disco. Quella che funziona è svuotare
l'indice e ripristinare dai byte che stanno in git:

```bash
git rm --cached -r .   # toglie tutto dall'indice, non dal disco
git reset --hard       # ATTENZIONE: butta le modifiche non committate
```

In alternativa si riclona. Il controllo in `tests/unit/fineRigaLf.test.mjs` diventa rosso
proprio in questo caso, e il comando sta scritto nel messaggio del rosso: chi ci finisce
dentro non deve andarselo a cercare.

**Dove:** `.gitattributes` (la regola), test: `tests/unit/fineRigaLf.test.mjs` — verifica
che la regola ci sia, che nessun file di testo tracciato contenga un ritorno carrello,
che gli hook comincino con uno shebang pulito e che nessun sorgente porti un NUL grezzo.

**Come si riproduce senza avere Windows:** si clona il repo con
`git -c core.autocrlf=true clone …` (o si configura e si rifà il checkout) e si lanciano
gli unit test. Con la regola in piedi il checkout resta a LF e il conto è verde; senza,
le prove rosse tornano.
