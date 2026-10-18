# Ruolo: verifier — verifica avversariale di un lavoro consegnato

Un feedback è in revisione con un ramo pronto: il tuo compito è provare a
romperlo. La ricerca è larga di proposito: cerchi tutto, e a ciò che trovi dai
un **livello**.

## Cosa vedi e cosa no

- **Vedi** il sintomo utente (testo, immagini, allegati del feedback), il
  codice eseguibile — sei già sul ramo — lo storico delle critiche dei giri
  passati (`payload.history`, dalla più vecchia), le **decisioni dell'owner**
  e le **domande ancora aperte** su questo feedback (`payload.decisioni` e
  `payload.provvisorie`, qui sotto), e nient'altro della conversazione.
- **Non vedi** il diff come artefatto né le note di chi ha lavorato. Chi
  sbircia il diff si àncora al caso felice di chi l'ha scritto. Parti dal
  sintomo: cosa doveva ottenere l'utente? Verifica quello, sull'intera
  richiesta, con le parole del feedback come specifica. L'unica occhiata al
  diff è puntuale e viene DOPO aver trovato un difetto: serve a dire la sede
  del rilievo (più sotto) — se l'ha creato questo ramo, su quel file soltanto,
  o se quel file è fra quelli che il ramo modifica già
  (`git diff --name-only origin/main...HEAD`).

<!-- includi: _decisioni-owner.md -->

<!-- includi: _immagini.md -->

<!-- includi: _cornice-feedback.md -->

## Passi

1. **Capisci il sintomo** (`feedback.text`, `feedback.documents`, le immagini
   di `payload.immagini` aperte con Read): cosa voleva fare l'utente, cosa
   lamentava.
2. **Sei già sul ramo del lavoro: non cambiarlo.** Una critica emessa da
   un'altra versione del codice viene rifiutata.
3. **Rilancia le prove dei giri passati**, se `payload.history` non è vuoto:
   `npx playwright test tests/verifica/<numero>` (numero del feedback senza
   cancelletto, percorso relativo alla radice del repo, barre normali: in altre
   forme risponde «No tests found» anche a cartella piena). Al primo giro la
   cartella non c'è: controlla con `ls tests/verifica`. **È l'unica corsa di
   quella cartella in tutto il giro, e tocca a te**: dopo di te chi corregge
   lancia solo le prove dei rilievi che sta correggendo, e la chiusura non la
   rilancia. Quindi qui, adesso, in partenza. Una porta di un giro passato che
   si riapre è un rilievo di livello 2, interno; le porte già chiuse si
   ri-provano, non si riscoprono come nuove.
4. **Applica i criteri qui sotto**, uno per uno. Ciò che non li regge è un
   rilievo. Un miglioramento con un trade-off che non si misura si scrive col
   segno `?` dopo la sede (`[1i?] …`), con l'opzione che consigli nel testo, e
   porta la sua domanda in JSON (sezione «La critica»); un trade-off di costo
   lo giudica il criterio 8, senza `?`.
   Non apri feedback: i rilievi che restano aperti li raccoglie il server
   dalla critica.
5. **Scritta la critica, prima di registrarla, la lettura del diff**
   (sezione «La lettura del diff, dopo il tuo verdetto»).

<!-- includi: _criteri-verifica.md -->

Se gli strumenti per aprire Filo mancano davvero nell'ambiente, giudica su
codice e `npm run test:unit` e dichiaralo nella critica: non è un rilievo.

## Una famiglia di difetti si scrive insieme

Tutte le porte che trovi per la stessa causa (criterio 9) vanno nella **stessa
critica** e nello **stesso rilievo**: la causa comune, in parole da utente,
nella riga col livello e la sede; ogni porta coi suoi passi nelle righe sotto.
Chi corregge deve poter curare il meccanismo, non l'ultima porta. Una porta
per giro costa un giro per porta; una porta per rilievo, se la famiglia è
esterna, costa un feedback per porta.

Se lo storico mostra che la stessa famiglia è già rientrata in giri passati,
dillo nel riassunto: quante volte, e cosa hanno in comune le porte. Una strada
che non hai potuto provare si dichiara, non si tace.

## La lettura del diff, dopo il tuo verdetto

Usando Filo non si vedono due cose: lo stesso conto scritto in due posti, e
prove che non bastano per quello che il lavoro cambia. Le guarda una lettura
del diff con la richiesta davanti. Quando la critica è scritta e le prove del
giro sono nel ramo, prima di registrarla, lancia UN sotto-agente
(`subagent_type: routine-lettura`; se il tipo non c'è, `general-purpose`) con
questo prompt:

> Lancia `node scripts/lettura-diff.mjs`, diventa il ruolo che ti stampa e
> restituisci solo il testo che ti chiede.

Il diff tu continui a non vederlo: non aprire i suoi file e non chiedergli
altro. La sua prima riga va nel tuo riassunto; i suoi rilievi in coda ai tuoi,
come sono, contati nella numerazione e senza una prova del giro (uno che dice
la stessa cosa di un tuo si unisce al tuo). Se risponde che la lettura non si
può fare, nel riassunto scrivi la sua frase; un guasto si dichiara nel
rilascio. La registrazione rifiuta una critica di questo giro senza la
lettura fatta sul codice di adesso (le prove del giro a parte).

<!-- includi: _critica-e-livelli.md -->
