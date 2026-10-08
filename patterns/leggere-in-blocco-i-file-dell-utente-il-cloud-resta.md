# Leggere in blocco i file dell'utente: il cloud resta nel cloud

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Chi legge da sé tanti file dell'utente (un indice, un giro in
sottofondo) non apre un file che sta solo nel cloud, e su macOS non tocca
Documenti, Scrivania e Download prima che l'utente abbia chiesto qualcosa che li
riguarda.

## Il caso (#947)

La ricerca dei documenti per contenuto tiene un indice del testo dei file di
Documenti, Download e Scrivania, aggiornato in sottofondo. Due cose che su
Windows con un disco normale non si vedono:

- **OneDrive e iCloud.** Con OneDrive che sincronizza Documenti e Scrivania (su
  Windows è la norma) e con l'archiviazione ottimizzata di iCloud, molti file sul
  disco sono solo un segnaposto: hanno nome e misura, ma il contenuto è nel cloud.
  Aprirli per leggerli li scarica. Un indice che legge tutto scaricherebbe
  l'intera cartella, gigabyte compresi. Il segnaposto si riconosce senza aprirlo:
  misura vera e nessun blocco occupato sul disco (`stat().blocks === 0`). Sotto i
  4 KB la regola non vale, perché NTFS tiene i file piccoli dentro il proprio
  indice e li dà con zero blocchi anche quando sono sul disco. Un file così si
  trova per nome, e il modello sa che sta nel cloud.
- **macOS.** Leggere Documenti, Scrivania e Download fa comparire la richiesta di
  permesso del sistema, una per cartella. Se la fa un giro in sottofondo, compare
  venti secondi dopo l'avvio senza che l'utente abbia chiesto niente. Su Mac il
  primo giro lo fa la prima ricerca chiesta dall'utente; da lì in poi il giro in
  sottofondo riparte da sé.

Il resto del giro segue
[Il computer si legge senza permessi e finché serve](il-computer-si-legge-senza-permessi-e-finche-serve.md):
il testo si estrae in un processo a parte (`utilityProcess`), uno alla volta, e
il lettore si spegne quando non serve.

## Dove vive

- `src/main/services/documentiIndice.js`: `soloNelCloud`, `giroInSottofondo`.
- Prove: `tests/unit/documentiRicerca.test.mjs` (un file sparso fa da
  segnaposto; la piattaforma Mac simulata).

Nessuna prova gira su un Windows con OneDrive o su un Mac veri: che `blocks` sia
zero per un segnaposto di OneDrive lo dice come libuv riempie `stat` su Windows,
non una prova.
