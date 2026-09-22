# La home e il filo

Specifica del ripensamento della home, decisa a parole con l'owner il
22/09/2026. È il riferimento per il mockup (`prove/home.html`) e per le fasi
di realizzazione. Le regole che ne nascono vanno poi nei pattern e nelle
sentinelle; questo file resta il racconto delle decisioni.

## Da dove si parte

La home di oggi ha tre zone: a sinistra i siti consigliati da un modello a
ogni nuova scheda, al centro un messaggio del modello e la chat, a destra
avvisi e timer. In alto ci sono le schede e nessuna barra di navigazione.
Quattro problemi:

1. Un comando in chat («tema scuro») lascia una conversazione con dentro solo
   quel comando e un «fatto».
2. I siti consigliati cambiano posto ogni volta, non si usano a memoria, e il
   modello non ha i dati d'uso per indovinare bene.
3. Indietro si raggiunge solo da tasto destro → «Altro…» e da Ctrl+Z; la mano
   va a sinistra in alto, dove non c'è niente (feedback #685 per Alt+freccia
   e tasti del mouse; #686 per lo zoom dalla chat).
4. Ora, batteria, rete, Bluetooth non si vedono da nessuna parte.

Sotto c'è una scelta ereditata dai chatbot: ogni scheda è una chat nuova, le
chat non si vedono fra loro, e un cambio fatto dall'interfaccia non lascia
traccia, così «rimetti come prima» non può funzionare.

## Il filo

Filo ha UN interlocutore e UNA linea del tempo. Non esistono più «chat»
separate: esiste il filo, che parte dal primo giorno e cresce in coda, su
tutti i dispositivi. È il motivo del nome: tiene il filo di tutto ciò che
l'utente fa.

### Il registro degli eventi

Il filo è un registro di eventi, ciascuno con ora, dispositivo d'origine e
identità. Tre famiglie:

- **Messaggi**: dell'utente e di Filo. Nel filo sono bolle.
- **Azioni**, chiunque le faccia. Chiesta in chat: un segno sulla bolla
  dell'utente (come la conferma di lettura delle app di messaggi); al
  passaggio del mouse dice cosa è cambiato e da lì si annulla. Fatta
  dall'interfaccia: una riga sottile nel filo («tema scuro, dalle
  impostazioni»), stessa forma, stesso annulla. Per il modello sono lo stesso
  evento. **L'evento nasce dove si scrive lo stato**, non in chi lo chiede:
  lo emette il salvataggio, così chat e pagine delle impostazioni non possono
  divergere e nessuno può dimenticarsi di registrare.
- **Navigazione**: le pagine visitate entrano ripiegate («14 pagine, fra cui
  YouTube: orche»), come le tracce dei passi intermedi già in chat. Il modello
  può cercarle. La cronologia come pagina a sé non serve più.

Vincoli del registro:

- Ha un archivio suo, che cresce solo in coda. Non sta nel file unico dove
  Filo salva tutto oggi (tetto di pochi megabyte), e non ha tetti né
  troncamenti: il registro grezzo di oggi (5000 voci, testi a 200 caratteri)
  è proprio il taglio silenzioso che le regole del repo vietano.
- Le chat di oggi diventano segmenti del filo: migrazione meccanica.
- La forma «si aggiunge soltanto» è quella che poi si sincronizza fra
  dispositivi senza conflitti, e quella che la cache dei prompt paga una
  volta sola. La sincronizzazione non è in questa spec; la forma dei dati sì.

### Il contesto del modello

- Gli ultimi eventi del filo, con le ore, fino al minore fra i due tetti
  qui sotto.
- Più i pezzi vecchi pertinenti, recuperati in automatico e messi IN CODA,
  prima della domanda, così non rompono il prefisso in cache.
- Più lo strumento di ricerca in corso d'opera, che esiste già e va esteso a
  tutto il filo (oggi cerca solo fra le chat chiuse).
- Niente «nuovo argomento»: il modello lo capisce da sé.

| Costante | Valore iniziale | Note |
|---|---|---|
| Tetto del contesto in token | 100 000 | il minore dei due vince |
| Tetto del contesto in giorni | 3 | quasi sempre è questo a vincere |

Numeri abbondanti apposta: sul modello di riferimento la cache costa
0,07 $ per milione di token in scrittura e 0,03 in lettura, qualche
centesimo in più coi tester non è un problema, e i modelli calano di prezzo.
Da bilanciare dopo, con le misure. Entrambi modificabili dall'owner nei
modelli predefiniti e dall'utente in Preferenze → Avanzate, come ogni
costante di questa spec. Avvertenza dalla misura del 21/09/2026: su alcuni
host la cache non scatta; un prefisso da 100k token senza cache si paga
intero a ogni turno, quindi la scelta dell'host va fatta insieme al tetto.

### Le memorie e le loro fonti

Le memorie (profilo, preferenze, lezioni, note per argomento) restano e sono
l'indice giusto del filo. Ogni nota ricorda da quali tratti del filo è nata.
L'archivio di oggi diventa il **quaderno delle memorie**: l'utente legge cosa
Filo ha capito, lo corregge, e con un clic salta al punto originale. Un'app
sola, niente ridondanza fra archivio e memorie.

### Filo parla per primo

