# Un grafico nel tempo disegna anche i periodi vuoti

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Un grafico il cui asse è il tempo disegna una colonna per ogni
periodo della finestra scelta, anche per i periodi in cui non è successo
niente. Le colonne si ricavano dalla finestra, non dai dati. Un periodo a zero
resta una tacca sulla linea di base, e non è cliccabile: dietro non ha niente
da aprire.

## Il caso che l'ha fatta nascere

La scheda «Statistiche feedback» (#496) ha un grafico «Quando sono arrivati».
Le colonne nascevano raggruppando le segnalazioni per giorno e prendendo le
chiavi che ne uscivano: solo i periodi con qualcosa dentro, accostati uno
all'altro.

Con la finestra a novanta giorni e due segnalazioni arrivate la prima settimana
e una l'ultima, uscivano **due colonne appiccicate, larghe uguali**, e si
leggevano come due settimane di fila. In mezzo c'erano tre mesi di niente, e
non si vedevano. Intanto la riga sotto il titolo scriveva «Una colonna per
settimana»: le settimane della finestra erano tredici, le colonne due.

Il danno non è estetico. Un grafico degli arrivi serve a rispondere a «quando
sono arrivati», e quella forma risponde a «in che ordine», che è un'altra
domanda. Due punte lontane e due punte vicine escono identiche.

## Le due cose che si rompono insieme

1. **Il silenzio sparisce.** Un periodo senza dati e un periodo che non esiste
   diventano indistinguibili.
2. **L'asse mente due volte.** La data di fine è scritta in fondo a destra
   sotto il grafico, ma l'ultima colonna resta dove l'ha lasciata il conteggio:
   con poche colonne, a metà riquadro, lontanissima dall'etichetta che la
   riguarda. Se le colonne hanno anche un tetto di larghezza, il grafico si
   ferma a un terzo del suo spazio e lascia il resto bianco (è successo anche
   questo, e per due giri è stato segnalato come difetto a sé).

## Come si fa

- Il passo (giorno, settimana, mese, anno) si sceglie sulla **lunghezza della
  finestra**, così le colonne restano un numero leggibile. In `feedbackStats.js`:
  giorni fino a due mesi, settimane fino a un anno e mezzo, mesi fino a dieci
  anni, poi anni.
- Le chiavi si generano **camminando dall'inizio alla fine della finestra**, non
  leggendole dai dati (`chiaviDelPeriodo`). Un dato fuori dagli estremi
  dichiarati allarga il disegno invece di sparire.
- Il tetto di larghezza della colonna serve solo quando le colonne sono
  pochissime, se no un periodo solo diventa un blocco a tutta pagina: si accende
  con una classe sotto una certa soglia, non sempre.
- La riga che dichiara la scala («una colonna per settimana») diventa vera, e
  può restare.

## Dove guardare

- `src/shared/feedbackStats.js`: `serieTemporale`, `chiaviDelPeriodo`,
  `passoDopo`.
- `src/pages/manage/manage.js`: `renderFsTrend`.
- `tests/unit/feedbackStats.test.mjs`: «il grafico disegna una colonna per ogni
  periodo della finestra, vuoti compresi».
- `tests/manage-statistiche-feedback.spec.mjs`: «il grafico degli arrivi
  disegna anche i periodi vuoti, e riempie il suo riquadro».
