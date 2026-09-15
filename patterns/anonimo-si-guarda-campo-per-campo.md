# Anonimo si guarda campo per campo, non a colpo d'occhio

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Quando un documento diventa pubblico, la domanda «dice chi è stato?»
si fa a OGNI campo, uno alla volta, e la pulizia si applica a tutti quelli che
vengono dalla pagina o dall'utente. Un campo che nessuno ha guardato è il campo
che dice chi sei.

## Il caso

L'audit pre-alpha (#584) chiedeva di togliere dai percorsi condivisi
dell'Aiuto il codice del mittente: con quello si rimettevano insieme i percorsi
della stessa persona su siti diversi. Fatto. Poi il giro dopo ha tolto anche
l'orologio, che faceva la stessa cosa da solo.

Al terzo giro il percorso diceva ancora chi era stato, e da un campo che nessuno
aveva messo in discussione: la **pagina di partenza**. Usciva com'era.
`/u/mario.rossi/ordini/847362`. Un nome utente è lo stesso su più siti: come
chiave di join è più forte di quella appena chiusa, e in più dà un nome alla
persona.

Il pezzo che fa male è l'asimmetria. Dentro lo STESSO percorso, la stessa email
e lo stesso numero scritti nell'etichetta di un pulsante uscivano sostituiti
(`[EMAIL]`, `[NUMERO]`), perché i selettori avevano una pulizia. L'indirizzo no,
perché quando si era scritta quella pulizia si stava pensando ai selettori.

E c'era una seconda illusione di copertura: il codice dichiarava che «due LLM
impediscono che dati raw dell'utente finiscano qui dentro». Guardando cosa
vedevano davvero: il primo produce la frase dell'intento (e gli si chiede di non
copiarci dentro dati personali), il secondo confronta quella frase con quello
che l'utente aveva scritto in chat. Nessuno dei due guardava il documento che
stava per uscire.

## Come si fa

- **Elenca i campi che escono** e, per ciascuno, di' da dove viene il contenuto.
  Se viene dalla pagina, dall'URL o dall'utente, va ripulito. Se viene da un
  modello, va ripulito lo stesso: un modello ripete quello che ha davanti.
- **Una pulizia sola, usata da tutti i campi.** Se le forme che riconosce
  (email, codici, soprannomi, numeri lunghi) sono scritte in un posto solo,
  aggiungerne una vale per tutto il documento. Due pulizie separate divergono al
  primo ritocco.
- **Per l'URL, tieni la sezione e butta l'identità.** Un indirizzo si affetta in
  segmenti: i segmenti-parola dicono in che punto del sito sei e restano; tutto
  il resto è un segnaposto. Sui siti dove il nome utente è il PRIMO pezzo
  dell'indirizzo, senza niente che lo annunci, il marcatore è il sito stesso: lì
  il primo segmento è sempre una persona.
- **Dopo un marcatore di persona, la domanda è sulla POSIZIONE della parola, non
  sul segmento.** Dietro `/u/`, `/user/`, `/clienti/` il nome è scritto a lettere
  e nessuna forma lo tradisce, ma lì stanno anche le sezioni dell'area personale,
  e hanno la stessa forma: `rossi-fatture` e `fatture-elettroniche` sono tutte e
  due due parole attaccate da un trattino. Le due domande sul segmento intero
  sbagliano in direzioni opposte, e l'abbiamo pagato un giro per ciascuna: se
  basta UNA parola da sezione a salvarlo esce il cognome accanto; se devono
  esserlo TUTTE spariscono quasi tutte le sezioni vere. Quella che regge è: il
  segmento tiene le parole da sezione FINCHÉ ne trova, e dalla prima parola che
  non lo è in poi resta un segnaposto. Il nome finisce sempre dalla parte del
  segnaposto, perché apre il segmento e si porta via ciò che lo segue.
