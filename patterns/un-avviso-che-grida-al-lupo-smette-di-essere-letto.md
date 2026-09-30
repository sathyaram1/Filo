# Un avviso che grida al lupo smette di essere letto

[← Tutti i pattern](../PATTERNS.md)

Un avviso di sicurezza vale quanto la fiducia che ha addosso. Se compare sui
link di tutti i giorni, l'utente impara a scavalcarlo in un decimo di secondo —
e lo scavalca anche la volta che contava. Il falso allarme non è un fastidio
minore del mancato allarme: costa di più, perché spegne il canale.

Il caso (#725). L'avviso sul link nel menu del tasto destro nasceva da tre
controlli sull'indirizzo, e due erano tarati troppo larghi:

- il nome del parametro bastava a dichiarare una chiave d'accesso, e `t=` è il
  segnatempo di qualunque video;
- il confronto coi nomi famosi correva su TUTTO l'indirizzo con due lettere
  fisse di tolleranza: `gitlab.com` «imitava» `github.com`, `t.co` e ogni
  indirizzo di due lettere «imitavano» `x.com`, `amazon.de` «imitava»
  `amazon.it`.

Entrambi sono rientrati a due giri di distanza, dalla stessa causa vista da
porte diverse.

## La regola

**Una soglia fissa su una misura che cambia scala è un falso allarme che
aspetta.** Due lettere di differenza su `microsoft` sono un errore di battitura;
sulla `x` di `x.com` sono un altro sito. La tolleranza si calcola dalla
lunghezza di ciò che si confronta, e sotto una certa lunghezza non si indovina
affatto.

**Si confronta la cosa, non il contorno.** Il nome del sito, non l'indirizzo
intero. Che `amazon.de` sia Amazon e `amazon.shop` no non lo dice il nome: lo
dice l'elenco dei domini ufficiali di ciascun marchio (#725.8). Prendere per
vero ogni nome famoso su qualunque dominio di primo livello lasciava passare
`paypal.support`.

**Due avvisi sulla stessa cosa danno lo stesso giudizio.** L'avviso sul link
del tasto destro e quello all'apertura della pagina chiedono al motore lo
stesso verdetto sul marchio, con un elenco solo di marchi e domini ufficiali.
Con due elenchi, un link è pulito nel menu e sospetto quando lo apri, e chi
legge smette di credere a tutti e due.

**Un elenco solo vale quanto quello che sa.** Dare al menu il giudizio
dell'apertura gli ha passato anche i suoi falsi allarmi (#725.8, giro 1):
`revolut.me` e `apple.co` sono indirizzi ufficiali che l'elenco non conosceva,
`mail.com`, `post.ch`, `cloud.it` e `imposte.it` sono parole vere a una lettera
da un marchio o con un marchio dentro, e all'apertura venivano bloccati come
pericolosi. Ogni marchio porta tutti i suoi indirizzi ufficiali; le parole vere
vicine ai marchi stanno in un elenco, ricavato dalle parole più usate in italiano
e in inglese, e una parola vale solo dove sta: non scavalca un trattino e non
copre il nome attaccato accanto (`risposte-poste`). Una sigla di tre lettere non
basta da sola a nominare un marchio (`bnl.gov`). Il nome di un sistema pubblico
lo usano per mestiere anche altri: le pagine d'accesso SPID stanno sui domini
dei gestori accreditati (`spid.register.it`), che il marchio elenca a parte,
senza farli entrare nella whitelist (#725.8, giro 2).

**Stringere la soglia non deve spegnere il controllo.** Quello che la soglia
più stretta perde si recupera con un segnale più preciso, non allargandola di
nuovo: le lettere che a occhio ne valgono un'altra (`paypa1`, `micros0ft`,
`arnazon`) si riconoscono normalizzandole, e lì la prova è l'uguaglianza, non
una distanza.

**Ogni frase ipotizza, nessuna afferma.** Il controllo guarda l'indirizzo, non
il sito: «potrebbe essere un'imitazione» si può dire, «chi lo riceve entra al
posto tuo» no.

## Dove

`src/shared/linkSospetto.js` (euristica e frasi), mostrato da
`src/content/actions.js` nella sezione inline del link. Il giudizio sul marchio
lo dà `imitazione()` in `src/main/services/safebrowse/engine.js`, coi marchi e
le parole vere di `brands.js`; un link che passa da un rinvio si giudica anche per
l'indirizzo scritto nel rinvio. Le soglie e i casi
— quelli che devono scattare e quelli che non devono — stanno in
`tests/unit/linkSospetto.test.mjs`: un controllo nuovo aggiunge la sua coppia
di elenchi lì, il falso allarme prima del vero positivo.
