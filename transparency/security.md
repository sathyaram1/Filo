---
id: security
title: Sicurezza
subtitle: Come cerco i problemi, cosa succede quando li trovo, e i limiti di tutto questo.
updated: 2026-10-04
order: 3
---

Filo è un caso strano per la sicurezza, per due motivi:

1. è un programma che cambia da solo, guidato dalle richieste degli utenti: il suo codice lo scrivono interamente agenti AI (quasi solo Claude);
2. Filo stesso usa agenti AI che possono agire sul tuo computer.

A questi due problemi, che quasi nessun altro software ha, si sommano quelli classici (per esempio un difetto che permette di rubare dati), e una domanda che vale per qualunque programma scaricato: il file che hai installato viene davvero dal codice che dico? Il documento risponde nell'ordine.

## Un programma che si riscrive da solo

Il percorso è questo: un utente scrive un feedback dall'app, un agente lo lavora e produce una modifica al codice, la modifica viene pubblicata e arriva a tutti con l'aggiornamento automatico. È il cuore di Filo, ed è anche il suo rischio più particolare: il feedback è testo scritto da uno sconosciuto, e un testo costruito apposta potrebbe provare a ingannare l'agente e fargli scrivere codice dannoso. Se ci riuscisse, il danno non sarebbe su un computer: sarebbe su tutti.

**Com'è oggi.** Dalla correzione in poi il giro va da solo: una modifica che supera tutti i controlli viene fusa nel codice dal server, e ogni sei ore l'ultima versione che ha passato la suite completa dei test diventa un aggiornamento per tutti. All'ingresso invece decido io. Per ogni tipo di mittente (gli utenti, Filo stesso quando segnala un suo limite, i miei agenti, io) c'è un interruttore che dice se un feedback giudicato sicuro può entrare in lavorazione da solo o deve aspettare un mio OK. Sopra a tutti c'è un interruttore generale, che è anche il freno d'emergenza: spento, nessun feedback entra in lavorazione senza di me. Li accendo per gradi, man mano che il sistema dimostra di reggere.

La difesa non è un muro solo: sono cinque livelli, e funzionano come le difese di un organismo. Nessuno, da solo, è infallibile; è l'insieme a rendere difficile l'infezione, perché ogni strato ha una natura diversa e ciò che supera uno strato si ferma su un altro.

1. **Il filtro all'ingresso** (senza AI, sul server). Prima che un modello legga il feedback, un filtro deterministico guarda mittente e comportamento: gli account e i testi con i segni tipici di un inganno vengono fermati e messi in attesa di revisione umana, i comportamenti da spam rallentati. Un attacco ben fatto, da un account con una storia pulita, qui può passare: questo livello non ferma il colpo singolo, impedisce i cento tentativi e l'intasamento. È la pelle: non blocca tutto, ma costringe tutto a passare da pochi ingressi sorvegliati.
2. **I giudici.** Più modelli, scelti apposta diversi tra loro, leggono il feedback e lo classificano: attacco, spam, fuori linea col design di Filo, o richiesta legittima. Vale il verdetto più severo del gruppo: per passare bisogna ingannarli tutti insieme. Chi viene classificato come attaccante resta fuori.
3. **L'agente può rifiutare.** Chi scrive il codice non è obbligato a eseguire: ha l'istruzione esplicita di fermarsi e segnalare se un compito, anche a lavoro iniziato, si rivela rischioso, insensato o sospetto.
4. **La verifica cieca.** Un'istanza separata esamina la modifica senza mai vedere il feedback che l'ha originata: giudica il codice in sé. Anche se esistesse una parola magica capace di prendere il controllo di qualunque modello, questo controllo non la leggerebbe mai.
5. **Il pavimento deterministico.** Controlli senza AI sul codice prodotto, che le parole non possono aggirare: una modifica alle aree critiche si ferma e aspetta una revisione umana, salvo le due strade che racconto qui sotto. Per esempio l'aggiornamento automatico, il login, la gestione delle chiavi, le protezioni, l'aggiunta di librerie o di servizi esterni. Sono tarati alla massima paranoia: un falso positivo costa un mio clic, un falso negativo costerebbe molto di più.

