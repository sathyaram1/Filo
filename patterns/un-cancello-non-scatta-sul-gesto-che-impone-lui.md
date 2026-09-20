# Un cancello non scatta sul gesto che impone lui

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Certi controlli obbligano a un gesto prima di lasciar passare:
segnare un rosso atteso, aggiornare un file di stato, rigenerare un elenco.
Quel gesto non deve farli scattare. Il controllo si lega a **quello che gira**,
non alla punta del ramo. Si confronta il contenuto ridotto a ciò che decide, e
se lì non è cambiato niente il verdetto regge.

## Il caso

Il giro di verifica locale, quando un rilievo resta aperto perché il bilancio è
esaurito, dice «si può pubblicare» e lascia rosse le prove del giro che quel
rilievo lo riproducono. La chiusura del ramo quelle prove le rilancia, e si
ferma. La mossa giusta è segnarle come rosso atteso (`test.fail`) e
committarle — ma quel commit spostava la punta del ramo dopo il verdetto, e il
verdetto era legato allo sha: la chiusura rispondeva «il codice è cambiato dopo
la verifica» e ci voleva un giro intero, di un'altra istanza, per riverificare
un ramo in cui era cambiata una riga di test.

Il cancello chiedeva un gesto e poi puniva chi lo faceva. È costato due giri,
mezz'ora e un'istanza l'uno, prima che diventasse un feedback (#661).

## Cosa non ha funzionato

**Scrivere i marcatori prima del verdetto** sposta il problema: chi verifica
sa quali rilievi restano fuori solo *dopo* che lo strumento ha fatto i conti coi
bilanci. Il gesto viene dopo per costruzione.

**Leggere le righe del diff una per una** («è una riga che comincia per
`test.fail`?») si rompe sulle forme legittime: il marcatore sulla
dichiarazione, il motivo che va a capo, il commento scritto accanto. E si rompe
anche dall'altra parte, quella pericolosa: un marcatore con una virgoletta
dimenticata lascia le tonde aperte e si mangia il corpo della prova, che a quel
punto può cambiare senza che nessuno se ne accorga.

## Come si fa

Dai due contenuti si tolgono righe vuote, commenti e marcatori. Quello che
resta è **ciò che fa girare la prova**, e si confronta. Se è uguale il verdetto
regge, e chi pubblica legge quali file sono passati. Se è diverso, o se anche un
solo file sta fuori dalla cartella delle prove del giro, decade come prima.

Tre paletti, e nessuno è di gusto:

- si perdona solo ciò che **non cambia cosa succede**, cioè un commento, una
  riga vuota, un marcatore. Una riga commentata via non è perdonata. Quello che
  c'era prima sparisce dal confronto, ed è il modo più facile di spegnere una
  prova;
- ciò che non si riconosce come marcatore intero **resta una riga come le
  altre**. Meglio un verdetto che decade di uno che tollera una riga di codice
  inghiottita da un marcatore scritto male;
- quando il cancello si apre più largo del solito, **lo dice**: un cancello che
  si apre in silenzio è indistinguibile da un cancello che non c'è.

E la parte che non si muove: una prova del giro rossa **senza** marcatore ferma
la chiusura esattamente come prima. Il verdetto tollera il gesto, non il rosso.

Il codice sta in `scripts/verify-local.mjs` (`corpoSenzaMarcatori`,
`soloMarcatori`, `checkVerdict`), i casi in
`tests/unit/verifyLocalMarcatori.test.mjs`.

Vicino: [Un controllo che RIFIUTA non rifiuta mai in silenzio (e si può scavalcare)](un-controllo-che-rifiuta-non-rifiuta-mai-in-silenzio.md).
