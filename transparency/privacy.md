---
id: privacy
title: Privacy
subtitle: Cosa resta sul tuo computer, cosa esce, verso chi, e perché.
updated: 2026-10-04
order: 2
---

Filo legge molto: le pagine che visiti, quello che scrivi, le tue memorie, i file che gli chiedi di aprire, quello che stampa il terminale. Un programma così deve dire con precisione dove va a finire tutto questo. Questo documento lo fa, per intero, e descrive Filo com'è oggi: dove la realtà è peggio di come la vorrei, lo trovi scritto in fondo, fra i punti deboli. Se qui manca qualcosa che Filo fa, è un errore del documento, e puoi segnalarlo come qualunque altro difetto.

**In breve.** Quasi tutto resta sul tuo computer. Esce quello che serve a un modello per rispondere, quello che scegli di mandare tu (i feedback, cifrati) e i dati di servizio dei crediti, che non contengono testi. Alcuni servizi esterni ricevono pezzi della tua navigazione: il più importante è Google Safe Browsing, che oggi riceve l'indirizzo delle pagine che apri. Non uso servizi di analisi o di pubblicità. Il resto del documento è il dettaglio.

## Due regole

La prima: **per capire cosa non funziona non guardo quello che fai, leggo quello che mi scrivi.** Al server di Filo arriva quello che decidi di mandare tu, cioè i feedback (più le segnalazioni generiche che Filo manda da solo, descritte sotto), e quello che serve ai servizi che usi, cioè i crediti e il red team. La tua navigazione, le tue chat e i tuoi file non ci arrivano.

La seconda: **se qualcosa può stare sul tuo computer, sta sul tuo computer.** Le conversazioni, le memorie, gli appunti, le pagine salvate non hanno una copia da nessun'altra parte. Se cambi computer, te li porti con l'esportazione.

## Cosa resta sul tuo computer

Tutto quello che Filo sa di te vive nella sua cartella dei dati, dentro la tua cartella utente (su Windows sta in AppData, sotto Filo). Ci sono le impostazioni, le memorie che Filo si è fatto su di te, le chat, l'elenco delle richieste fatte ai modelli con domanda e risposta, gli appunti e i documenti dell'editor, le pagine salvate, le pagine visitate, le schede aperte e quelle archiviate, i download, la cronologia di quello che copi, i timer e le notifiche, un registro delle azioni recenti che Filo usa per ricordarsi cosa è successo, i costi mese per mese.

Questi file li legge in chiaro chi ha accesso al tuo computer, come qualunque documento tuo. Fanno eccezione le chiavi: quelle che scrivi nelle Opzioni, la chiave dei crediti e il tuo accesso Google, che Filo cifra con il portachiavi del sistema operativo. Se il portachiavi non c'è (succede su alcuni Linux), l'accesso Google e la chiave dei crediti non vengono salvati affatto, mentre le chiavi delle Opzioni restano in chiaro.

Dalle impostazioni di Sicurezza esporti tutto in un archivio .zip, e lo reimporti anche su un altro computer. Cancellare si può per parti: le pagine visitate anche tutte insieme, le chat una per una, le richieste ai modelli dalla Cronologia AI, le memorie dalle Preferenze. In una finestra in incognito Filo non salva le pagine visitate, le chat né le schede; quello che spendi lì invece resta nel conto del mese.

Filo non ha un sistema che segnala i crash da solo. Quello che contatta senza che tu glielo chieda, e quando, è scritto più sotto, nelle sezioni sul server e sugli altri servizi.

## I modelli

Filo funziona con modelli linguistici, e un modello risponde solo a quello che gli mostri. Il contenuto che esce dal tuo computer è quindi, prima di tutto, quello che serve alla funzione che stai usando:

- **Spiega e traduci.** Il testo selezionato e la frase intorno; per tradurre una pagina intera, il suo testo, a blocchi.
- **L'Aiuto sulla pagina.** Indirizzo e titolo della pagina, la sua struttura e uno screenshot della parte visibile, perché l'agente deve vedere dove cliccare.
- **La chat con Filo e la home.** La conversazione, le tue memorie, i riassunti dei documenti dell'editor, timer, notifiche, pagine salvate, le azioni recenti e i titoli delle schede aperte (fino a dodici, senza i loro indirizzi).
- **Il terminale e i documenti.** Quando Filo lancia un comando o legge un file per risponderti, quello che il comando stampa o il file contiene. Il terminale è acceso di serie: i comandi che leggono soltanto partono senza chiedere, e così la lettura dei documenti nella tua cartella utente. Fuori da lì Filo chiede un OK. Il terminale si spegne dalle Preferenze.
- **Le schede.** Per proporti quali archiviare, titolo, indirizzo e un estratto delle schede aperte. Quando una scheda finisce nell'archivio, il suo testo, per farne un riassunto e ritrovarla con la ricerca. Le pagine della rete di casa (router, stampanti, dischi di rete) restano fuori.
- **Correttore e riscrittura.** Il testo che stai scrivendo e il suo contesto. Il correttore è acceso di serie e guarda le aree di testo di ogni sito, mai i campi da una riga né le password.
- **L'editor.** Il documento, quando gli fai una domanda o quando Filo ne scrive titolo e riassunto.
- **Immagini, voce e lettura.** L'immagine da descrivere o trascrivere, l'audio della dettatura, il testo da leggere ad alta voce.
- **I siti pericolosi.** Solo dati sul sito: il nome, l'età del dominio, lo stato del certificato, se la pagina chiede password o pagamenti. Mai il contenuto della pagina.
- **I blocchi geografici.** Quando una pagina sembra bloccata per paese, il dominio, il titolo e poche righe della pagina d'errore.
- **I feedback.** Il testo che scrivi, per farne un titolo breve.

Niente di questo passa dal server di Filo, e lì non resta niente. La richiesta va dal tuo computer a OpenRouter, il modello risponde, la risposta torna a te e si salva sul tuo computer.

**Chi riceve questi dati.** Filo non parla direttamente con chi fa girare i modelli: passa da OpenRouter, un servizio che smista ogni richiesta verso uno degli host di quel modello. Ogni richiesta porta con sé la lista dei fornitori esclusi dalla politica sui modelli (la voce Modelli di questa pagina), quindi non arriva mai ai laboratori che quella politica esclude. Se per un modello non resta nessun host ammesso, la richiesta fallisce invece di ripiegare in silenzio. Per i modelli di Anthropic, OpenRouter può mandarla solo ad Anthropic.

A ogni risposta Filo registra chi l'ha servita davvero, e lo vedi nella Cronologia AI accanto a ogni richiesta. È la differenza tra una regola e una speranza.