A valle dei cinque livelli c'è la pubblicazione, che ha le sue regole. Sul ramo principale del codice non scrive nessun umano e nessun agente: scrive solo il server, con un'identità sua, dopo aver rifatto per conto suo i controlli deterministici sulla versione esatta che fonde. Di regola una modifica alle aree sensibili la sblocco io, con un clic dentro l'app. Due strade però non passano da quel clic, e si comandano anche dal terminale della mia macchina di sviluppo, dove lavora un LLM con le mie credenziali:

- **Il lavoro locale.** Quello che scrivo con Claude sul mio computer, su una segnalazione mia o su una che ho approvato come lavoro locale, si fonde senza fermarsi ai controlli deterministici: girano lo stesso e quello che trovano resta registrato, ma non aspettano il mio sì.
- **Il segno «fondi senza chiedermelo».** Su una singola segnalazione aperta posso dire in anticipo che il lavoro delle routine va fuso anche se i controlli lo fermano. Lo metto dall'app o con uno strumento da terminale, e quello che i controlli avevano fermato resta scritto fra le fusioni fatte senza chiedere.

Un'approvazione che un LLM può dare da solo non è un'approvazione, e queste due la permettono: è un punto debole, e lo trovi in fondo. Infine l'eseguibile lo costruisce un'esecuzione pubblica su GitHub, a partire dal codice pubblico: come controllarlo lo spiego più sotto.

## Le difese che imparano

L'idea più importante di questo sistema non sta in nessuno dei cinque livelli: è che l'insieme impari, come un sistema immunitario. I meccanismi sono tre, e oggi sono a punti diversi.

**Ogni attacco lascia memoria.** Ogni feedback classificato come attacco finisce in un archivio a parte. Il piano è rafforzare periodicamente uno dei giudici proprio su quell'archivio: come dopo un'infezione restano gli anticorpi, dopo un attacco i giudici riconoscerebbero meglio quella famiglia di inganni. Oggi l'archivio si riempie, ma il giudice che dovrebbe impararne lavora ancora con istruzioni fisse.

**Se le difese cadono, il sistema si ferma.** Il piano: se un attacco riesce a ingannare tutti i giudici insieme (per essere fermato più avanti), la lavorazione dei feedback si blocca finché il gruppo non viene rinforzato con un giudice che a quell'attacco resiste. È la febbre: fermarsi costa, ma continuare infetti costerebbe di più. Oggi questo arresto non scatta da solo: lo do io, con l'interruttore generale.

**Il vaccino è aperto a tutti.** Un canale red team dentro l'app permette a chiunque di mandare attacchi veri contro i giudici, mai contro il codice in produzione, con ricompense in crediti per chi li inganna. Sono attacchi veri nel contenuto ma incapaci di fare danno: esattamente ciò che serve per allenare le difese prima dell'infezione vera. Il canale esiste, ma per ora è in pausa: torna dopo il rilascio pubblico.

Quando tutti e tre saranno accesi, attaccare questo sistema sarà un pessimo affare: ogni tentativo lo lascerà più forte di come l'ha trovato.

Detto questo, **i livelli sono giovani.** I controlli descritti più sotto hanno già trovato punti da rinforzare, e ogni livello deve ancora ricevere test dedicati e varianti più robuste.

Un'ultima nota su cosa questo documento rivela: l'architettura, non i parametri. Quali soglie fanno scattare i filtri, quali modelli fanno da giudici e come sono scritti i loro prompt restano riservati, perché sono il bersaglio. Per lo stesso motivo il codice del server che fa questi controlli non è pubblico, a differenza di quello dell'app.

## Gli agenti dentro Filo

Filo non si limita a rispondere in chat: agisce. Apre pagine, archivia schede, cambia l'aspetto dell'app, imposta timer, legge i documenti che gli chiedi e usa il terminale del tuo computer. Il rischio è quello della prima sezione, con un bersaglio diverso: l'agente legge il web, e il web è testo scritto da sconosciuti. Là un testo ostile prova a entrare nel codice di tutti; qui prova a comandare l'agente che agisce sulla tua macchina.

La difesa poggia su una regola sola, applicata dappertutto: **ogni azione che Filo può compiere ha un livello di rischio assegnato dal codice, mai deciso dall'AI.** Un'azione che nel codice non ha un livello non parte. I livelli sono tre, e misurano una cosa concreta: quanto è reversibile l'azione.

