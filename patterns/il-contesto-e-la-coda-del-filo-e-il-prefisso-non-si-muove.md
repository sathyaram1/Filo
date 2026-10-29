# Il contesto è la coda del filo, e il prefisso non si muove

[← Tutti i pattern](../PATTERNS.md)

Fino al #868 la chat mandava al modello gli ultimi venti messaggi della scheda, più trenta righe del registro grezzo
tagliate a 200 caratteri. Una scheda nuova non sapeva niente di quella accanto. Adesso il modello ha davanti il
**filo** (#866): le conversazioni degli ultimi giorni, di tutte le schede, in ordine di tempo, con l'ora e la chat
in testa ai messaggi dell'utente. La logica è in `src/shared/filoContesto.js` e `src/shared/filoTrattoVivo.js` (pure),
la lettura del filo e la fotografia del CONTESTO in `src/main/services/contestoFilo.js`, i ricordi in
`src/main/services/ricordiFilo.js`. Dal #1562 la richiesta è quella di SPEC-CONTESTO § La richiesta, in quattro blocchi.

## Le regole

- **Due tetti, vince il minore**: giorni (3) e token (100.000). L'utente li cambia in Preferenze → Impostazioni
  avanzate o dalla chat; l'owner nei Modelli predefiniti (`contestoFilo` in `config/models`). Vuoto = predefinito.
- **L'ordine della richiesta** (#1562): strumenti, uguali per ogni utente, sistema e ruolo (`definitions()` senza
  argomenti: ONBOARDING c'è sempre e fuori dall'intervista lo ferma il main) → parte fissa (`filoChatStatic()`, uguale byte
  per byte per tutti) → CONTESTO dell'utente (sistema operativo, capacità, stile, modello, memoria, STATO senza ora né
  tempi relativi, cambi delle valute, file), fotografato → tratto vivo → domanda → giro di strumenti. Sentinella
  `tests/unit/richiestaChat.test.mjs`.
- **Il CONTESTO si fotografa e sta fermo** fino al prossimo taglio del tratto (il suo inizio si sposta), alla cache
  fredda (fermo più della sua durata) o a un cambio che non si dice con un'aggiunta (una riga di memoria tolta, le
  capacità): una riga dimenticata non resta davanti al modello con accanto «tolta». Quello che cambia nel frattempo
  arriva nella domanda dopo, sezione per sezione (`SN_TRATTO_VIVO.confronta`): la memoria per righe nuove, i file per id,
  il resto intero; il sistema torna solo quando la batteria passa una decina, i crediti quando cambiano le prime due
  cifre. Una fotografia nuova toglie dai messaggi passati le sezioni cambiate di quella prima.
- **Davanti a ogni messaggio dell'utente** Filo scrive, in un blocco suo dopo l'ora e la chat, le cose successe dal
  messaggio dell'utente prima (accaduti e cambi del filo, con l'id dei cambi per ANNULLA_CAMBIO, in una busta), le
  sezioni cambiate, e nella domanda di quel turno i ricordi ripescati e l'intervista. Le azioni di una chat dentro il suo
  turno non ci sono: le racconta il turno. Le pagine visitate no: entrano solo cercate. Si scrivono la prima volta e
  restano quelle (un evento in ritardo non riscrive un messaggio già mandato); dopo una cancellazione si rifanno.
