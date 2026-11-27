# Una scheda che nasce da un'altra si prepara sotto

[← Tutti i pattern](../PATTERNS.md)

Il campo della home che diventa l'Editor (#2389) passa da una scheda all'altra senza lampo bianco e senza salto. Ogni
pagina di Filo è una WebContentsView sua: un'animazione non può attraversare il confine fra due viste, e una vista
nuova portata davanti appena creata mostra il suo fondo (bianco, di serie) finché non ha disegnato.

- **La partenza anima.** La pagina da cui si parte (la home) disegna un velo `position: fixed` che cresce da
  dove sta la cosa (il campo) a tutta la finestra, nel suo DOM: è già disegnata e risponde al clic subito.
- **L'arrivo si prepara sotto.** Il main apre (o riusa) la scheda d'arrivo in secondo piano, le dà l'area pagina
  piena e la mette sotto quella davanti (`arrivoSotto` in `src/main/tabs.js`, la stessa mossa delle anteprime):
  così si carica e disegna alla misura vera, senza vedersi. Il fondo della vista prende il colore della pagina.
- **L'arrivo dice dove ha disegnato.** A disposizione ferma (l'Aiuto che si apre sposta il foglio) misura testo e
  colonne e lo manda; il main lo gira alla partenza, che porta il velo lì (con una correzione breve se la stima era
  diversa). Solo allora il main porta davanti la scheda d'arrivo: il primo fotogramma vero coincide con l'ultimo
  del velo. Il resto della pagina d'arrivo (barre, contenuto dell'Aiuto) entra con una dissolvenza.
- **La partenza ricorda.** La misura dell'arrivo si tiene per la prossima volta alla stessa misura di finestra: il
  velo ci va dritto.
- **Il ritorno è l'inverso.** Il main, quando una scheda torna davanti, le dice da quale arriva; solo se arriva
  dall'altra il velo si restringe, altrimenti sparisce da fermo.
- **Niente si perde.** Quello che passa (la bozza) lo tiene il main finché l'arrivo lo prende, una volta sola; non
  preso entro il tetto, torna da dove era partito.
- **Movimento ridotto o durata a zero:** niente velo, l'arrivo viene davanti appena pronto.

Dove: `src/main/services/editorDalCampo.js` (regia), `src/pages/dashboard/dashboard-editor-campo.js` (velo),
`nasceDalCampo` in `src/pages/editor/editor.js` (arrivo). Prove: `tests/editor-dal-campo.spec.mjs` (anche i
fotogrammi presi da X con ffmpeg, a finestra visibile), `tests/unit/editorDalCampo.test.mjs`.
