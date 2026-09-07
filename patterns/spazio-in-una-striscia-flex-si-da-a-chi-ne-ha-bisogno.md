# Spazio in una striscia flex: si dà a chi ne ha bisogno, non a quote fisse

[← Tutti i pattern](../PATTERNS.md)

Quando in una striscia di elementi che mostrano del testo (schede, chip, colonne)
resta spazio libero, **quel testo non può restare tagliato**. Lo spazio si
assegna guardando quanto serve a ciascuno; una quota fissa — «io il doppio di
te» — è giusta solo quando lo spazio finisce davvero.

Il difetto tipico è invisibile a leggere il CSS: con `flex: 1 1 0` ogni elemento
parte da zero e riceve una FRAZIONE del totale, quindi due elementi con
`flex-grow` diverso restano larghi 1 : 1.8 anche se il titolo del primo è lungo
il doppio. La barra è mezza vuota, e una scheda mostra `Cro…` (#429).

- **Regola operativa:** dai a ogni elemento la sua larghezza piena come punto di
  partenza e lascia che si stringa (`flex-shrink`) solo quando la striscia non ci
  sta più, fino a un `min-width`; oltre quello la striscia scrolla. La differenza
  fra chi è più largo e chi meno la fa la larghezza di partenza, non il
  `flex-grow`: così sopravvive alla stretta senza mai rubare spazio ai vicini
  quando spazio ce n'è.
- **Il trabocchetto di Chromium:** un `flex-basis` NON entra nella larghezza
  intrinseca del contenitore. Se il contenitore è dimensionato sul contenuto
  (`flex: 0 1 auto`), Chromium lo misura sui testi dei figli e poi ripartisce
  quella misura coi flex factor — cioè si torna esattamente al problema di
  partenza, e sembra che la modifica non abbia fatto niente. Serve una `width`
  **definita** sui figli: quella conta, e il contenitore diventa largo la somma.
- **Perché non far crescere il contenitore:** una striscia che si allarga a
  prendere tutta la riga spinge via ciò che la segue (in Filo il `+` delle
  schede) e lascia un buco fra l'ultimo elemento e lui; e lo spazio che si
  mangia era area trascinabile della finestra (`app-region: drag`).
- **Come si verifica:** il test misura la cosa da fuori — se nella riga avanza
  spazio, nessun titolo è tagliato (`scrollWidth` del testo ≤ larghezza della sua
  casella) — e dichiara la pre-condizione, altrimenti passerebbe anche col
  difetto.
- **Dove:** `.tab` / `.tab.active` / `.tabs` in `src/renderer/shell.css`; test in
  `tests/tab-bar-layout.spec.mjs` (`larghezza e separatori stile Chrome`).
