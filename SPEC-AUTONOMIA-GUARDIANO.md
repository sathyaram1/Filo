# Autonomia e guardiano

Bozza per l'owner. Definisce quanto Filo può fare da solo, chi glielo impedisce
quando serve, e come le due cose valgono uguali su tutte le superfici.

Stato: **da correggere**. Le domande aperte sono in fondo.

---

## 1. Il problema in una riga

Filo vuole essere il modo con cui ti interfacci alla tecnologia, quindi legge
testo scritto da sconosciuti e compie azioni per conto tuo. Queste due cose
insieme sono pericolose. Tutto il resto del documento serve a tenerle insieme
senza che si facciano male.

---

## 2. Vocabolario

Tre parole che nel resto del documento hanno un significato preciso.

**Contenuto non fidato.** Qualunque testo che non ha scritto né l'utente né
Filo: corpo delle mail, pagine web, messaggi, contenuto dei file scaricati,
risposte di servizi esterni, e anche i nomi dei file. Non è "contenuto
sospetto": è la condizione normale di quasi tutto quello che Filo legge.

**Contenuto fidato.** Le parole dell'utente in chat, la configurazione di Filo,
le memorie che l'utente ha confermato.

**Mittente fidato.** Un indirizzo a cui l'utente ha risposto almeno una volta e
che Filo ha registrato come tale. Il confronto è sull'**indirizzo**, mai sul
nome mostrato: scrivere il nome di un conoscente nel campo del nome è
l'inganno più comune che esista. Un mittente fidato abbassa il rischio, non
salta i controlli: un account rubato resta fidato fino al momento in cui non
lo è più.

---

## 3. Il meccanismo di base: dichiarazione preventiva dei poteri

Prima che un agente apra del contenuto non fidato, dichiara quali strumenti gli
servono per il compito. Da quel momento non può usarne altri.

Tre regole che rendono la cosa vera invece che educata:

1. La dichiarazione avviene **prima** che il primo byte non fidato entri nel
   contesto dell'agente.
2. A farla rispettare è il motore che consegna gli strumenti, non l'agente. Uno
   strumento non dichiarato viene rifiutato, e la dichiarazione non si allarga
   fino alla fine del compito.
3. Se durante il lavoro l'agente scopre che gli serve altro, il compito finisce
   lì. Se ne apre un altro, il che vuol dire tornare a chi aveva l'autorità:
   l'utente, o lo stadio che aveva ricevuto la richiesta.

La dichiarazione viene registrata insieme al compito. Serve al guardiano dei
registri e serve all'utente, che deve poter vedere cosa un'automazione era
autorizzata a fare, non solo cosa ha fatto.

Esempio. *Mettimi la sveglia per l'esame di fisica.* L'agente dichiara: mi
serve leggere la posta e creare sveglie. Poi legge. Se la mail contiene
un'istruzione per inoltrare qualcosa, non ha lo strumento per farlo, e la
questione finisce lì senza dipendere da quanto è stato bravo a non cascarci.

---

## 4. I quattro livelli

Un livello si sceglie una volta e vale ovunque. Le differenze fra le superfici
stanno nella tabella del capitolo 6, non nella testa dell'utente.

**Paranoica.** Niente esce senza approvazione esplicita, azione per azione. Il
contenuto non fidato arriva solo ad agenti che rispondono con un dato
tipizzato, mai con testo libero. Nessuna risposta automatica. Ogni mittente mai
visto prima richiede una conferma. Attrito costante e dichiarato.

**Default.** Rischio minimo con controlli ridondanti. Filo fa da solo le cose
reversibili, chiede per quelle che non lo sono o che si vedono da fuori. Il
guardiano è attivo su tutto ciò che esce.

**Automatica.** Interazione ridotta al minimo. Filo scrive e risponde da solo
entro i destinatari consentiti. Il guardiano resta attivo e i controlli statici
pure. Quello che non si sblocca è l'elenco del capitolo 5.

**Yolo.** Ci si fida di Filo. Restano solo i controlli che non impediscono nulla
per principio: guardiano, controlli statici, elenco del capitolo 5.

### Il livello è un pavimento

Una superficie può essere **più severa** del livello scelto, mai più
permissiva. Chi mette yolo per le mail non si ritrova sbloccato il terminale
per sbaglio. Alzare il livello globale non abbassa nessuna scelta fatta a mano
su una singola superficie.

### Come si cambia

Alzare l'autonomia lo può proporre Filo quando serve, con una spiegazione di
cosa cambia.

Abbassare una difesa lo fa solo l'utente, e **digitando "conferma"**, la stessa
forma già usata per le azioni distruttive. Un clic su un pulsante lo si dà
senza leggere; scrivere una parola no.

Il guardiano può **abbassare il livello di sua iniziativa e senza chiedere**,
spiegando dopo. Quando c'è un attacco in corso non si negozia, si chiude la
porta e se ne parla poi.