Il messaggio che oggi il modello scrive nella home diventa un turno di Filo
nel filo. Cambia il quando: non a ogni scheda nuova, ma quando è successo
qualcosa (un timer, una mail, l'inizio della giornata). Due messaggi di fila
di Filo si fondono in uno, come già dice il pattern.

## La home

La home è la coda del filo. Tre zone, con una differenza di TEMPO fra
sinistra e destra:

- **Sinistra, quello che accade.** Carte che Filo spinge e che cambiano da
  sole: un timer che scade, un download, una mail con la risposta già pronta
  da approvare, una sveglia vicina, un lavoro lungo in corso. Ogni carta è
  una conversazione iniziata da Filo: cliccandola si apre nel filo, accanto.
- **Centro, il filo.** La coda della linea del tempo, non un foglio bianco:
  gli ultimi scambi, i segni dei giorni risalendo, il dispositivo d'origine
  quando non è questo. Si risale caricando a pezzi. Sotto, il campo di
  scrittura.
- **Destra, quello che tieni.** Carte stabili, scelte e disposte
  dall'utente: le app di Filo già aperte sul loro stato (l'editor coi file
  recenti, i mazzi coi mazzi; chi non ha ancora una carta resta un'icona in
  «altro»), le informazioni di sistema (ora, batteria, rete, Bluetooth), le
  impostazioni rapide, il profilo e le impostazioni in alto a destra, dove
  ogni app le mette. «Filo ti suggerisce» è UNA carta fra le altre, non la
  colonna intera.

Le carte hanno un contratto unico: titolo, stato, un'azione principale,
«apri nel filo». Si trascinano, si tolgono, si aggiungono. La fila di icone
fissa che oggi sta in alto nella home sparisce: le sue voci vanno nella
barra laterale.

## La barra laterale

Si apre dal bordo sinistro su ogni pagina, siti e pagine di Filo. Contiene
ciò che è GLOBALE, cioè della finestra e del sistema, non dell'elemento: è
la regola che la separa dal tasto destro, che resta contestuale. Indietro,
avanti, ricarica, home, incognito, schermo intero, chiudi scheda escono da
«Altro…» del tasto destro e vengono qui.

Tre gruppi, dall'alto:

1. **Navigazione e azioni rapide**: indietro, avanti, ricarica, home, più
   quello che l'utente ci trascina dal menu del tasto destro (schermata,
   incognito…). Stesso registro delle icone e stessa disposizione salvata
   del tasto destro, con una terza zona di destinazione. Altezza fissa.
2. **Le carte di sinistra, compatte**: un'icona con un segno di stato per
   ogni carta che accade. Si prende lo spazio che avanza.
3. **Le informazioni di sistema, compatte**: ora, batteria, rete, Bluetooth,
   e in fondo le impostazioni rapide. Altezza fissa.

Apertura: il cursore SPINGE contro il bordo, non lo sfiora, con una breve
attesa; una striscia sottile sempre visibile fa da indizio; la stessa barra
si apre da una scorciatoia e da una maniglia nella fila delle schede. Regge
contro le tre insidie note: aperture accidentali (chi va alla colonna di
sinistra di un sito o trascina una scheda), invisibilità per chi non sa che
c'è, trackpad che non arrivano al bordo. Il gesto dal bordo sinistro è lo
stesso del cassetto sul telefono.

## Il sistema

Due tempi. Prima LEGGERE: ora, batteria, stato di rete e Bluetooth, che si
leggono senza attriti. Poi COMANDARE: Bluetooth, volume, rete, con uno script
per piattaforma dalla via del terminale che Filo ha già, sapendo che il Mac
non si può provare e che alcuni comandi vogliono permessi. La barra in basso
del sistema resta per i programmi esterni, che nell'uso previsto di Filo si
aprono di rado e mai come unica via per un compito.

## Rimandato, con la ragione

- **Chat pura** (conversazioni isolate, modello scelto per ciascuna, più
  modelli affiancati): è un'app di Filo, non un modo della chat. Appuntata
  nel file delle idee; vincolo della politica sui modelli.
- **Recupero anticipato mentre l'utente scrive** (Jev, domande chiuse per
  nota candidata): utile, non bloccante. Quando si farà: interruttore spento
  di serie e riga nel documento sulla privacy, perché il testo esce dalla
  macchina prima dell'invio, anche quello poi cancellato; mai l'unica strada.
- **Programmi esterni come carta** (finestre aperte, riportare in primo
  piano): possibile, è la tangente.

## Il mockup

`prove/home.html`, un file solo, senza dipendenze, chiaro e scuro. Deve far
vedere:

1. La home con le tre zone e le carte dei due lati, coi contenuti d'esempio
   di questa spec.
2. La coda del filo: uno scambio di ieri sbiadito, il segno del giorno, un
   evento «dal telefono», una riga di azione dall'interfaccia, un comando con
   il segno sulla bolla, un messaggio spontaneo di Filo, una domanda con il
   blocco di attività a filo e nodi e la risposta.
3. La barra laterale che si apre spingendo sul bordo sinistro, coi tre
   gruppi, e la striscia d'indizio quando è chiusa.
4. Il trascinamento di un'icona dal menu del tasto destro alla barra.
5. Risalire il filo caricando a pezzi.

Il blocco di attività riprende le prove fatte in `prove/attesa.html` (ramo
`claude/attesa-filo`): il filo verticale coi nodi, il preset preferito, il
gomitolo a fine risposta. Le icone sono quelle di `icone-agente.html`.

## Fasi, in ordine

1. Il registro degli eventi con archivio suo, e gli eventi che nascono dove
   si scrive lo stato. Le chat di oggi diventano segmenti.
2. La home a carte, col contratto unico e i due lati.
3. La barra laterale.
4. Il contesto: i due tetti, il recupero automatico in coda, lo strumento di
   ricerca su tutto il filo.
5. Il quaderno delle memorie con le fonti.
6. Il sistema, prima leggere poi comandare.
