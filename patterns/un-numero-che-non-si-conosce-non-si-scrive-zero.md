# Un numero che non si conosce non si scrive zero

[← Tutti i pattern](../PATTERNS.md)

Una superficie che mostra conteggi distingue tre stati, non due: **il dato c'è**,
**il dato è zero**, **il dato non è arrivato**. Il terzo non si scrive «0»: si
scrive «—» e accanto si dice perché.

- **Perché:** «0 feedback ricevuti negli ultimi 30 giorni» è una risposta, e chi
  la legge la crede. Se in realtà la lista non si è caricata, quella riga afferma
  il contrario di quello che è successo, e non c'è niente nella pagina che lo
  smentisca. Lo zero è la bugia più credibile che una statistica possa dire,
  perché è anche il valore vero più comune.
- **Le strade sono più di una, e vanno chiuse tutte.** Il dato manca quando il
  caricamento è fallito, ma anche mentre sta ancora arrivando (chi apre la
  scheda un secondo dopo essere entrato vede lo stato «vuoto» prima che i dati
  atterrino) e quando il dato c'è ma questo computer non lo sa leggere (in Filo
  i documenti dei feedback viaggiano cifrati: senza la chiave, contarli come
  «zero giri di verifica» li fa sparire in silenzio). Le tre strade producono lo
  stesso zero falso: si chiudono insieme.
- **Le tre strade non bastano se la regola gira solo all'apertura.** Il dato
  cambia mentre la superficie è già aperta, e questi tre stati si scambiano
  proprio lì: chi apre la scheda un secondo dopo essere entrato la vede dire «i
  dati non ci sono» e ce la vede restare anche dopo che i dati sono arrivati.
  Nel verso opposto è peggio: la scheda che aveva i suoi numeri, dopo un
  caricamento andato male, continua a scriverli come se avessero ancora
  qualcosa sotto. Il ridisegno lo deve chiamare chi TOCCA i dati, non chi apre
  la vista. Vedi ["Vai a guardare in quell'altro posto": quel posto deve
  accorgersene DA APERTO](vai-a-guardare-in-quellaltro-posto-quel-posto.md).
- **Le fonti diverse si trattano separatamente.** Se un numero viene da
  un'altra sorgente e QUELLA è arrivata, il suo numero resta: spegnere tutta la
  pagina per un dato mancante ne butta via altri che si conoscono.
- **Un numero parziale lo dichiara accanto a sé.** Se la fonte tiene solo le
  voci recenti (un registro cappato, una lista che si ferma ai primi N), il
  numero è un MINIMO: la frase che lo dice va scritta anche, e soprattutto,
  nella finestra «Sempre», dove il numero è più lontano dal totale. Vedi
  [Contare eventi scritti in prosa: il test chiama chi li scrive](contare-eventi-scritti-in-prosa-il-test-chiama-chi-li-scrive.md).
- **Dove:** la scheda «Statistiche feedback» della dashboard di gestione
  (`src/pages/manage/manage.js`, `stRender`) e i conteggi delle schede in cima
  alla stessa pagina, che infatti quando il dato manca il numero non lo scrivono
  affatto. Il conto delle segnalazioni illeggibili lo restituisce
  `src/shared/feedbackStats.js` (`loop.nonLeggibili`, `illeggibili`).
- **Come si prova:** lo stato di guasto si CHIEDE alla pagina invece di
  affidarsi al fatto che nei test la rete non c'è
  (`window.__mgTest.simulaCaricamentoFallito()`), così il controllo vale uguale
  sulla macchina di chi sviluppa, dove la rete invece c'è.