**Cosa ne fanno.** OpenRouter dichiara che [di serie non conserva il testo delle richieste e delle risposte](https://openrouter.ai/docs/guides/privacy/logging), ma solo i dati di servizio: ora, modello, quanti token. Gli host che fanno girare i modelli hanno ciascuno le sue regole: oggi Filo tiene fuori i fornitori esclusi, ma non chiede ancora agli host di non conservare niente (lo trovi fra i punti deboli). Anthropic si impegna a [non addestrare i modelli sui dati che riceve dalla sua API](https://www.anthropic.com/legal/commercial-terms) e [li cancella entro 30 giorni](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), tranne quelli che i suoi controlli segnalano come violazioni delle regole d'uso, che tiene fino a due anni.

**Con che chiave.** I crediti di Filo sono una chiave OpenRouter creata solo per la tua installazione, con un tetto di spesa pari ai tuoi crediti. Le tue richieste vanno da Filo a OpenRouter con quella chiave e non passano dal mio server. OpenRouter vede il consumo della chiave; il nome della chiave è il tuo pseudonimo, un codice di sedici caratteri che non contiene il tuo nome né la tua email e che senza un segreto custodito sul server non si riconduce a te. Con una tua chiave OpenRouter, scritta nelle Opzioni, le richieste partono con quella, e consumo e regole di conservazione sono quelli del tuo account.

## Il server di Filo

Filo ha un server, su Firebase, cioè su infrastruttura Google (ne parlo più sotto). Il suo codice gira in Europa, nella regione europe-west1, in Belgio. Per chi usa l'app fa quattro cose: tiene la configurazione condivisa (quale modello usa ogni funzione), riceve i feedback, gestisce i crediti e ospita il red team.

All'avvio Filo si presenta al server con la sua identità anonima, legge la configurazione condivisa e lo stato dei suoi crediti; il primo giorno chiede anche se c'è un invito che lo aspetta. Queste richieste non contengono niente di tuo, oltre all'indirizzo IP che ogni richiesta in rete porta con sé.

## I feedback

Quando mandi un feedback, dall'app o accettando quello che Filo ti propone in chat, parte un documento con il testo, l'indirizzo e il titolo della pagina da cui l'hai mandato, browser e sistema operativo, un codice casuale dell'installazione, gli screenshot e i file che hai allegato, e un titolo breve scritto da un modello. Se hai i crediti c'è anche il tuo pseudonimo, che serve a darti il premio per la segnalazione. Lo screenshot, se lo alleghi, prende la pagina e la barra in alto di Filo, compresi i titoli delle schede: controlla l'anteprima prima di inviare.

Prima di lasciare il tuo computer vengono cifrati verso di me il testo, l'indirizzo della pagina, il codice dell'installazione e tutti gli allegati. Restano in chiaro il titolo della pagina, browser e sistema, il titolo breve, lo pseudonimo e un'impronta del codice dell'installazione, che serve a riconoscere i tuoi feedback senza decifrarli. Il documento non è pubblico: lo leggono il server, gli agenti che lavorano i feedback e io. La chiave per decifrare ce l'abbiamo solo noi, perché un feedback per lavorarlo bisogna leggerlo.

Il testo e gli screenshot passano da più modelli giudici, che decidono se il feedback è legittimo, spam o un tentativo di attacco. I giudici sono modelli diversi tra loro per costruzione (è una difesa, spiegata nel documento sulla sicurezza) e ricevono i tuoi dati con la stessa lista di fornitori esclusi delle chiamate dall'app. Poi il feedback arriva agli agenti che scrivono e controllano la correzione, e questi girano su Claude di Anthropic.

Sulla bacheca pubblica dentro l'app un feedback compare solo quando è chiuso, e solo con il titolo breve, il numero, le date, lo stato, la versione che l'ha risolto, i voti, il premio e la frase di risposta per chi l'ha segnalato. Quella frase è scritta per essere letta da chiunque.

Filo stesso, quando si accorge che non sa fare una cosa che gli chiedi o che qualcosa non ha funzionato, può mandare da solo una segnalazione generica: senza le tue parole e senza l'indirizzo della pagina, con un avviso che ti lascia annullarla. È acceso di serie e si spegne nelle impostazioni di Sicurezza.

Il feedback resta sul server senza scadenza: è la storia di come Filo è cambiato, e serve a chi arriva dopo. Se vuoi che un tuo feedback sparisca, scrivimelo e lo cancello a mano. Un feedback che i giudici classificano come attacco finisce anche in un archivio separato, che serve ad allenare i giudici del futuro.

## I crediti

Per usare i modelli con i crediti di Filo serve un invito. Quando lo usi, il server crea per la tua installazione una chiave OpenRouter con un tetto di spesa in dollari pari ai tuoi crediti, e tiene un documento con il tuo pseudonimo, l'impronta della chiave (non la chiave), il tetto, quanto hai consumato, i crediti che ti ho dato e quando, e il codice d'invito con cui sei entrato, cioè chi ti ha invitato. Il consumo il server lo legge da OpenRouter: non lo scrive il tuo computer. Nel documento non ci sono il tuo nome né la tua email.

Filo scrive anche un registro d'uso: una riga per ogni chiamata ai modelli fatta con quella chiave, con pseudonimo, data e ora, quale funzione l'ha fatta (chat, traduzione, correttore...), il modello, chi l'ha servito, i token e il costo. Il testo della richiesta e della risposta non c'è. Serve a due cose: sapere dove vanno i crediti, e confrontare ogni ora la somma delle righe col consumo che OpenRouter dichiara, così chi manomette il registro si vede. Se usi una tua chiave OpenRouter, il registro non si scrive: quel consumo è tuo.

Lo pseudonimo è stabile, lo stesso per sempre per la stessa installazione. Lo trovi nella pagina Crediti, e basta quello per ricevere un regalo di crediti. Non contiene il tuo nome, la tua email o il tuo account Google, e da lì non si risale a loro.

Per i crediti non serve il login: l'identità è quella dell'installazione, un account anonimo che Filo crea da solo. Se poi fai il login con Google, Filo collega l'account a quella stessa identità, così crediti e chiave restano tuoi; se il tuo account Google è già legato a un altro computer, le due identità restano separate.

**Gli inviti dal sito.** Se apri un link d'invito sul sito di Filo, il server salva il codice insieme a un'impronta del tuo indirizzo IP, mescolato con un segreto che sta solo sul server. Se entro un'ora Filo si apre per la prima volta dallo stesso indirizzo, l'invito si attiva da solo, senza bisogno di copiarlo. L'impronta si cancella quando l'invito viene usato, e comunque entro due giorni.

## Contatori e percorsi

Oggi Filo non manda al server contatori d'uso: quante volte usi una funzione, quanto aspetti una risposta, cosa rispondi alle conferme non escono dal tuo computer. È una raccolta che vorrei fare, con numeri senza contenuto e uno pseudonimo diverso da quello dei crediti, che cambia ogni mese: servirebbe a distinguere un utente che rifiuta tutto quello che Filo propone da cento utenti che rifiutano ogni tanto. Prima che parta, questo documento cambierà.

Lo stesso vale per i percorsi dell'Aiuto: Filo sa già ripulire e condividere i passi di una guida riuscita su un sito, perché chi lo visita dopo ne approfitti, ma la raccolta è spenta. I percorsi non escono dal tuo computer, e Filo non te lo chiede nemmeno.

## Il red team

Chi vuole può attaccare i giudici di Filo dall'app, con ricompense in crediti. Servono il login e un codice. Il testo dell'attacco arriva al server in chiaro e ci resta: è materiale scritto per ingannare un modello, e serve proprio a farlo leggere. Con il tuo account restano il nome in classifica, che scegli tu, i punteggi e i tentativi. Chi non partecipa non ha niente in questa parte. Per ora il red team è in pausa, e torna dopo il rilascio pubblico.

## Gli altri servizi

Oltre ai modelli e al server di Filo, alcune funzioni parlano con altri servizi. Ogni richiesta mostra a chi la riceve almeno il tuo indirizzo IP, come qualunque cosa fai in rete.

- **Google Safe Browsing.** Quando apri una pagina, oggi riceve il suo indirizzo completo: per ogni sito al più una volta ogni mezz'ora, perché le altre pagine usano la risposta già avuta. Le pagine della rete di casa restano fuori. Si spegne con la protezione dai siti pericolosi, nelle impostazioni di Sicurezza, che però si spegne tutta.
- **I registri dei domini e dei certificati** (rdap.org e crt.sh). Per i siti che mostrano già qualche segnale sospetto, ricevono il nome del sito, per sapere da quanto tempo esiste.
- **Tavily, o DuckDuckGo senza chiave.** Quando l'agente cerca sul web, ricevono la ricerca che l'agente ha formulato.
- **Il sito che stai visitando.** Quando apri l'Aiuto, Filo gli chiede le sue istruzioni per agenti (il file llms.txt), se ne ha.
- **Il sito di un link.** Quando chiedi cos'è un link, Filo gli chiede titolo e descrizione della pagina.
- **Il servizio di icone di Google.** Nella home, per mostrare l'icona dei siti che Filo ti suggerisce, riceve il nome di quei siti.
- **Google, come motore di ricerca.** Quando scrivi nella barra qualcosa che non è un indirizzo, la ricerca si apre sulla pagina dei risultati di Google.
- **GitHub, EasyList e Fanboy.** All'avvio GitHub riceve la richiesta della versione più recente; da questi tre Filo scarica anche le liste per bloccare la pubblicità e i banner dei cookie.
- **Cambi valuta e carte Magic** (Frankfurter e Scryfall). Per le funzioni corrispondenti, e non ricevono niente di tuo, salvo il nome della carta che cerchi.

Se trovi Filo che contatta qualcosa che non è in questa lista, è un errore di questo documento.

## Cosa non raccolgo

Detto in negativo, perché in negativo si controlla meglio. Sul mio server non arrivano:

- gli indirizzi delle pagine che visiti e i titoli delle schede, salvo quelli che metti in un feedback;
- il contenuto delle pagine, delle chat, delle memorie, degli appunti;
- screenshot, salvo quelli che alleghi a un feedback;
- dati sul dispositivo oltre a browser e sistema operativo, che arrivano solo dentro un feedback;
- niente da servizi di analisi o di pubblicità: Filo ne blocca, non ne usa.

Il tuo indirizzo IP il server lo vede passare, come ogni server, e il mio codice non lo conserva, salvo l'impronta degli inviti descritta sopra. I registri tecnici di Google Cloud, su cui il server gira, annotano le richieste e con loro l'indirizzo, per un tempo limitato. Se un giorno servisse conservarlo per fermare abusi, verrebbe conservato per un tempo dichiarato qui, e questo documento cambierebbe prima del codice.

## Il login

Non serve per usare Filo. Serve per votare i feedback sulla bacheca, per il red team e, se vuoi, per legare i crediti al tuo account Google oltre che all'installazione. L'accesso Google si apre nel browser; Filo riceve un codice di accesso e lo salva cifrato con il portachiavi del sistema. Il servizio di accesso di Firebase conserva l'email e il nome del tuo account Google, come qualunque servizio con «Accedi con Google». I dati di Filo sul server (crediti, feedback, red team) ti conoscono solo per un codice interno.

## Perché Google

La politica sui modelli esclude Google come produttore di modelli, e questo documento dice che il server di Filo sta su infrastruttura Google, che Safe Browsing è di Google e che le ricerche dalla barra vanno su Google. Vale la pena spiegarlo, prima che qualcuno lo chieda.

Sono due cose diverse. La politica sui modelli riguarda chi finanzio con l'inferenza, cioè il grosso della spesa e la parte che conta per il futuro di questa tecnologia. Firebase è un servizio di database e di accesso, Safe Browsing è la lista di siti pericolosi che usano quasi tutti i browser, compresi quelli che con Google non hanno niente a che fare. Resta vero che Google vede delle cose. Ospita i dati del server, dove i feedback arrivano cifrati e i crediti sono numeri legati a uno pseudonimo. E oggi Safe Browsing riceve gli indirizzi delle pagine che apri: questo è un punto debole, e va corretto. Il server su Google invece non è una scelta di principio: è la scelta di partenza di un progetto piccolo, e la rivedrò quando cambiare avrà un senso rispetto al costo.

## Conservazione

Quello che sta sul server non ha una scadenza automatica, con un'eccezione: l'impronta degli inviti aperti dal sito, che sparisce entro due giorni. I feedback, i documenti dei crediti, il registro d'uso e il red team restano finché esiste il servizio. Non lo nascondo dietro parole come «per il tempo necessario»: è per sempre, a meno che tu non chieda. Se chiedi, cancello a mano quello che è tuo: i feedback che hai mandato, il tuo documento dei crediti con il suo registro, il tuo account del red team.

## I punti deboli

1. **Safe Browsing riceve l'indirizzo completo delle pagine che apri.** Esiste un metodo che manda solo un frammento dell'impronta dell'indirizzo, quello che usano Chrome e Firefox, con cui Google non sa quale pagina stai visitando: Filo non lo usa ancora. Fino ad allora l'unico modo di evitarlo è spegnere la protezione dai siti pericolosi, e perderla.
2. **Gli host dei modelli possono conservare le richieste.** Filo tiene fuori i fornitori esclusi, ma non chiede ancora la ritenzione zero, cioè di accettare solo host che dichiarano di non conservare niente. Oggi valgono le regole di ciascun host.
3. **OpenRouter vede tutto quello che passa**, prima di smistarlo. Si impegna a non conservare i contenuti, ma è un passaggio in più, e quella regola la posso leggere, non verificare.
4. **Non tutto il feedback è cifrato.** Il titolo della pagina da cui scrivi, browser e sistema, il titolo breve e lo pseudonimo restano in chiaro sul server. Il documento non è pubblico, ma chi accede al database li legge senza chiave.
5. **L'archivio degli attacchi è in chiaro.** Quando un feedback viene classificato come attacco, il suo testo viene copiato in un archivio a parte già decifrato. Lo legge solo chi amministra il server, ma senza bisogno della chiave.
6. **Il server può leggere i feedback.** La cifratura protegge da chi accede al database senza la chiave, non da me né da un errore nel codice del server che gira con la chiave. È il compromesso che permette di far lavorare i feedback a degli agenti.
7. **Lo screenshot del feedback prende anche la barra in alto**, con i titoli delle schede aperte. Lo leggono i giudici e gli agenti. L'anteprima serve a questo.
8. **Il codice del server non è pubblico.** Il codice dell'app è aperto e quello che dico di lei lo puoi controllare. Il server contiene anche le difese contro gli attacchi e per ora resta chiuso: quello che dico del server va preso sulla parola.
9. **I file sul tuo computer sono in chiaro.** Chi ha accesso al tuo computer legge le tue conversazioni con Filo come legge i tuoi documenti. La cifratura del disco è compito del sistema operativo, non di Filo.

## Se stai forkando Filo

Puoi mandare i dati dove vuoi: è il senso dell'open source. Ti chiedo di mantenere le due regole in testa a questo documento e di riscrivere questo testo perché dica la verità sul tuo fork. Un documento sulla privacy che descrive un altro programma è peggio di nessun documento.

---

Scritto da Sathya con Claude, che di questi dati è il principale destinatario.