1. **Reversibile del tutto.** Si esegue subito, senza chiedere: avviare un timer, cambiare un colore, aprire un link. Sui link c'è un'eccezione. Visitare un indirizzo è comunque una comunicazione verso l'esterno, quindi se l'indirizzo sembra portare con sé dati che l'agente aveva sotto gli occhi, l'apertura sale di livello e si ferma su una conferma che ti mostra l'indirizzo per intero. Lo stesso vale per una ricerca sul web.
2. **Reversibile ma con possibili inconvenienti.** Si ferma su una conferma che spiega cosa sta per succedere e quali sono i rischi, e parte solo col tuo OK. Per esempio inviare un feedback a tuo nome, archiviare le schede che non usi più, fissare una regola nella memoria di Filo.
3. **Irreversibile.** Cancellazioni e azioni senza ritorno, come svuotare la memoria di Filo o eliminare per sempre le schede archiviate. Qui la conferma ha attrito in più: devi scrivere tu la parola «conferma».

Alcune cancellazioni chiedono meno. Le pagine visitate si cancellano con un OK, come in ogni browser, e non tornano più. Una sveglia o un timer che nomini si tolgono senza chiedere, perché basta richiederli; se sono più d'uno, serve un OK. Togliere da una a tre righe della memoria di Filo chiede un OK, più di tre la parola «conferma».

**Il terminale.** Dal 3 ottobre 2026 è acceso di serie. A fare la sicurezza non è l'interruttore ma il livello di ogni singolo comando, che il codice calcola sul comando che sta per partire. I comandi che leggono soltanto, come guardare quanto spazio c'è sul disco o quali file ci sono in una cartella, partono subito. Quelli che cambiano qualcosa chiedono un OK. Le cancellazioni, i comandi pericolosi e qualunque comando che il codice non riconosce chiedono la parola «conferma». Ogni comando dice prima a parole cosa fa, e sotto c'è il comando vero. Il terminale si spegne dalle Preferenze, e per riaccenderlo dalla chat serve una conferma.

Due difese di contorno che è giusto sapere. All'agente è negato per costruzione chiudere finestre e schede, non per rischio ma per principio: ciò che stai guardando lo chiudi tu. E i documenti fuori dalla tua cartella utente (altri dischi, file nascosti, la cartella del profilo) li legge solo dopo un tuo OK.

**Filo può essere manipolato in azioni non distruttive.** Un sito potrebbe convincerlo a spingere un prodotto: comprarlo da solo non può, perché le azioni chiedono conferma, ma potrebbe parlartene meglio di quanto sarebbe giusto. Col progresso dei modelli questi attacchi funzionano sempre meno, ma il problema non è risolto.

**Leggere non chiede permesso.** I comandi che leggono e i documenti nella tua cartella utente partono senza conferma: un testo ostile che convincesse l'agente a leggere un file privato lo metterebbe davanti al modello. Portarlo fuori dal computer è più difficile, perché un link o una ricerca che sembrano trasportare dati si fermano su una conferma; ma è un controllo che riconosce le forme note, non una garanzia.

**Le conferme funzionano solo se le leggi.** Quasi tutte le richieste di Filo sono innocue, ed è un bene con un effetto collaterale: dopo un po' ci si abitua all'idea che gli avvisi siano falsi allarmi e si smette di leggerli, e il giorno dell'errore o della manipolazione vera il problema passa sotto gli occhi senza essere visto. La parola «conferma» per le azioni distruttive è rara apposta, per strappare attenzione almeno nei punti critici; ma nessuna conferma può obbligarti a leggerla.

## Da dove viene il file che hai scaricato

Le versioni di Filo le costruisce e le pubblica un'esecuzione automatica su GitHub, il flusso «Release Filo» del repository pubblico, partendo dal codice pubblico. Lo puoi controllare da te per ogni versione, in tre passi.

