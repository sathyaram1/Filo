# Un testo scritto in una casella si salva da solo, o lo perdi

[← Tutti i pattern](../PATTERNS.md)

Una casella dove l'utente scrive deve spedire quello che c'è dentro da
**qualunque uscita**: dopo una pausa mentre scrive, quando il cursore la lascia,
e prima di ogni azione che porta via il pannello. Se l'unica strada è il tasto
"Salva", tutte le altre buttano via il testo in silenzio.

Il caso: nella dashboard di gestione la riga per chi ha segnalato si spediva solo
col suo tasto. Scriverla e poi premere "Risolto" — il gesto più naturale che
esista, perché quella riga si scrive proprio mentre si chiude la segnalazione —
mandava via il solo cambio di stato: al mittente arrivava la chiusura senza
nessuna riga, e il testo appena scritto non esisteva più. Le porte erano tre, e
tutte finivano nello stesso punto: il pannello si ridipinge e riempie la casella
col valore salvato.

- **Ogni porta si chiude nello stesso punto.** Non basta far partire la frase
  insieme al tasto: portano via il pannello anche il clic sulla stessa scheda
  nella lista, il cambio di sezione, l'apertura di un'altra scheda. Il
  salvataggio va messo dove il pannello cambia padrone, prima che l'indirizzo
  di destinazione cambi: un istante dopo, quel testo finirebbe sull'elemento
  sbagliato.
- **L'azione che chiude aspetta la scrittura, e non parte se fallisce.** Se la
  frase non arriva a destinazione, cambiare stato la perde per sempre: meglio
  fermarsi, dirlo, e lasciare il testo davanti agli occhi.
- **"È cambiato qualcosa?" si chiede a quello che è PARTITO, non a quello che la
  pagina ricorda.** Finché la risposta non torna, il valore memorizzato è ancora
  quello di prima: un ripensamento scritto in quella finestra verrebbe
  inghiottito. E una scrittura fallita lascia il valore IGNOTO, che non combacia
  con niente: da lì si riprova.
- **Il salvataggio automatico tocca solo quello che l'utente ha scritto lui.**
  Senza questa guardia, girare fra gli elementi riscriverebbe testi che nessuno
  ha toccato, ripuliti degli spazi o tagliati al limite del campo.
- **Il tasto esplicito resta, e risponde sempre.** Premuto quando non c'è più
  niente da spedire dice che la riga è a destinazione, non "nessuna modifica":
  chi lo preme vuole sapere se il suo testo è arrivato.
- **Dove:** `salvaFraseSubito`, `salvaFraseAutomatico`, `fraseAlSicuro`,
  `applyAction` in `src/pages/manage/manage.js`; gli ascoltatori di
  `.fb-usernote` e `.fb-notes` in `src/pages/feedback/feedback.js`, che così
  facevano già. Test: `tests/manage-frase-non-si-perde.spec.mjs`.