- **Quello che le forme non prendono, gli occhi di un modello sì.** Un nome
  scritto a lettere («Profilo di Mario Rossi») è indistinguibile dal testo di un
  pulsante per qualunque espressione regolare. Se nella pipeline un modello gira
  già, fagli vedere IL DOCUMENTO CHE STA PER USCIRE e lascia che dica no: non
  costa una chiamata in più, e la frase «ci pensano i modelli» smette di essere
  un'illusione. E controlla che lo veda DAVVERO, nel testo che parte: qui i due
  campi si perdevano fra chi li mandava e chi scriveva la domanda, con un test
  verde per parte (vedi
  [Due estremi verdi non fanno un filo](due-estremi-verdi-non-fanno-un-filo.md)).
  E ricordati che da quel momento quel modello è l'UNICA difesa per quella
  categoria di dati: il testo che gli metti davanti lo scrive il sito, quindi va
  appiattito e dichiarato prima di entrare nella domanda, o la guardia si
  convince a parole (vedi
  [Un modello che fa da guardia legge testo di terzi](un-modello-che-fa-da-guardia-legge-testo-di-terzi.md)).
- **Il campo che fa anche da indirizzo non si ripulisce: si rifiuta.** Al sesto
  giro restava fuori il NOME DEL SITO, che è la quarta cosa pubblicata e l'unica
  che non si possa riscrivere: è il segmento del percorso Firestore sotto cui il
  documento vive, quindi cambiarlo vuol dire metterlo dove nessuno lo cercherà.
  Su `mariorossi.github.io` quel nome è un nome e cognome; su un'intranet è il
  datore di lavoro. Quando un campo è insieme dato e indirizzo, il bivio è
  binario: o esce com'è, o il documento non si scrive. Quindi si taglia prima la
  famiglia che non serve a nessuno (gli indirizzi che non portano fuori da casa
  di chi naviga: numerici, di una parola sola, coi suffissi di rete locale, e le
  pagine interne dell'app dove la stessa funzione si apre con lo stesso tasto) e
  il resto lo decide il modello. Il segnale di allarme era scritto nel prompt
  stesso: la sua regola contava TRE parti pubblicate mentre le cose pubblicate
  erano quattro. Quel numero, quando c'è, va tenuto in pari con l'elenco.
- **Il testo che l'utente legge nel momento della scelta** dice cosa viene
  pubblicato. «Ha funzionato? Aiutami a migliorare» sembra un parere privato a
  chi scrive l'app; la pagina che spiega la privacy non la apre nessuno prima di
  premere un pollice in su. E quando le promesse diventano quattro, sparse su
  quattro superfici, un campo scoperto le fa mentire tutte insieme.

## Nel codice

- `src/shared/pathsSafety.js` — `redigiPercorso` (i segmenti dell'indirizzo, con
  le tre regole: la parola che annuncia una persona, il primo pezzo sui siti col
  nome in testa, le forme che identificano), `redactSelector` (le forme dentro i
  nomi degli elementi) e `sitoCondivisibile` (i siti che non sono di nessuno, e
  che quindi non si raccolgono e non si leggono). Sta nel modulo condiviso perché
  la stessa pulizia la riapplica il server prima di scrivere.
- `src/main/services/pathsCollector.js` — il rifiuto che arriva PRIMA dei due
  modelli, e il giudice che riceve `domain`, `initialUrl` e `steps`, cioè quello
  che verrebbe pubblicato.
- `src/shared/constants.js` — `PROMPTS.helpIntentJudge`: il giudice vede le
  quattro parti che verrebbero pubblicate, sa quando il nome del sito è un motivo
  per rifiutare, e i segnaposto sono dichiarati per non farlo rifiutare quello
  che è già pulito.
- `tests/unit/pathsRaccolta.test.mjs` — le guardie: cosa resta dell'indirizzo,
  cosa vede il giudice, quali siti non si raccolgono.
- `tests/aiuto-percorso-sito-di-nessuno.spec.mjs` — che il rifiuto arrivi prima
  delle due chiamate, che si pagano.