1. **Il numero di controllo.** Calcola l'impronta SHA-256 del file che hai scaricato. Su Windows, nel prompt dei comandi aperto nella cartella del file: `certutil -hashfile Filo-Setup.exe SHA256`. Su Mac, nel Terminale: `shasum -a 256 Filo-Mac.dmg`. Su Linux: `sha256sum Filo-Linux.AppImage`. Poi apri la pagina delle [versioni di Filo su GitHub](https://github.com/sathyaram1/Filo/releases): accanto a ogni file c'è la sua impronta SHA-256, calcolata da GitHub quando il file è stato caricato. I due numeri devono essere uguali. La stessa impronta c'è anche nell'[elenco delle versioni in formato macchina](https://api.github.com/repos/sathyaram1/Filo/releases/latest), alla voce digest di ogni file.
2. **Chi l'ha pubblicato.** Sulla stessa pagina, in cima alla versione, c'è chi l'ha pubblicata: deve essere github-actions, cioè un'esecuzione automatica del repository, non una persona.
3. **Il codice di partenza.** Ogni versione ha un'etichetta, per esempio v0.2.231, che punta al commit esatto da cui è stata costruita: dalla pagina della versione, il link al commit ti porta a quel codice. Anche l'esecuzione che l'ha costruita è pubblica: fra le [esecuzioni del flusso «Release Filo»](https://github.com/sathyaram1/Filo/actions/workflows/release.yml) c'è quella che nel passo «Riepilogo» scrive «Pubblicata v0.2.231», e nel suo registro si leggono il commit di partenza e ogni passo della costruzione. Se il file per Mac o per Linux di una versione non è riuscito ed è stato ricostruito più tardi, l'ha costruito un'esecuzione a parte, partita dalla stessa etichetta: è quella che nel passo «Riepilogo» scrive «Aggiunto il pacchetto Mac a v0.2.231» (o Linux). GitHub tiene questi registri per un tempo limitato, di serie novanta giorni.

**Cosa dimostrano questi passi, e cosa no.** Dimostrano che il file è quello che un'esecuzione pubblica del repository ha costruito da quel commit, e che nessuno l'ha cambiato dopo. Non dimostrano due cose. La prima: durante la costruzione dentro l'eseguibile entrano le chiavi dei servizi che Filo usa di serie, che nel codice pubblico non ci sono; quindi chi ricostruisce Filo dallo stesso commit non ottiene lo stesso identico file, e il confronto va fatto con l'impronta pubblicata. La seconda: l'installer non è firmato con un certificato. Senza, Windows e macOS non sanno dire chi l'ha prodotto e ti mostrano un avviso, e questo controllo lo devi fare a mano invece che il sistema da solo. Dove l'aggiornamento è automatico, Filo scarica dalla stessa pagina e confronta l'impronta del file con quella pubblicata prima di installarlo: così sa che il file è arrivato intero, non chi l'ha fatto.

## La sicurezza classica, come lavoro accumulato

L'assunto su cui costruisco questa parte: la solidità di un sistema si misura dalla quantità di lavoro d'attacco che ha subito. Oggi è vero in parte; lo sarà sempre di più man mano che i modelli diventano attaccanti competenti quanto gli umani, e poi più di loro. Filo oggi è piccolo e vale poco come bersaglio. Man mano che cresce, deve crescere anche il lavoro speso per difenderlo.

La conseguenza pratica: la sicurezza di Filo non deve essere un'affermazione, deve essere un registro. Diversi modelli di frontiera esaminano a intervalli tutto il sistema (l'app, il server, le regole del database, la catena di pubblicazione) cercando problemi, e l'esito di ogni corsa finisce in una tabella pubblica. Il registro dice quanto lavoro d'attacco è stato fatto, da chi, e cosa ha trovato. Sta a te giudicare se basta.

**Il registro non è ancora partito.** Lo strumento che fa girare i controlli e scrive la tabella è da costruire, e i controlli fatti finora li ho lanciati a mano, fuori da ogni registro. Quello che segue è il metodo con cui partirà.

Un chiarimento su cosa dimostra una tabella verde: dieci modelli che non trovano niente misurano i modelli, non il sistema. Il segnale forte non è il verde perpetuo, è la riga rossa diventata verde: prova che i controlli sanno trovare, e che quando trovano il problema viene chiuso. Se questa tabella fosse sempre verde dovresti sospettare dei controlli, non ammirare il sistema.

**Chi controlla.** Tutti i modelli di frontiera ammessi dalla politica sui modelli: i modelli di Anthropic più i migliori modelli a pesi aperti, serviti da fornitori indipendenti. Modelli diversi hanno punti ciechi diversi: la varietà del gruppo vale quanto la forza del singolo.

**Ogni quanto.** Un giro completo a cadenza fissa. Un giro straordinario quando esce un modello sensibilmente più capace, perché «niente trovato dai modelli dell'anno scorso» perde valore col tempo. E un giro mirato dopo ogni problema risolto.

