# La regola che decide sta in un posto solo, come dati

[← Tutti i pattern](../PATTERNS.md)

Per due anni «Filo può fare X?» ha avuto una risposta sola e fissa: il livello
1/2/3 scritto accanto a ogni azione nel registro (`src/shared/actionLevels.js`).
Il numero diceva tutto insieme — quanto era grave la cosa E cosa fare — e finché
le superfici a decidere erano una (il dispatch della chat) ha retto.

Non regge appena la risposta dipende da più di un ingresso. Fissare una lezione
nella memoria è innocuo se l'utente l'ha chiesta, ed è un dirottamento se in
quella stessa conversazione Filo ha appena letto una pagina web che «chiede» di
fissarla. Stesso potere, stesso numero, pericolo diverso: quello che cambia è il
CONTESTO. E il contesto non lo sa il registro.

**La regola si separa dalla posta in gioco, e diventa dati.** Il registro
dichiara solo quanto costa sbagliare (`costo` 0-3), in che campo si muove
l'azione e che cosa fa entrare nel contesto. Chi decide è un modulo a parte,
`src/shared/autonomia.js` (`SN_AUTONOMIA`), che tiene come DATI i livelli, le
classi delle fonti, i costi, la tabella, l'elenco fisso e le manopole, e li
combina in una funzione pura: `decide({livello, stato, costo, dentroPerimetro,
origine, campo})` → `si | chiede | conferma | no | propone`.

Tre conseguenze pratiche, e sono il motivo del pattern.

**La tabella si legge.** Trentadue celle scritte una sotto l'altra si
confrontano a occhio con quello che l'owner ha chiesto, e un unit test le
ripercorre tutte. Trentadue `if` sparsi nel dispatch no: nessuno li conta, e la
cella che manca la trova un utente.

**Le regole che stanno sopra la tabella si combinano senza allentare.** Fuori
perimetro, origine automazione, elenco fisso, difesa che si abbassa: ognuna può
solo stringere. Si applicano prendendo sempre la risposta più stretta
(`piuStretta`), mai sovrascrivendo. Scritte come `if` in fila, l'ordine in cui
capitano decide il risultato, e il giorno che se ne aggiunge una quinta qualcuno
la mette nel punto sbagliato.

**La seconda superficie non riscrive la prima.** Quando arriveranno la posta e
le automazioni, chiameranno la stessa funzione. Perché non succeda in silenzio
il contrario, `tests/unit/autonomia.test.mjs` tiene tre sentinelle: chi sospende
un'azione (`needsConfirm:`) deve nominare `SN_AUTONOMIA`; chi legge il costo di
un'azione deve essere il registro o il dispatch; e il modulo deve restare puro,
senza storage, DOM o rete, o non lo si può più provare in millisecondi.

Le sentinelle valgono anche sui dati: nessuna cella vuota, un contaminato mai
più permissivo del pulito, un costo più alto che non chiede mai meno di uno più
basso. Sono le tre incoerenze che una tabella scritta a mano prende davvero, e
nessuna delle tre si vede leggendo il diff.

**Un ripiego dichiarato sta nella tabella, non spianato via.** La cella
`si+G` («parte da sola dopo il guardiano di uscita») esiste già, e finché il
guardiano non c'è vale «chiede»: la conversione è una funzione sola,
`risolviGuardiano`. Riscrivere le celle a mano avrebbe significato ritrovarsi,
il giorno del guardiano, a rifare la tabella senza sapere quali celle erano
davvero `chiede` e quali erano un ripiego.

Vicino: [Il canale fidato non trasporta testo di
fuori](il-canale-fidato-non-trasporta-testo-di-fuori.md) — lì si decide come il
testo di qualcun altro entra nel contesto, qui che cosa Filo può fare dopo
averlo letto.
