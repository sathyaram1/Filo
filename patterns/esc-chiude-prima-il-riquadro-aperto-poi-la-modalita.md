# Esc chiude prima il riquadro aperto, poi la modalità

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Un Esc che il main intercetta per uscire da una modalità (oggi lo
schermo intero) deve prima sapere se la pagina ha aperto un riquadro di Filo che
si chiude con Esc. Se ce l'ha, il tasto è del riquadro: il main si tira
indietro, e sarà l'Esc dopo a uscire dalla modalità.

**Il caso.** #514 chiedeva che Esc facesse uscire dallo schermo intero. La prima
soluzione lo intercettava in `before-input-event`, cioè prima che il documento
lo vedesse: da lì lo schermo intero si spegneva sempre, ma i riquadri di Filo
restavano aperti sopra la pagina. Chi selezionava una parola, chiedeva a Filo e
premeva Esc per chiudere la risposta perdeva lo schermo intero e si teneva la
risposta. Lo stesso col menu del tasto destro, aperto proprio per cercare la
via d'uscita, e con l'immagine a tutta pagina nella gestione feedback. Tre
porte, una causa sola: il main decideva senza sapere cosa c'era aperto.

**Perché non basta lasciar passare il tasto.** Il main non intercetta per
capriccio: la pagina può non avere un content script, può mangiarsi i tasti, e
l'Esc può arrivare dalla barra di Filo o da un'altra scheda, dove la pagina non
lo vedrebbe mai. Toglierlo di mezzo riapre proprio i buchi che #514 aveva
chiuso.

**Come si fa.** Chi apre e chiude un riquadro lo dice al main
(`MSG.FILO_BOX_OPEN`), che tiene la lista delle schede con un riquadro aperto e
la svuota a ogni navigazione e alla chiusura della scheda. `handleFullscreenEscape`
in `src/main/tabs.js` risponde `false` quando la scheda in primo piano è in
quella lista. Il gancio unico sta in `src/content/content.js`
(`SN_RIQUADRI_CAMBIATI`): `menu.js` e `popup.js` lo chiamano quando si aprono e
si chiudono, e una pagina interna con un riquadro suo risponde in
`window.__filoRiquadroAperto`.

**La rete di sicurezza conta quanto la regola.** Un avviso può arrivare in
ritardo. Perciò il controllo si rifà anche nel content script, sui riquadri
veri e nel momento del tasto: se la lista del main dicesse «riquadro aperto»
quando non c'è più, il tasto arriva alla pagina e a uscire dalla modalità è lei.
Così l'errore possibile è al massimo il comportamento di prima, mai restare
chiusi dentro senza uscite.

**Il nome della voce cambia con lo stato, anche a menu aperto.** Se la modalità
si spegne per un'altra strada mentre il menu è sotto gli occhi, la voce va
ridisegnata sul posto (`SN_MENU_ICONS.redrawIconRows`): «Esci da schermo
intero» su uno schermo che intero non è più promette il contrario di quello che
fa.