**Fino a saturazione.** Quando un controllo trova un problema e il problema viene risolto, il controllo si rilancia sull'area toccata: dove c'era un buco spesso ce n'è un altro della stessa famiglia. Si smette quando i giri non trovano più niente di nuovo.

**Chi risolve.** La correzione la scrive la stessa catena di agenti che sviluppa Filo, passando dagli stessi cancelli di tutte le modifiche. In tabella pubblicherò il tempo effettivo tra il ritrovamento e la correzione pubblicata: preferisco un numero misurato a una promessa.

**Cosa pubblico e cosa no.** Un problema comparirà in tabella solo dopo essere stato risolto. È la regola della divulgazione responsabile applicata a me stesso: un problema aperto è un'informazione utile solo a chi vuole sfruttarlo. Per lo stesso motivo la tabella riporterà la gravità e l'area, non la ricetta: sapere che «un modello ha trovato un problema medio nelle regole del database, risolto in N ore» ti dice quanto lavora il sistema senza dare a nessuno una mappa. Sapere invece cosa viene controllato e da chi non aiuta un attaccante, e quindi è pubblico per intero: è la parte di trasparenza che costa poco e vale molto.

**La tabella.** Una riga per modello per corsa: la data, il modello (e chi lo serve), l'area controllata, l'esito. In testa, due numeri: da quanti giorni nessun modello trova niente, e quanti problemi sono stati trovati e risolti in totale. Il secondo numero che cresce non è una cattiva notizia: è il registro che lavora.

**Se un problema lo trovi tu.** Segnalalo dall'app, dal canale dei feedback. Il testo viaggia cifrato e lo leggono i giudici, gli agenti che lo lavorano e io. Sulla bacheca pubblica il problema compare solo a correzione fatta, con un titolo breve e senza i dettagli. La correzione però si scrive in pubblico: appena un agente comincia, sul repository di Filo su GitHub compaiono il numero del feedback, una descrizione del lavoro, le modifiche e le prove che riproducono il problema. Gli utenti la ricevono solo con l'aggiornamento che la contiene, di regola qualche ora dopo, e in quella finestra chi legge il repository può ricavare il problema dalla correzione. Contraddice la regola che applico alla tabella, e lo trovi fra i punti deboli.

## I punti deboli

1. **Il verde misura i modelli, non il sistema.** L'ho già detto sopra, ma è il limite principale e merita di stare anche qui: un problema che nessun modello di oggi sa trovare resta invisibile fino al modello di domani.
2. **Gli attaccanti veri non pubblicano i loro esiti.** Il registro accumulerà il lavoro d'attacco che commissiono io; quello di un attaccante reale non lo vedo finché non colpisce.
3. **La catena ha un anello dichiaratamente debole.** L'installer non è firmato con un certificato, e dentro l'eseguibile entrano chiavi che non stanno nel codice pubblico. Il controllo descritto sopra copre il codice e la costruzione, e il passaggio fino al tuo disco solo se lo fai a mano.
4. **Le difese che imparano non imparano ancora.** L'archivio degli attacchi si riempie ma nessun giudice ci si allena, l'arresto automatico non c'è e il red team è in pausa. Oggi il sistema si difende con i cinque livelli e con il mio interruttore.
5. **Chi scrive il codice e chi lo controlla sono entrambi LLM.** Li tengo decorrelati (modelli diversi, ruoli separati, nessuno approva sé stesso), ma una classe di errori condivisa da tutti i modelli di una generazione passerebbe. È una versione nuova di un problema vecchio: anche i revisori umani condividono i punti ciechi della loro epoca.
6. **Due strade saltano il mio clic.** Il lavoro locale e il segno «fondi senza chiedermelo» portano su main modifiche alle aree sensibili senza la mia approvazione nell'app, e si comandano anche dal terminale, dove un LLM ha le mie credenziali. Quello che saltano resta registrato, ma lo leggo dopo la fusione, non prima.
7. **La correzione di un problema si vede prima che arrivi a te.** Il lavoro sui feedback si fa sul repository pubblico: per un problema di sicurezza segnalato dall'app, la correzione e le prove che lo riproducono si leggono su GitHub mentre gli utenti hanno ancora la versione da correggere.
8. **Il codice del server non è pubblico.** Quello che dico del server, dai giudici al cancello che fonde il codice, va preso sulla parola: è il prezzo di tenere nascosto il bersaglio.

---

Scritto da Sathya con Claude, che è anche l'oggetto di metà di questo documento.
