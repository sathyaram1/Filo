# Un cancello non scatta sul gesto che impone lui

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Certi controlli obbligano a un gesto prima di lasciar passare:
togliere le prove dei rilievi usciti in un feedback loro, aggiornare un file di
stato, rigenerare un elenco. Quel gesto non deve farli scattare. Il controllo si
lega a **quello che gira**, non alla punta del ramo, e perdona solo il gesto
che impone — con la stessa regola in ogni cancello che lo guarda.

## Il caso

Il giro di verifica, quando un rilievo resta fuori dal giro, dice «si può
pubblicare» e manda a togliere dal ramo la prova del giro che lo riproduce (il
rilievo vive nel feedback appena nato). Quel commit sposta la punta del ramo
dopo il verdetto, e il verdetto era legato allo sha: la chiusura rispondeva «il
codice è cambiato dopo la verifica» e ci voleva un giro intero, di un'altra
istanza, per riverificare un ramo in cui non era cambiata una riga di prodotto.

Il cancello chiedeva un gesto e poi puniva chi lo faceva. È costato due giri,
mezz'ora e un'istanza l'uno, prima che diventasse un feedback (#661). Allora il
gesto era segnare la prova come rosso atteso; dal 23/09/2026 è toglierla.

## Cosa non ha funzionato

**Scrivere il gesto prima del verdetto** sposta il problema: chi verifica sa
quali rilievi restano fuori solo *dopo* che lo strumento ha fatto i conti coi
bilanci. Il gesto viene dopo per costruzione.

**Due cancelli con due regole.** Il cancello locale riduceva i due contenuti a
«ciò che gira» (via commenti, righe vuote e marcatori di rosso atteso) e li
confrontava; quello di fusione del server ammetteva solo righe tolte. Il primo
lasciava passare un marcatore che il secondo rifiutava, e rifiutava un caso
tolto da una prova che il secondo accettava — proprio la mossa che il testo del
pass chiedeva (verifica del giro 2 sul lavoro «seguito del giro»).

## Come si fa

Dopo il verdetto, dentro `tests/verifica/`, si può solo **togliere**: un file
intero, o delle righe (un caso) da un file. Il contenuto nuovo di ogni file
toccato dev'essere il vecchio con qualche riga in meno, nello stesso ordine;
qualunque riga aggiunta o cambiata — anche un commento o un marcatore — fa
decadere il verdetto, e il marcatore va nel commit di una correzione, prima del
verdetto. Un file fuori dalla cartella lo fa decadere sempre.

Tre paletti, e nessuno è di gusto:

- **la stessa regola in ogni cancello**: la chiusura locale e il cancello di
  fusione del server devono dire sì e no alle stesse cose, o il gesto giusto su
  una strada è una trappola sull'altra;
- **fail-closed**: un diff illeggibile, un file svuotato o uno che git dice
  modificato ma non si legge non sono una cancellazione;
- quando il cancello si apre più largo del solito, **lo dice**: un cancello che
  si apre in silenzio è indistinguibile da un cancello che non c'è.

Il codice locale sta in `scripts/verify-local.mjs` (`soloRigheTolte`,
`soloProveTolte`, `checkVerdict`), i casi in
`tests/unit/verifyLocalMarcatori.test.mjs`.

Vicino: [Un controllo che RIFIUTA non rifiuta mai in silenzio (e si può scavalcare)](un-controllo-che-rifiuta-non-rifiuta-mai-in-silenzio.md).
