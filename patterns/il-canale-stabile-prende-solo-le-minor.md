# Il canale stabile prende solo le minor

[← Tutti i pattern](../PATTERNS.md)

Filo esce su due canali (#1160, SPEC-DOMANDE.md §4.2). Il **veloce** è quello di sempre: ogni sei ore
`release.yml` pubblica il commit più nuovo di main con la suite verde, come patch (x.y.z+1). Lo **stabile**
riceve una versione a settimana: la **minor** (x.y+1.0) del lunedì alle 00:00 ora italiana. L'utente sceglie in
Preferenze → Impostazioni avanzate → Aggiornamenti, o chiedendolo a Filo (`aggiornamenti.canale`, di serie
`veloce`).

## La regola: una x.y.0 è una versione stabile

Nessun segno a parte, nessun file in più nella release: è stabile una release la cui etichetta è `vX.Y.0`.
Regge perché i numeri li scrive solo il server, e la minor la chiede solo la corsa del lunedì. Se un giorno
serve una minor che non deve arrivare allo stabile (o una major a mano), questa regola va ripensata prima.
La domanda «questa versione appartiene al canale?» ha una porta sola, `nelCanale` in
`src/main/aggiornamentoRegole.js`, e la attraversano tutte le strade: lo scaricamento (`scaricaVerificata`),
la carta «Installa», l'installazione all'avvio su Windows (`decidiAllAvvio`) e quella alla chiusura (`regola`).

## Come lo stabile trova la sua release

electron-updater chiede a GitHub la release «latest», che è sempre l'ultima patch. Sul canale stabile
`agganciaCanale` (in `src/main/updater.js`) cambia solo quella risposta: legge l'elenco delle release dall'API
di GitHub, dalla più nuova, e `sceltaStabile` sceglie la minor più nuova di quella in uso che abbia il file del
canale di questo sistema (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`). Se non c'è, risponde con una
release non più nuova di quella in uso, ed electron-updater dice «già aggiornato» da sé. Tutto il resto
(il suo latest.yml, i suoi file, il cancello dei tag di #1073 e #1119) resta quello del veloce.

- Il punto agganciato è un interno di electron-updater (`GitHubProvider.prototype.getLatestTagName`). Se un
  aggiornamento della libreria lo toglie, il cancello ferma gli aggiornamenti stabili con un errore: lo
  stabile non deve mai ripiegare sull'ultima patch. La sentinella sta in `tests/unit/aggiornamentoCanale.test.mjs`.
- L'API senza credenziali regge sessanta richieste l'ora per indirizzo: Filo controlla all'avvio e quando
  glielo chiedi, e controllo e cancello si dividono la stessa risposta per un minuto.
- Una release già uscita non torna indietro: chi passa dal veloce allo stabile tiene la sua patch finché non
  esce una minor più nuova.

## Cambiare canale vale come un avvio nuovo

Quello che il canale di prima aveva trovato, chiesto o scaricato, e che nel nuovo non c'è, smette di
promettersi: la carta se ne va, il ricordo dell'installatore si cancella (Windows lo installerebbe al
prossimo avvio) e l'installazione alla chiusura si spegne finché c'è in cache una versione fuori canale. Poi
si ricontrolla subito. Le carte tolte così le ha messe Filo, e Filo le toglie del tutto (`forgetNotification`):
tornando al canale di prima ricompaiono. Quelle chiuse dall'utente restano chiuse.

## La minor del lunedì in `release.yml`

- Le corse programmate sono due, alle 22 e alle 23 UTC della domenica: una delle due è la mezzanotte di Roma
  con l'ora legale, l'altra con la solare. `scripts/minor-del-lunedi.mjs` riconosce la corsa
  (`CRON_MINOR`, uguali a quelle del workflow per sentinella) e la lascia passare solo nella finestra del
  lunedì fino alle sei, così una corsa in ritardo esce lo stesso. La seconda della notte la ferma il server:
  una minor a settimana.
- Prima di scegliere il commit si chiede il permesso al server (`releaseMinor` con `controllo: true`). Il
  server rinvia la minor se c'è un feedback di sicurezza a priorità 3 aperto (l'audit della domenica li cerca,
  le routine hanno 24 ore per chiuderli): la corsa resta verde, non esce niente e non parte nessuna domanda
  all'owner; il motivo lo registra il server per il monitoraggio. Nel registro pubblico della corsa un rinvio
  non nomina né feedback né sicurezza: il repo è pubblico, e un problema aperto non si annuncia.
- La minor esce col commit verde più nuovo anche se è lo stesso dell'ultima patch: porta sullo stabile quello
  che il veloce ha già. Il numero (x.y+1.0) lo scrive il server, come per le patch; un numero che non è una
  minor ferma la costruzione.
- Una corsa programmata che GitHub non fa partire si recupera da Actions → Run workflow con `minor`.

## Il changelog

Le righe si scrivono come sempre nel blocco in cima (`package.json` + 1 patch). Il lunedì la minor prende il
posto della patch che quel blocco aspettava: il blocco resta col suo numero, e il recap lo conta lo stesso,
perché mostra a chi aggiorna tutte le righe fra la versione vista e quella nuova. Chi è sullo stabile vede
quindi sotto la minor le righe di tutte le patch uscite nella settimana.

## Cosa non fa

Il sito (filo.red) scarica sempre l'ultima release, cioè il veloce: chi sta su Mac, o su un Linux che non si
aggiorna da sé, e sceglie lo stabile riceve l'avviso della minor ma dal sito prende l'ultima patch.