- **I punti di cache stanno sui confini dei blocchi**: fine della parte fissa e fine del CONTESTO (tutte e due della
  durata scelta, un'ora di serie), fine del tratto prima della domanda, ultimo messaggio: quattro, il massimo di
  Anthropic. Il piano lo fa il cancello dei modelli sui messaggi già oscurati; lo scrive nel corpo solo il fornitore, e
  solo per i modelli Anthropic (due punti nello stesso system si dividono da sinistra). Un pezzo variabile nuovo nel
  system si apre con uno degli inizi di `INIZI_VARIABILI_CHAT`. Sentinella `tests/unit/puntiDiCache.test.mjs`.
- **Il prefisso non si muove fra due turni: il tratto cresce solo in coda.** Ore assolute, mai «2 ore fa»; un nome di
  chat fisso (quattro caratteri dell'id), non «questa scheda»; il taglio per giorni si sposta a scatti (da un'ora a
  sei); oltre il tetto in token si taglia un quarto sotto e l'inizio si tiene finché basta. La domanda di un turno è già
  resa come la renderà il tratto dei turni dopo, e la risposta torna col suo giro (strumenti, esiti, seguiti) finché la
  memoria lo tiene: un turno passato riscritto rompe la cache da lì e il ragionamento nato dentro i suoi giri. Fino
  alla prossima fotografia un messaggio mandato intero resta intero, e la riga di un'app resta com'era (#1562). Una
  conversazione ripresa da prima dei tetti riporta i suoi ultimi messaggi dentro un quarto del tetto in token, e la
  finestra si stringe di altrettanto: il tetto vale sempre.
- **Verso Claude il ragionamento parte solo col prefisso con cui è nato** (#1552). Sui conti Anthropic nati dal
  31/08/2026 un blocco di ragionamento con davanti un system, strumenti o messaggi diversi da quelli della sua nascita
  fa rifiutare la richiesta, e via OpenRouter la chiave dell'owner ripiega in silenzio sui crediti del router. Ogni
  risposta porta l'impronta della richiesta che l'ha fatta nascere (un blocco `filo.impronta` nell'elenco del
  ragionamento, tolto prima di ogni invio); il fornitore la confronta con quello che precede il messaggio adesso, nel
  corpo che parte davvero, e per i modelli Anthropic manda il ragionamento solo se coincide. Una regola sola per tutte
  le porte: taglio del tetto, parte fissa, strumenti, segreti oscurati, compattazione. I ragionamenti davanti contano
  come il testo: più stretto di Anthropic, che ammette di toglierli dalla testa, mai un blocco in dubbio. Con la
  richiesta che cresce solo in coda (#1562) tornano anche quelli dei turni passati. Sentinella
  `tests/unit/ragionamentoRimandato.test.mjs`.
- **Le letture restano col tratto** (#1562, SPEC-CONTESTO § Gli esiti degli strumenti, che chiude #553.2): l'esito di
  una pagina, un documento, un comando, e il ragionamento di una risposta, restano nel messaggio che li ha prodotti
  finché il messaggio è nel tratto, in ogni scheda; un turno passato non si riscrive. Gli esiti stanno in memoria (mai
  su disco) e se ne vanno con la loro chat. Il testo che la chat scrive nella conversazione venendo da fuori (l'esito
  di un comando dato in chat con «/», il nome di un file scaricato) è una lettura allo stesso modo (`letturaDaFuori`):
  mai nudo come parole di Filo, imbustato, contato per le uscite. Resta una lettura anche quando torna dall'archivio
  (un ricordo, una ricerca, una rilettura con l'id): l'azione che lo riporta lo dichiara in `_output.daFuori`, e uscite
  (`contestoDaAzioni`) e conferme (`fonteDi`) lo contano per tutte le azioni allo stesso modo.
- **Le immagini mandate in chat tornano col loro messaggio** (#1166), finché sono in memoria, dalle più nuove: al
  più sedici e 24 milioni di caratteri per richiesta (sotto i limiti dei fornitori); per i tetti in token una pesa
  1.500 token, non i caratteri del data URL. Oltre i tetti si scende di un quarto, come per i token, e il taglio si tiene
  finché basta: una foto nuova non riscrive il tratto a ogni messaggio. Stanno in memoria, mai su disco, e se ne vanno con la loro chat. Quando
  non tornano (vecchie, oltre i tetti, Filo riaperto, modello che le rifiuta) al loro posto c'è una nota: quante
  erano, e che quello che il modello ne ha scritto l'aveva letto da lì. Senza, al turno dopo diceva di non vederle e
  ritrattava letture giuste. Un modello che rifiuta le immagini dei turni passati (solo testo, una per richiesta)
  rifà lo stesso giro con la nota, e da lì quel modello riceve solo la nota.
- **Un messaggio tagliato si rilegge davvero**: oltre un quarto del tetto restano testa e coda, con l'id intero della
  chat; CERCA_CHAT con l'id rilegge la conversazione intera finché ci sta nella finestra del modello, oltre dà testa, coda e il
  numero da cui leggere il mezzo, e con `da` lo dà a pezzi della stessa misura. Nessun secondo taglio nella busta.
- **La rilettura sta nella finestra fin dal primo tentativo** (#868.7): la finestra nota del modello (quella detta da
  un rifiuto, o il `context_length` del listino di OpenRouter) meno la richiesta già fatta e il tetto della risposta,
  mai oltre il tetto in token e mai sotto 8.000 caratteri. Senza finestra nota vale il tetto. Valeva il tetto intero
  finché un rifiuto non la insegnava: chi scrive poco non la insegnava mai, e un modello da 32.000 token falliva.
- **Ogni azione il cui esito arriva al modello conta per le uscite** (#587): `azioniViste` nasce dagli stessi esiti
  che finiscono nel prompt, quindi un documento letto in una scheda fa chiedere conferma a un link con un suo pezzo
  aperto da un'altra.
- **I pezzi vecchi si ripescano da soli**: ogni scambio più vecchio della finestra ha un vettore (modello della
  Cronologia, una volta sola, file accanto al filo, via con la sua chat, mai in incognito). La domanda ne porta al
  massimo tre sopra la soglia nel blocco che Filo le scrive in testa, imbustati come archivio, e ci restano nei turni
  dopo (non fra gli esiti della risposta, che li ripeterebbe), e il blocco di attività lo dice come
  una ricerca («Ricordato dal filo · titolo», ogni conversazione una volta anche se ne arrivano più pezzi). Un pezzo
  che il modello ha già davanti (ripescato da un turno prima e ancora vivo come lettura, o la sua conversazione
  riletta intera) non si ripesca: a ogni messaggio sullo stesso argomento le copie si accumulavano (#868.1). Senza
  modello d'indicizzazione vale per parole, ed è una prova debole: almeno due parole rare (in poche conversazioni
  vecchie, ma in almeno una: una parola che non c'è da nessuna parte non si pretende), senza la punteggiatura ai
  bordi, tutte nello stesso scambio, e mai di cortesia (rare finché dette una volta sola); un «ok grazie» o un
  «perfetto, grazie mille» non ripescano niente. L'attesa ha un tetto: oltre, il turno parte senza.
- **Ciò che è cancellato non torna dalle copie** (#868.1): gli esiti di ricordi, ricerche e riletture davanti al
  modello perdono le conversazioni e le pagine che il filo non ha più, dal messaggio dopo e in ogni scheda (la
  rilettura dice che è stata cancellata, la ricerca quanti risultati). Una regola sola quando si compone il
  contesto, sulle copie (memoria, storia della scheda, giro di un turno, ricordi nella domanda, cose successe): vale per
  ogni strada che cancella. Un giro con dentro qualcosa che non c'è più torna come risposta sola, ripulita.
- **Il tetto in token cede alla finestra del modello**: se il fornitore rifiuta la richiesta perché supera la finestra
  del modello della chat, il tratto si stringe quanto dicono le misure del rifiuto (senza misure, a metà) e lo stesso
  giro riparte; il tetto che ha retto vale per i turni dopo con quel modello (in memoria). Si stringe prima la parte
  più grossa: una rilettura di questo turno si rilegge alla misura della finestra appena detta, così il turno dopo,
  che se la ritrova davanti, ci sta ancora. L'utente non vede il rifiuto.
- **CERCA_CHAT cerca in tutto il filo**: chat di ogni scheda (di quella di adesso solo i messaggi che il modello non ha
  davanti: una conversazione ripresa o lunga ha un inizio che si cerca), pagine visitate (e il contenuto
  delle schede chiuse, coi vettori della Cronologia), cambi annullabili. Pagine, chat e cambi si cercano per parole
  con gli stessi tre passi (tutte, quelle che distinguono, almeno una): una parola in più nella domanda non fa
  sparire la pagina o il cambio mentre la chat si trova. Le pagine non entrano mai da sole nel
  contesto: solo cercate (decisione dell'owner, D56 la cambierà con un interruttore). Una pagina delicata dice solo
  il sito; gli indirizzi trovati si riaprono senza conferma, come i link di una ricerca.

- **Le chat delle app entrano come una riga** all'ora in cui sono cominciate, mai lo scambio: vedi
  [Il filo cresce solo in coda](il-filo-cresce-solo-in-coda-e-cancellare-e-un-evento.md), § chat delle altre app.

- **Chi non ha il filo davanti lo riceve in breve**: la home e il creatore di lezioni hanno nello stato le
  CONVERSAZIONI RECENTI (ultime 24 ore, al più quaranta messaggi, il taglio dichiarato). La chat no: ha il tratto.

## Perché così

- Il registro grezzo era il taglio silenzioso che il repo vieta, e copiava male quello che il filo tiene intero.
- Misura del 21/09/2026: su alcuni host la cache non scatta. Il prefisso stabile serve dove scatta; dove non scatta il
  costo lo dice la Cronologia delle richieste AI (token riusati per chiamata).
