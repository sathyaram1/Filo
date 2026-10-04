# Il computer si comanda con script fissi, e i parametri stanno nell'ambiente

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Volume, Bluetooth e Wi-Fi si cambiano con uno script scritto una
volta per piattaforma e lanciato dalla via del terminale (`runCommand`). Lo script
non contiene mai un parametro: lo legge dall'ambiente (`FILO_SIS_*`). Per questo
non è una riga di shell libera e non chiede la modalità terminale; il livello di
ogni comando sta nel registro, come per le altre azioni.

## Il caso (#874)

«Alza il volume al 40%», «spegni il Bluetooth», «collegati alla rete di casa»
obbligavano a uscire da Filo. Il nome di una rete o di un dispositivo però lo
sceglie qualcun altro (il bar sotto casa, chi ha rinominato le cuffie), e la
richiesta era esplicita: un nome con virgolette o caratteri speciali non deve
uscire dal suo parametro.

## Perché l'ambiente e non le virgolette

Mettere un nome dentro uno script con le virgolette giuste vuol dire rifare a mano
le regole di quotatura di tre shell diverse (e di PowerShell 5.1, che nel passare
un argomento a un programma esterno perde le virgolette interne). Nell'ambiente il
valore arriva intero per costruzione:

- **sh** (Linux, Mac): `"$FILO_SIS_RETE"`, sempre fra virgolette doppie. La
  sentinella lo controlla per ogni riferimento.
- **AppleScript** (volume su Mac): `system attribute "FILO_SIS_LIVELLO"`, e lo
  script arriva a `osascript` con un heredoc fra apici, che la shell non espande.
- **PowerShell** (Windows): `$env:FILO_SIS_RETE` passato a codice C#. Il Wi-Fi si
  collega con `wlanapi` (`WlanConnect`), non con `netsh`: così il nome non passa da
  nessuna riga di comando.
- Su Linux il nome non arriva nemmeno alla shell: si passa l'identificativo che
  NetworkManager ha dato alla rete, e un indirizzo controllato per il Bluetooth.

Il nome detto dall'utente («le cuffie Sony») si risolve in JavaScript contro
l'elenco vero (`scegliNome`: maiuscole, accenti e un errore di battitura non
contano; due candidati si chiedono). Solo il nome esatto, o l'identificativo, va
al sistema.

## L'uscita non si fa scrivere da fuori

Le righe di Filo cominciano con `FILO:`; quello che un programma stampa arriva con
`| ` davanti. Un nome di rete che contiene `FILO:errore=…` resta un nome. Su
Windows ogni carattere oltre l'ASCII (e la barra rovescia) esce come `\uXXXX`:
la codifica della console non tocca i nomi. Verso il modello i nomi tornano nella
busta `NOMI_DISPOSITIVI`.

## Due cammini, una porta

L'azione della chat (`VOLUME`, `BLUETOOTH`, `WIFI`) e i tasti del riquadro delle
voci della home chiamano la stessa `comanda()`. La differenza sta solo nel
livello: spegnere o staccare ciò che sta servendo (le cuffie, la tastiera, la rete
della chat stessa) chiede conferma quando lo decide il modello; il tasto è già il
gesto dell'utente. Il livello legge `_richiestaSistema`, scritta dal main con la
stessa funzione che poi esegue: quello che si conferma è quello che parte. I
comandi vanno uno alla volta (una coda), e quello che cambiano si vede subito
nella home (`dopoComando`), poi la lettura vera lo conferma.

## I permessi: una frase e il posto dove si concede

Un comando che il sistema rifiuta non fallisce in silenzio: `spiega()` dà la
frase, dove si concede e, quando esiste, la chiave di una pagina delle impostazioni
del sistema. L'indirizzo lo sceglie il main da un elenco fisso (`IMPOSTAZIONI`),
mai chi chiede. I casi noti:

- **Windows**: le radio vogliono «Consenti alle app di controllare le radio»
  (Privacy → Radio); da Windows 11 24H2 le API del Wi-Fi vogliono la posizione.
  Collegare da qui va solo per cuffie e casse (la stessa richiesta del tasto
  «Connetti» al driver audio): gli altri dispositivi Windows li collega da sé.
- **Mac**: il Bluetooth si comanda con `blueutil` (Homebrew), cercato anche in
  `/opt/homebrew/bin` e `/usr/local/bin`, perché un'app aperta dal Finder non ha
  il PATH del Terminale. macOS attribuisce a Filo il permesso del Bluetooth e senza
  `NSBluetoothAlwaysUsageDescription` nel pacchetto chiude il programma.
- **Linux**: `wpctl`, poi `pactl`, poi `amixer`; `bluetoothctl` (più `rfkill`
  per sbloccare); `nmcli`, che può essere negato da polkit.

## Dove vive

- `src/main/services/comandiSistema.js`: script, costruttori, letture delle uscite,
  frasi, la coda.
- `src/main/services/statoSistema.js`: legge anche volume e radio del Wi-Fi.
- `src/pages/dashboard/dashboard-sistema.js`: i comandi nel riquadro delle voci.
- Prove: `tests/unit/comandiSistema.test.mjs` (gli script di Linux e Mac girano
  davvero, con programmi finti; quelli di Windows li analizza PowerShell, su
  Windows), `tests/comandi-sistema.spec.mjs`, le sentinelle di Mac e Linux.

Nessuna prova dice che i comandi funzionino su un Windows, un Mac o un Linux veri:
gli script di Windows sono stati analizzati e compilati con PowerShell 7 su Linux,
dove le API di Windows non ci sono.
