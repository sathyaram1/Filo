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
- **Un numero che conta EVENTI apre le cose su cui sono successi.** «Riaperture
  chieste: 5» conta eventi, e cinque eventi possono stare su tre segnalazioni:
  il numero resta 5 e l'elenco ne mostra tre. Le due cose non combaciano di
  proposito, quindi il suggerimento della riga lo dice invece di lasciar credere
  a un elenco troncato.
- **Nessuna riga è esente perché sta in fondo.** Le ultime sezioni di una
  scheda sono quelle scritte per ultime, ed è lì che la regola salta: le righe
  delle priorità e i due contatori della coda restavano vicoli ciechi mentre
  ogni altra riga della stessa scheda si apriva, e proprio «priorità alta: 2» è
  il posto dove la domanda «quali due?» viene per prima.
- **Due grafici gemelli si comportano uguale.** Disegnati identici e messi
  fianco a fianco, promettono la stessa cosa: se le fette di uno si aprono e
  quelle dell'altro no, la differenza si scopre solo cliccando e non ottenendo
  niente. «Fermate (fail): 3» è la voce da cui la domanda «quali tre?» parte per
  prima. Anche la frase che dice «si apre» va scritta in un posto solo, appesa
  al suggerimento della fetta: ripetuta dentro ogni suggerimento su misura,
  mancava proprio dove il suggerimento c'era.
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