Il livello attivo si vede sempre. Se non si vede, non esiste.

### Attrito che non protegge

Se l'utente sta su un livello basso ma continua a confermare tutto, sta
prendendo l'attrito senza la sicurezza, e le conferme diventano un riflesso.
Quando Filo se ne accorge lo dice e propone di alzare il livello. Vale anche
al contrario: chi non conferma mai niente sta su un livello troppo severo per
come lavora.

---

## 5. Quello che nessun livello sblocca

Elenco corto e fisso. Nemmeno yolo lo tocca. È quello che rende offribile un
livello che si chiama yolo.

- Muovere denaro, in qualsiasi forma.
- Cancellare in modo definitivo dati dell'utente, dentro o fuori Filo.
- Spedire lo stesso messaggio a molti destinatari insieme.
- Cambiare le credenziali di accesso di un servizio, o revocarne il recupero.
- Cambiare i livelli di autonomia stessi.

Aggiunte a questo elenco sono benvenute. Togliere una voce è una decisione
dell'owner, non di chi implementa.

---

## 6. La matrice, come dati

La tabella qui sotto è la sola fonte di verità. Vive in
`src/shared/autonomy.js`, seguendo la convenzione degli altri moduli condivisi
(`global.SN_AUTONOMY = …`, aggiunto all'ordine di `loader.js`). Ogni superficie
la legge, nessuna decide per conto suo. Una sentinella negli unit test diventa
rossa se una superficie fa qualcosa che nella tabella non c'è, come già succede
per il manifesto delle capacità.

Legenda: **auto** parte da sola, **chiede** mostra e aspetta, **conferma**
richiede la parola digitata, **mai** non è disponibile a quel livello.

| Superficie e azione | Paranoica | Default | Automatica | Yolo |
|---|---|---|---|---|
| **Posta** leggere e riassumere | auto | auto | auto | auto |
| **Posta** notificare | auto | auto | auto | auto |
| **Posta** rispondere a mittente consentito | mai | chiede | auto | auto |
| **Posta** scrivere a mittente nuovo | mai | chiede | chiede | auto |
| **Posta** allegare un file non nominato dall'utente | mai | conferma | chiede | chiede |
| **Web** leggere pagine | auto | auto | auto | auto |
| **Web** compilare un modulo | chiede | chiede | auto | auto |
| **Web** inviare un modulo | conferma | chiede | chiede | auto |
| **Web** caricare un file | conferma | chiede | chiede | auto |
| **File** leggere | chiede | auto | auto | auto |
| **File** scrivere o modificare | chiede | chiede | auto | auto |
| **File** spostare o eliminare | conferma | conferma | chiede | chiede |
| **Terminale** comandi di sola lettura | chiede | auto | auto | auto |
| **Terminale** comandi che modificano | mai | conferma | chiede | chiede |
| **Messaggistica** leggere | auto | auto | auto | auto |
| **Messaggistica** rispondere a contatto noto | mai | chiede | auto | auto |
| **Messaggistica** scrivere a contatto nuovo | mai | conferma | chiede | chiede |
| **Memorie** ricordare un fatto | auto | auto | auto | auto |
| **Memorie** cambiare il comportamento di Filo | chiede | chiede | chiede | auto |
| **Sveglie** creare o spostare | chiede | auto | auto | auto |
| **Impostazioni** di Filo | conferma | conferma | conferma | conferma |
| **Acquisti e denaro** | mai | mai | mai | mai |

Le righe sono da correggere una per una: è la parte della bozza su cui conto
di sbagliare di più.

---

## 7. Il guardiano

Un solo principio applicato in tre punti: **prima che qualcosa passi, un
secondo giudizio indipendente guarda cosa sta succedendo.** Indipendente vuol
dire su un modello diverso da quello che ha prodotto l'azione. Due contesti
diversi sullo stesso modello condividono le stesse debolezze e cadono insieme.
Con la configurazione remota dei modelli questa scelta non costa niente, ma va
scritta qui e non lasciata al caso.

### 7.1 Controlli statici, prima di tutto

Regole fisse, in locale, che non chiedono niente a nessun modello e quindi
funzionano anche a rete staccata. Bloccano da sole.

- Coordinate bancarie e numeri di carta in uscita.
- Sequenze che somigliano a codici usa e getta o a chiavi di servizio.
- **Confronto con il portachiavi.** Se il testo in uscita contiene una stringa
  che coincide con un segreto custodito da Filo, si blocca senza discutere.
  Questo è il controllo più importante dei tre, ed è quello che costa meno.
- Allegati che l'utente non ha nominato.

### 7.2 Guardiano di uscita

Vede l'intenzione dichiarata, l'azione che sta per partire e il suo contenuto.
Giudica se l'azione somiglia a quella chiesta o se ha qualcosa in più. È la
forma che ha un attacco riuscito: quasi giusto, con un pezzo aggiunto.

Blocca e spiega cosa ha visto, non che ha avuto un dubbio. I blocchi devono
restare rari: un guardiano che grida al lupo viene spento, e allora non protegge
più niente.

**Se non risponde:** si riprova con un tetto. Esaurito il tetto, l'azione non
parte e non si perde. Va in coda e l'utente lo sa. Una mail che parte dieci
minuti dopo non ha fatto danno a nessuno, una mail che parte senza controllo
sì. Modello di ripiego e fornitori alternativi riducono i casi, non li
azzerano: i controlli del 7.1 sono la rete che regge comunque.

### 7.3 Guardiano delle notifiche

La notifica è essa stessa un canale. Una mail scritta bene può far scrivere a
Filo *la tua banca chiede di confermare le credenziali, apri qui*, e l'utente
si fida di Filo, non del mittente.

Prima che una notifica appaia, un giudizio indipendente controlla se quel testo
sta cercando di far fare all'utente qualcosa di rischioso. Anche con il primo
agente compromesso del tutto, scrivere un testo che inganni insieme la persona
e un secondo modello con un compito diverso è molto più difficile.

Il mittente resta a portata, ma senza una riga fissa che occupi spazio: Filo
dice cosa succede, e chi lo dice si vede passandoci sopra.

### 7.4 Guardiano dei registri

Guarda la scia delle azioni compiute, non la singola azione. Serve per quello
che un controllo puntuale non può vedere: dieci azioni innocue che insieme
formano una cosa che non lo è. Gira a intervalli, non nel percorso critico,
quindi può permettersi di essere lento.

È il guardiano che può abbassare il livello di autonomia di sua iniziativa.

---

## 8. Lettura della posta e memoria

Il giro all'accensione, o all'arrivo se il computer è già acceso, apre le mail
nuove. Ogni mail ha il suo agente, così nessuna divide l'attenzione con le
altre.

**Il giro deve lasciare qualcosa dietro di sé.** Quello che ha letto diventa
memoria consultabile. Altrimenti la domanda *quando ho l'esame di fisica* fa
rileggere la casella da capo, e la rifà ogni volta. Il giro costruisce, le
domande interrogano, e solo quando la memoria non sa si torna a leggere.

**Riprovare ha un tetto e un contatore visibile.** Un accodamento che riprova
per sempre in silenzio è un guasto invisibile, ed è già successo.

**Lezioni: sapere contro comportamento.** Una lezione tratta da contenuto non
fidato è una memoria che dura e che influenza tutto quello che Filo farà dopo,
quindi è il posto perfetto dove piantare una bugia. Un fatto sul mondo si tiene,
scritto con la provenienza e con chi l'ha detto. Una lezione che cambia come
Filo si comporta la conferma l'utente, a qualunque livello tranne yolo.

---

## 9. Fuori dalla specifica

Le periferiche. Una tastiera che scrive a velocità impossibile è un attacco
vero, ma da dentro Filo si vede solo mentre la nostra finestra ha il fuoco.
È una difesa che sta al livello del sistema operativo, e diventerà nostra
quando Filo sarà un sistema operativo. Non prima.

Il traffico ordinario del browser. Migliaia di richieste per pagina non passano
sotto un modello. Si filtra con regole, e un agente indaga solo su quello che le
regole segnalano.

---

## 10. Costi e onestà

I controlli extra si pagano, e il costo è quello vero: margine dichiarato, in
linea con il documento di trasparenza sui costi. Nessun livello di sicurezza è
riservato a chi paga di più. Chiunque può accendere tutto, e chi accende tutto
consuma di più. La differenza fra i piani è quanto puoi consumare, non quanto
sei protetto.

---

## 11. Ordine di costruzione

1. La matrice come dati, con la sentinella nei test. Tutto il resto la legge.
2. Controlli statici, a partire dal confronto con il portachiavi.
3. Dichiarazione preventiva dei poteri, imposta dal motore degli strumenti.
4. Guardiano di uscita, prima fetta: solo la posta.
5. Guardiano delle notifiche.
6. Modalità automatica sulla posta, con l'elenco dei destinatari consentiti.
7. Guardiano dei registri.

L'ordine conta su un punto solo: la modalità automatica non arriva prima del
guardiano che la sorveglia.

---

## 12. Domande aperte per l'owner

1. La matrice del capitolo 6 riga per riga. È la parte dove ho tirato a
   indovinare di più, soprattutto su terminale e file.
2. In modalità automatica, la prima mail verso un destinatario consentito la
   vedi comunque o parte da sola? Nella bozza parte da sola, ed è la scelta più
   rischiosa del documento.
3. Il livello si sceglie una volta sola per tutto Filo, o si può alzare su una
   superficie e tenerlo basso altrove? La bozza permette solo di essere più
   severi, mai più permissivi.
4. L'elenco del capitolo 5 va bene così, o ci metteresti altro?
5. La risposta tipizzata resta confinata al livello paranoico, come hai detto,
   oppure la usiamo anche altrove quando quello che serve è davvero un dato?
