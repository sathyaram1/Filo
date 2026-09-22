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
compare il bottone «Cancella disegno». La cura di allora — leggere solo le
prime due righe — era un altro tetto arbitrario, e lasciava passare chi si
dichiarava sulla terza (la guida ne concede tre). La cura vera separa le
parole che non hanno bisogno di contesto («throwaway», «usa-e-getta», «delete
after», «TEMP») da quelle che ce l'hanno: «temporaneo» conta solo se in quella
riga si parla di una prova, di uno spec o di un file — Filo ha cose
temporanee sue, e una prova vera le racconta.

Conta perché questa sentinella gira anche nel cancello che pubblica: un falso
rosso lì non è un fastidio, è una versione che non esce.

## L'altro rovescio: il controllo guardava meno di quello che la suite lancia

L'elenco dei file su cui decidere era scritto a mano, e diceva `.spec.mjs`
mentre il raccoglitore della suite prende anche `.spec.js`. Una prova di
passaggio che si dichiarava tale e non conteneva nessun controllo restava
dentro per sempre: bastava battezzarla con l'altra estensione. È lo stesso
difetto dei prefissi, un piano più in là — **un controllo che sorveglia un
insieme non se lo ridisegna: se lo fa dare da chi quell'insieme lo costruisce**
(qui `testDir`, `testMatch` e `testIgnore` del raccoglitore, riusati tali e
quali), e se quelle regole non ci sono più diventa rosso invece di guardare il
vuoto e passare.

## Dov'è

`tests/helpers/proveDeiGiri.mjs` (il riconoscitore, provato su sorgenti finti
in `tests/unit/proveDeiGiri.test.mjs`, che è anche la sentinella). L'elenco dei
prefissi storici resta, ma solo per dare un messaggio migliore sui nomi noti:
le due regole sul contenuto reggono da sole.
