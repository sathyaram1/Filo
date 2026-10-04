# Il computer si legge senza permessi e finché serve

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Batteria, rete e Bluetooth si leggono con quello che il sistema dà
a qualunque programma. Un dato che vorrebbe un permesso si omette, non si chiede.
Il lettore gira solo mentre qualcuno guarda, e su Windows è un PowerShell solo
che resta aperto, nascosto, e scrive una riga quando qualcosa cambia.

## Il caso (#873)

Ora, batteria, rete e Bluetooth dovevano vedersi nella home e stare nello STATO
della chat, così «quanta batteria ho?» si risponde senza strumenti. La spec
diceva anche: un dato che richiede un permesso del sistema si omette.

## I permessi stanno dove non te li aspetti

- **Il nome del Wi-Fi.** Da Windows 11 24H2 le API del Wi-Fi (`netsh wlan`,
  `WlanQueryInterface`, `GetConnectedSsid`) vogliono la posizione, e la prima
  chiamata può far comparire la richiesta. Il nome si prende dal gestore delle
  reti (`NetworkListManager`), che è il nome che Windows stesso mostra. Su macOS
  14.4 e seguenti `ipconfig getsummary` scrive `<redacted>`: lì il nome non c'è e
  non compare.
- **Il Bluetooth su Mac.** `system_profiler` e CoreBluetooth passano dal permesso
  del Bluetooth, attribuito a chi li lancia. Si legge solo acceso o spento, dalle
  preferenze di sistema; quali dispositivi sono collegati su Mac non si dice.
- **Su Windows** la radio si legge con `Radio.GetRadiosAsync`, senza
  `RequestAccessAsync`: quella serve a cambiarla, ed è il lavoro dopo.

La sentinella è `tests/unit/statoSistema.test.mjs` (lo script di Windows) più le
due di piattaforma, `macSupport.test.mjs` e `linuxSupport.test.mjs`.

## Perché un lettore che dorme

Un'icona della batteria che scarica la batteria non serve a nessuno. Avviare
PowerShell costa mezzo secondo di processore: ogni pochi secondi, per tutto il
giorno, è un costo vero. Quindi:

- la home in vista chiede ogni 30 secondi, un turno di chat chiede una volta, e
  il lettore si ferma 90 secondi dopo l'ultima richiesta;
- «in vista» lo decide il main, non la pagina: una scheda dietro le altre per
  Chromium resta `visible`, quindi la sua richiesta riceve lo stato ma non tiene
  sveglio il lettore; quando la finestra la riporta davanti, il lettore riparte
  da sé;
- un lettore che riparte non consegna la lettura di prima del sonno come
  fresca: chi chiede aspetta la riga nuova, e se non arriva in tempo la chat
  riceve «il computer non ha risposto», non il dato vecchio (la home intanto
  tiene la riga di prima);
- su Windows il PowerShell parte alla prima richiesta, legge ogni due secondi
  con chiamate che non aprono altri processi, scrive solo quando la lettura
  cambia, ed esce da sé se Filo non c'è più (controlla il processo che l'ha
  lanciato), oltre che quando Filo lo ferma;
- staccando il caricatore Windows e macOS avvisano subito (`powerMonitor`):
  l'icona cambia senza aspettare il giro.

Collegato o no lo decide Chromium (`net.isOnline`) su tutti i sistemi; Wi-Fi o
cavo e il nome li dice la piattaforma.

## La riga di Windows è tutta ASCII

Lo script converte ogni carattere oltre l'ASCII in `\uXXXX` prima di scrivere:
la codifica della console non può storpiare il nome di una rete col caffè
accentato. È la stessa famiglia di guasti di
[Un processo esterno scrive nella sua codifica, non nella tua](un-processo-esterno-scrive-nella-sua-codifica-non-nella-tua.md).

## I nomi li sceglie qualcun altro

Il nome di una rete lo sceglie chi la gestisce (il bar sotto casa), quello delle
cuffie chi le produce o le rinomina. Nel prompt stanno nella busta
`NOMI_DISPOSITIVI`, e nella home si scrivono come testo.

## Dove vive

- `src/main/services/statoSistema.js`: i lettori per piattaforma e il giro.
- `src/shared/sistema.js`: le parole, per la home e per lo STATO.
- `src/pages/dashboard/dashboard-sistema.js`: la riga della home.
- `tests/dashboard-sistema.spec.mjs`: la strada vera con un computer finto.

Nessuna prova dice che il lettore funzioni su un Mac o su un Windows veri: lo
script di Windows è stato fatto girare con PowerShell 7 su Linux, dove le API di
Windows non ci sono.
