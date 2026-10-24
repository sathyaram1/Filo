# La home è la coda del filo

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Il centro della home non è un foglio bianco con un messaggio: è la coda della linea del tempo (#869). Gli
ultimi scambi di tutte le schede, i cambi fatti fuori dalla chat come righe sottili, le pagine visitate ripiegate fra un
evento e l'altro, i segni dei giorni e i giorni prima sbiaditi. Aprire una scheda o tornare alla home non apre e non
chiude una chat. Filo scrive di sua iniziativa solo quando è successo qualcosa, mai all'apertura di una scheda.

## Perché

- Un comando in chat lasciava una conversazione con dentro solo quel comando, ogni scheda era una chat nuova, e il
  messaggio della home costava una chiamata al modello quasi a ogni scheda (la sua firma cambiava con le schede aperte,
  la fascia del giorno, i timer).
- Il modello ha già davanti il filo di tutte le schede ([Il contesto è la coda del filo](il-contesto-e-la-coda-del-filo-e-il-prefisso-non-si-muove.md)):
  lo schermo deve mostrare la stessa cosa che il modello legge.

## Come è fatto

- **Quali righe, in che ordine, a pezzi**: `src/shared/filoCoda.js`, logica pura. Il main la serve con
  `src/main/services/codaFilo.js` (`FILO_CODA`), che rifà le righe solo quando il filo o i cambi cambiano: con decine
  di migliaia di eventi la home si apre senza attesa. Due righe con la stessa ora non finiscono in due pezzi.
- **Le pagine visitate**: un gruppo per ogni tratto fra due eventi, mai a cavallo di due giorni; il nome è l'ultima
  pagina con un titolo vero. Titoli e indirizzi li scrivono i siti: si mostrano come testo, si riaprono solo se sono
  `http(s)`, e si tolgono **per id** (`FILO_CODA_TOGLI_PAGINE`): l'ora e il sito della cancellazione li prende il main
  dalla pagina che il filo ha, mai dalla scheda che chiede. Una pagina cancellata (da qui, dalla Sicurezza, dalla chat) se ne va anche
  dalle schede chiuse, che la ricerca legge, e una scheda ancora aperta su quella pagina non ci rientra chiudendosi.
  Dalla ricerca, dove una pagina è un indirizzo, si tolgono tutte le sue visite. Al contrario, una scheda chiusa
  eliminata dalla Cronologia (una, scelte dalla chat, o «Svuota archivio») porta via le visite del suo indirizzo mentre
  era aperta. Ogni pagina che entra nel filo, cambia titolo o se ne va passa da un punto solo, la scrittura del filo,
  che lo annuncia (`FILO_PAGINE_CAMBIATE`): le home aperte rifanno le righe delle pagine su quelle che il filo ha
  adesso. Non basta rileggere quando la home torna davanti: una visita si scrive a pagina caricata, spesso con la home
  già davanti (#1307.4). Un gruppo si chiama come la sua prima pagina, quindi tolta quella la riga prende il nome nuovo
  invece di doppiarsi.
- **I cambi**: quelli chiesti in chat hanno il segno sulla bolla; tutti gli altri sono una riga col loro «annulla».
  Le righe sottili (cambi, pagine) di fila stanno strette come le righe di un registro; lo spazio pieno resta intorno
  alle bolle. Ritocchi ripetuti della stessa cosa sono una riga sola (#1490): il registro li fonde, la home riscrive la
  riga che ha già e la toglie se si è tornati com'era.
- **La conversazione che una scheda continua** (`chatCorrente`): l'ultima della home se non è passata un'ora di
  silenzio, o se l'ultima parola è di Filo che ha scritto da sé. L'accoglienza, le chat delle altre app e quella che
  l'utente ha chiuso apposta (il bottone sotto la risposta, `/clear`: il segno `fine` sulla chiusura) non si
  continuano da qui; una scheda che si chiude o si ricarica non è una chiusura voluta. La scheda la adotta (storico per il turno dopo), ma le bolle le ha già disegnate la coda.
- **All'apertura l'ultimo messaggio sta in cima** (#1487), col segno del suo giorno, e sotto è vuoto: chi apre una home
  non vuole rivedere ieri, che resta sopra a una rotella. Vale per la scheda nuova, la home ricaricata e la riserva alla
  consegna. Il vuoto è un margine in fondo al filo misurato apposta, così «in fondo» vuol dire proprio quel punto e
  tutto il codice che segue il fondo continua a funzionare; quello che arriva dopo lo consuma, e uno scambio che riempie
  lo schermo torna a seguire il fondo. Finché l'utente non scorre e non scrive, un messaggio che Filo scrive da sé
  (il saluto della giornata) prende la cima.
- **Le righe che arrivano dopo** (`allinea`): i messaggi della conversazione di questa scheda li ha già disegnati il
  turno; tornano solo quando la scheda era nascosta e li ha scritti un'altra. Il resto entra al suo posto nel tempo.
- **Filo parla per primo** (`src/main/services/filoParla.js`): timer e sveglie che suonano, download finiti, avvisi,
  la prima apertura della giornata (dopo le cinque, se oggi nella home non si è detto niente), la fine
  dell'accoglienza. Eventi vicini fanno un giro solo. Il suo turno va nella conversazione che una scheda nuova
  continuerebbe; **due suoi messaggi sono uno solo se vicini** (mezz'ora, stesso giorno) **e senza niente in mezzo nel
  filo** (una pagina, un cambio, un messaggio altrove): il secondo riscrive il primo con tutto quello che è successo e
  ne prende il posto, quindi oltre quei limiti è un messaggio nuovo in fondo. Lo decide chi scrive (`siFonde`), il
  messaggio porta il segno `fonde` e la piegatura del filo ubbidisce solo a quello (su disco restano tutti e due).
- **Le parti scritte da altri** (nome di un file, testo di un avviso, nome di una sveglia messa da un modello) entrano
  nel prompt imbustate come testi salvati, e il messaggio che ne nasce si salva con `esterno`: riletto, è una lettura,
  mai parola di Filo (#592.4).
- **Senza un modello** la home non chiama niente: la frase che dice perché, con la strada ai Crediti, sta in fondo al
  filo finché un modello non arriva.

## Cosa non fare

- Non far ripartire il modello all'apertura di una scheda, nemmeno «solo se la firma è cambiata»: è il costo che questo
  pattern toglie. I suggerimenti si rifanno con le cose successe o con «Aggiorna».
- Non disegnare una riga del filo con markup arrivato dal filo: le risposte di Filo passano dal markdown che escapa,
  tutto il resto è testo.

Sentinella: `tests/unit/filoCoda.test.mjs`. Prove dell'app: `tests/home-coda-del-filo.spec.mjs`, `tests/home-ultimo-messaggio-in-cima.spec.mjs`.
