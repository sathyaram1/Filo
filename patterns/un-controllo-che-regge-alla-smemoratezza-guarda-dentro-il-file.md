# Un controllo che regge alla smemoratezza guarda DENTRO il file, non il nome

[← Tutti i pattern](../PATTERNS.md)

Il repo ignorava già le prove usa-e-getta dei giri di verifica: bastava che il
nome cominciasse con `_verify` o `_vcheck`. Per mesi nessuno ha scritto il
trattino basso. Sessantadue prove nate per controllare un solo fix sono entrate
nella suite completa, una alla volta, e ognuna riapre Filo: il feedback #510 le
ha contate quando la suite si era già allungata di minuti.

La prima cura è stata un elenco di prefissi più lungo (`verify-`, `verifier-`,
`vfx-`, `vtmp-`…). È lo stesso difetto con più casi: chi battezza il file in un
modo nuovo passa liscio, e il controllo si accorge solo dei nomi che qualcuno
ha già sbagliato in passato.

**La regola: se un controllo esiste per reggere alla smemoratezza di chi
scrive, non può appoggiarsi a una scelta di chi scrive.** Il nome del file è
una scelta. Il contenuto no:

- una prova senza nessun `expect`/`assert` non può diventare rossa: riapre
  l'app, stampa qualcosa e basta;
- una prova che nella sua intestazione dice di sé «throwaway», «TEMP»,
  «temporaneo» sta dichiarando di essere di passaggio.

Chi scrive quelle righe le scrive sempre, perché servono a lui. Sono il
segnale che non dipende dalla memoria.

## Il rovescio: un controllo sul contenuto accusa anche gli innocenti

La prima stesura cercava «da cancellare» in tutta l'intestazione, e ha
accusato una prova vera del disegno sulla finestra, che spiegava perché
compare il bottone «Cancella disegno». Un controllo sul contenuto va legato al
punto in cui un file **dice cos'è**: qui le prime due righe dell'intestazione.
Più giù si parla di quello che fa Filo, e le parole sono le stesse.

Conta perché questa sentinella gira anche nel cancello che pubblica: un falso
rosso lì non è un fastidio, è una versione che non esce.

## Dov'è

`tests/helpers/proveDeiGiri.mjs` (il riconoscitore, provato su sorgenti finti
in `tests/unit/proveDeiGiri.test.mjs`, che è anche la sentinella). L'elenco dei
prefissi storici resta, ma solo per dare un messaggio migliore sui nomi noti:
le due regole sul contenuto reggono da sole.
