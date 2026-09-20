# Quello che il modello dice di aver fatto si confronta con quello che ha fatto

[← Tutti i pattern](../PATTERNS.md)

Sul banco di prova dell'agente, in #517, il modello chiudeva il turno così: «Ti
ho messo una sveglia alle 19:00 per ognuna di quelle notti». Non aveva chiamato
nessuno strumento. Il testo arrivava in chat, la sveglia no, e l'utente lo
scopriva la mattina in cui non suonava. Il prompt lo vietava già, per iscritto,
in due punti. Non è servito: il divieto è una promessa affidata al modello, e
il fallimento era muto dalle due parti, perché nessuno confrontava le parole
con le azioni.

La regola: **in un giro agentico, quello che il modello DICE di aver fatto si
confronta con le azioni che ha davvero emesso in quel turno. Una dichiarazione
senza azione non si consegna all'utente.**

Due gradini, e sono diversi per prezzo:

1. **Il rimbalzo** costa una chiamata e non si vede. La risposta torna al
   modello con dentro la sua stessa frase e le tre uscite: chiama lo strumento
   adesso, oppure scrivi che era già fatto prima, oppure riscrivi la risposta
   senza dirlo fatto. Una volta sola per turno: due rimbalzi di fila vogliono
   dire che il modello insiste, e un ciclo costa all'utente l'attesa.
2. **L'avviso** costa la fiducia, quindi scatta solo dopo il rimbalzo e solo se
   la dichiarazione non la regge nemmeno un turno precedente della stessa
   conversazione. Dice cosa NON è successo («la sveglia non c'è»), non cosa è
   andato storto: all'utente serve sapere che la sveglia non suonerà.

Il riconoscimento sta in `src/shared/azioniDichiarate.js`, logica pura, una
famiglia per tipo di azione. Due scelte tengono basso il numero di falsi
allarmi, e si perdono facilmente riscrivendo le espressioni:

- **solo la prima persona al passato** («ho messo», «ti ho aperto»). Lo STATO
  che arriva al modello contiene le sveglie e i timer attivi: «la sveglia delle
  7 è impostata» è una constatazione vera, e un participio da solo la
  scambierebbe per una rivendicazione;
- **niente negazioni e niente ipotesi**: si guarda la proposizione che precede
  la frase, e «non ho messo nessuna sveglia» o «se ho aperto la pagina
  sbagliata» non contano.

I tipi che reggono una famiglia sono generosi apposta: basta un'azione
plausibilmente collegata nel turno perché la frase sia coperta. Quando
un'azione c'è, l'utente la vede nel diario del lavoro e giudica da sé; il
presidio serve al caso in cui nel turno non c'è NIENTE.

Il cugino di questa regola è [Una promessa fatta all'utente non può dipendere
dal modello](una-promessa-fatta-allutente-non-puo-dipendere-dal-modello.md):
lì è l'app che promette e il codice che deve mantenere, qui è il modello che
dichiara e il codice che deve verificare. Stessa radice: un invariante non può
dipendere dall'umore di un LLM.

Il giro sta in `handleFiloChat` (`src/main/services/handlers.js`), l'avviso
sotto la bolla in `src/pages/dashboard/dashboard.js`.
