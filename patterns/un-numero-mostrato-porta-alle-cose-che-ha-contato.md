# Un numero mostrato porta alle cose che ha contato

[← Tutti i pattern](../PATTERNS.md)

Ogni conteggio visibile è un pulsante: cliccandolo si vede **l'elenco delle cose
che ha contato**, e da lì si arriva a ciascuna. Un numero da cui non si può
scendere è un vicolo cieco.

- **Perché:** «In coda: 12» risponde a una domanda e ne apre subito un'altra,
  «quali dodici?». Se la risposta non c'è, chi guarda deve cambiare pagina e
  ricostruire a mano il filtro che il numero applicava già: è attrito puro, e
  l'attrito risolvibile va risolto (`filo_filosofia.txt`). Vale per le righe di
  una ripartizione, per le fette di un grafico e per le voci di una legenda: se
  un elemento rappresenta delle cose, si apre su quelle cose.
- **Gli identificativi li dà chi conta, non chi disegna.** La funzione pura che
  produce i conteggi restituisce, per ogni gruppo, gli id di ciò che ci sta
  dentro (`ids`). Ricostruirli nella pagina rifacendo il filtro vorrebbe dire
  tenere due copie della stessa regola, che prima o poi divergono e mostrano un
  elenco che non combacia col numero sopra.
- **Se le cose contate non sono quelle della pagina, si porta dove sono.** Un
  numero che conta esecuzioni, non segnalazioni, non apre un elenco di
  segnalazioni: manda alla superficie dove quelle esecuzioni si leggono davvero.
- **L'elenco ha un tetto, e il tetto si dichiara.** Oltre qualche centinaio di
  voci l'elenco dentro un pannello non si sfoglia più: si mostrano le prime e si
  scrive quante ne restano fuori, mai un taglio muto (CLAUDE.md § Limiti).
- **Le stesse azioni anche col tasto destro.** Aprire l'elenco col clic
  sinistro è la scorciatoia; il tasto destro è dove si va a cercare cosa si può
  fare con un numero, e lì stanno anche le azioni che un clic solo non può
  offrire (copiare la riga, portare il numero altrove, restringere la finestra a
  quel periodo). Vedi [Menu contestuale proprio nelle pagine filo://](menu-contestuale-proprio-nelle-pagine-filo-preventdefault.md).
- **Dove:** la scheda «Statistiche feedback» della dashboard di gestione
  (`stRowsHtml`, `stItemsHtml`, `stApriFeedback` in
  `src/pages/manage/manage.js`); gli id per gruppo li calcola
  `src/shared/feedbackStats.js`.
