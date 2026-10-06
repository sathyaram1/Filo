# Il contesto è la coda del filo, e il prefisso non si muove

[← Tutti i pattern](../PATTERNS.md)

Fino al #868 la chat mandava al modello gli ultimi venti messaggi della scheda, più trenta righe del registro grezzo
tagliate a 200 caratteri. Una scheda nuova non sapeva niente di quella accanto. Adesso il modello ha davanti il
**filo** (#866): le conversazioni degli ultimi giorni, di tutte le schede, in ordine di tempo, con l'ora e la chat
in testa ai messaggi dell'utente. La logica è in `src/shared/filoContesto.js` (pura), la lettura del filo in
`src/main/services/contestoFilo.js`, i ricordi in `src/main/services/ricordiFilo.js`.

## Le regole

- **Due tetti, vince il minore**: giorni (3) e token (100.000). L'utente li cambia in Preferenze → Impostazioni
  avanzate o dalla chat; l'owner nei Modelli predefiniti (`contestoFilo` in `config/models`). Vuoto = predefinito.
- **L'ordine della richiesta**: istruzioni fisse → tratto del filo → quello che la scheda ha e il filo no (un turno
  interrotto) → CONTESTO DI ADESSO (stato, memorie, file, ricordi ripescati) → domanda. Tutto ciò che cambia a ogni
  turno sta dopo il tratto: su un prefisso da 100k token senza cache si paga tutto a ogni messaggio. Sentinella
  `tests/unit/filoContesto.test.mjs` (due turni hanno lo stesso prefisso; i ricordi stanno dopo gli eventi recenti).
- **Il prefisso non si muove fra due turni.** Ore assolute, mai «2 ore fa»; un nome di chat fisso (quattro caratteri
  dell'id), non «questa scheda»; il taglio per giorni si sposta a scatti (da un'ora a sei); oltre il tetto in token
  si taglia un quarto sotto e l'inizio si tiene finché basta. Il ragionamento torna solo sull'ultima risposta.
- **Le letture vivono venti messaggi del filo** (#553.2, decisione dell'owner aperta): l'esito di una pagina, un
  documento, un comando entra nel messaggio che l'ha prodotto finché è fra gli ultimi venti, in qualunque scheda,
  poi resta solo il nome dell'azione. Gli esiti stanno in memoria (mai su disco) e se ne vanno con la loro chat.
- **Ogni azione il cui esito arriva al modello conta per le uscite** (#587): `azioniViste` nasce dagli stessi esiti
  che finiscono nel prompt, quindi un documento letto in una scheda fa chiedere conferma a un link con un suo pezzo
  aperto da un'altra.
- **I pezzi vecchi si ripescano da soli**: ogni scambio più vecchio della finestra ha un vettore (modello della
  Cronologia, una volta sola, file accanto al filo, via con la sua chat, mai in incognito). La domanda ne porta al
  massimo tre sopra la soglia nel CONTESTO DI ADESSO, imbustati come archivio, e il blocco di attività lo dice come
  una ricerca («Ricordato dal filo · titolo»). Senza modello d'indicizzazione vale per parole, tutte quelle che
  distinguono. L'attesa ha un tetto: oltre, il turno parte senza.
- **CERCA_CHAT cerca in tutto il filo**: chat di ogni scheda tranne quella di adesso, pagine visitate (e il contenuto
  delle schede chiuse, coi vettori della Cronologia), cambi annullabili. Le pagine non entrano mai da sole nel
  contesto: solo cercate (decisione dell'owner, D56 la cambierà con un interruttore). Una pagina delicata dice solo
  il sito; gli indirizzi trovati si riaprono senza conferma, come i link di una ricerca.

## Perché così

- Il registro grezzo era il taglio silenzioso che il repo vieta, e copiava male quello che il filo tiene intero.
- Misura del 21/09/2026: su alcuni host la cache non scatta. Il prefisso stabile serve dove scatta; dove non scatta il
  costo lo dice la Cronologia delle richieste AI (token riusati per chiamata).
