# Quello che il server scrive da sé esce comunque

[← Tutti i pattern](../PATTERNS.md)

Quando si toglie da un documento condiviso tutto ciò che identifica chi l'ha
scritto, l'elenco dei campi da togliere non è l'elenco dei campi che **tu**
scrivi. È l'elenco di quelli che **arrivano a chi legge**, e il server ne
aggiunge di suoi. Su Firestore ogni documento porta `createTime` e `updateTime`,
al microsecondo, e tornano in ogni risposta: nessuna regola li nasconde, nessun
client li può non scrivere.

Il caso (#584, secondo giro di verifica). L'audit aveva chiesto di togliere il
`clientId` dai percorsi condivisi dell'assistente di pagina, perché con quello
si rimettevano in fila i percorsi della stessa persona su domini diversi. Il
`clientId` è uscito, la data nel documento è stata arrotondata all'ora apposta,
e la pagina della privacy prometteva agli utenti che non restava niente da
ricucire. Ma un percorso partiva nell'istante in cui lo facevi: due percorsi su
due domini diversi con `createTime` a 0,9 secondi di distanza erano la stessa
persona nella stessa sessione, e uno di ore dopo si distingueva. La chiave di
join non era più un codice, era l'orologio; misurata con l'emulatore vero.

Le tre mosse, in ordine di forza:

- **Far leggere il server.** Se la lettura passa da una funzione che restituisce
  i campi che decide lei, la metadata del documento non esce, e il problema è
  chiuso all'origine. È la strada di `redteam-attempts`. Costa una funzione da
  scrivere e da mantenere, e va scelta quando i dati lo meritano.
- **Staccare il momento della scrittura da quello dell'evento.** Se la lettura
  resta diretta, `createTime` esce comunque: allora deve dire una cosa che non
  serve a nessuno. Il percorso entra in una coda sul disco con un'ora di uscita
  sorteggiata nelle ore successive, e la coda ne manda fuori uno alla volta a
  intervalli anch'essi sorteggiati. Due eventi della stessa sessione escono a
  ore di distanza, in ordine qualsiasi, mescolati a quelli di chiunque altro.
  Funziona perché nessuno aspetta quella scrittura: è roba che servirà ad altri
  più tardi. Su un'azione che l'utente sta guardando non si può fare.
- **Allargare il secchio delle date che scrivi tu.** Arrotondare al giorno
  invece che all'ora. Da solo non basta mai (il server ha la sua marca), ma
  senza, la marca esatta ce l'hai due volte.

Il tranello da cui guardarsi: **svuotare la coda tutta insieme rifà il danno**.
Se l'app resta chiusa una settimana e alla riapertura la coda parte in blocco,
gli eventi di quella sessione tornano a millisecondi l'uno dall'altro,
nell'ordine in cui sono successi. Un flush manda fuori **un** elemento, scelto a
caso fra quelli maturi, e poi aspetta.

La domanda da farsi, ogni volta che si toglie un identificatore: *cosa resta che
vari insieme alla persona?* L'orario è il sospetto numero uno, perché non lo
scrivi tu e quindi non compare nella lista dei campi che stai guardando.

Dove vive: `src/main/services/pathsCollector.js` (la coda che ritarda),
`src/shared/paths.js` (`giornoArrotondato`), `tests/unit/pathsRitardo.test.mjs`
(la sentinella sempre accesa), `tests/verifica/584/giro1-createtime-motore-vero.mjs`
(la prova del difetto, con l'emulatore vero).
