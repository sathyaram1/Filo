# Un secondo modello guarda il testo prima dell'utente

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Il testo che Filo mostra dopo aver letto roba scritta da altri
(una mail, una pagina) passa da una porta sola: prima controlli deterministici
in locale, poi un secondo modello — **diverso** da quello che il testo l'ha
scritto. Se quel secondo modello non c'è o non risponde, il testo **non
compare e non si perde**: resta in coda, in vista, e riparte dopo. «Non lo so»
non è «passa».

## Il caso

La notifica è un canale d'attacco. Una mail scritta bene può far scrivere a
Filo «la tua banca chiede di confermare le credenziali, apri qui», e l'utente
si fida di Filo, non del mittente. Il testo verso l'utente non costa niente e
non chiede conferme: passa sempre. Per questo il controllo non può stare nel
modello che il testo l'ha prodotto — è già dentro al contesto avvelenato, e due
contesti sullo stesso modello condividono le stesse debolezze e cadono insieme.

## Come si fa

- **Chi è contaminato lo dice il prompt, non un elenco di superfici.** Il
  contenuto esterno entra nei prompt IMBUSTATO, da una porta sola
  ([Il canale fidato non trasporta testo di fuori](il-canale-fidato-non-trasporta-testo-di-fuori.md)), e il contenuto non può forgiare
  una busta. Quindi basta guardare il prompt già montato: se c'è dentro una
  busta, quello che ne esce passa dal guardiano. Sette giri di questo feedback
  sono andati dietro a un elenco di superfici tenuto a mano, e ce n'era sempre
  una fuori (la chat, il saluto della home, il riquadro del tasto destro, la
  chat dell'editor, l'assistente sulla pagina, il testo lasciato in un timer).
- **Il verso della regola è la regola.** Di serie una funzione è guardata;
  l'elenco è quello delle ECCEZIONI, con la ragione di ognuna
  (`SN_CONST.SENZA_GUARDIANO`), e una funzione nuova nasce protetta senza che
  nessuno se ne ricordi. Sono fuori solo le funzioni che ridanno il testo di
  qualcun altro trasformato (traduzioni, trascrizioni, correzioni) e quelle che
  prendono una decisione interna senza scrivere una frase.
- **Una porta sola, e chi la salta si rompe.** Il magazzino delle notifiche
  RIFIUTA una voce contaminata senza il timbro del controllo: non è un
  promemoria da ricordarsi, è un errore.
- **I controlli locali riconoscono FORME, non intenzioni.** Un segreto
  custodito da Filo, la forma di una chiave, un IBAN valido, un numero di carta
  che torna, un collegamento che non porta dove dice, un marchio di codice
  monouso (otp, usa e getta, di recupero). Tutto qui. Sette giri hanno provato
  a insegnargli quando un «codice di accesso» è una credenziale e quando è il
  portone di casa, e ogni giro trovava un'altra parola comune da fermare:
  telepass, posteggio, lavanderia, wifi, prenotazione. Quelle frasi le legge il
  guardiano, che ha davanti la frase intera; finché non ha risposto il testo non
  compare comunque, quindi non si perde niente.
- **Il modello diverso è un requisito, non una preferenza.** La catena del
  guardiano perde i soprannomi usati da chi ha scritto il testo, e il confronto
  si rifà sui modelli CONCRETI quando la catena è già costruita: fra la scelta
  e la chiamata c'è chi riscrive i soprannomi (l'interruttore «solo modelli a
  pesi aperti» sostituisce ogni proprietario col suo equivalente aperto, e due
  nomi diversi possono arrivare allo stesso modello). Se non resta niente, il
  testo va in coda.
- **I motivi sono chiusi.** Il guardiano sceglie una chiave da un elenco, non
  scrive la frase: la riga che l'utente legge nasce nel codice, quindi un testo
  ostile non arriva a scriverla nemmeno convincendo il modello. Stessa idea del
  giudice dei siti pericolosi.
- **Della fonte si mostra solo l'identità verificabile.** L'indirizzo di posta
  o il sito, mai il nome libero che chi manda si è scelto: dentro la riga «ho
  fermato un avviso» quel campo è un megafono, e un numero verde da chiamare
  non ha bisogno di nessun collegamento.
- **I blocchi devono restare rari, e si devono poter contare.** Un guardiano
  che grida al lupo viene spento: il registro dei blocchi sta in Preferenze e si
  legge anche quando è vuoto. Del testo fermato non si conserva un'anteprima
  quando è stato fermato proprio perché conteneva un segreto.
- **I collegamenti dicono dove portano.** Dentro un avviso la scritta di un
  link non la sceglie chi ha scritto l'avviso: vedi
  [Un collegamento dice dove porta](un-collegamento-dice-dove-porta.md).
- **Il materiale che si passa alla guardia va appiattito e dichiarato**, come
  in [Un modello che fa da guardia legge testo di terzi: appiattiscilo e dichiaralo](un-modello-che-fa-da-guardia-legge-testo-di-terzi.md).

## Dove vive

- `src/shared/contenutoEsterno.js` — `tipiPresenti`: chi ha letto roba di altri.
- `src/shared/fiducia.js` — quanto vale ogni tipo di contenuto esterno.
- `src/shared/constants.js` — `SENZA_GUARDIANO`: le eccezioni, con la ragione.
- `src/main/services/handlers.js` — il punto in cui ogni testo del modello
  passa di qui prima di tornare a chi lo mostra.
- `src/shared/guardianoStatico.js` — i controlli deterministici.
- `src/shared/guardiano.js` — la domanda, i motivi chiusi, la regola del
  modello diverso.
- `src/main/services/guardianoAvvisi.js` — la porta: statici, guardiano, coda.
- `src/shared/filoMemory.js` — il magazzino che rifiuta un avviso senza timbro.
- Guardie: `tests/unit/guardianoStatico.test.mjs`, `tests/unit/guardiano.test.mjs`,
  `tests/unit/guardianoBanco.test.mjs` e `tests/guardiano-avvisi.spec.mjs`.
