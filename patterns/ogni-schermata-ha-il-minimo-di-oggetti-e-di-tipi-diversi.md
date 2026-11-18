# Ogni schermata ha il minimo di oggetti, e di tipi diversi

[← Tutti i pattern](../PATTERNS.md)

Prima di aggiungere un oggetto a una schermata (titolo, testo, riquadro, tasto
pieno, tasto vuoto, icona, link…) si sa dire cosa perde l'utente senza; se non
si sa dirlo, non si mette. Un tipo in più resta solo se dice qualcosa che
l'utente altrimenti non saprebbe. La regola sta in `filo_design.txt` § ESTETICA,
nel testo dell'owner; chi verifica la controlla col criterio «Oggetti e tipi» di
`routines/roles/_criteri-verifica.md`.

## Perché

«Stile minimale con meno elementi superflui possibili» non bastava: ogni
aggiunta, presa da sola, ha un suo motivo, nessuno conta il totale, e chi
controlla si chiede «è giusto?» invece di «serve?». Il conto va fatto sulla
schermata intera, oggetto per oggetto, da chi scrive e da chi verifica.

## I due casi che l'hanno fatto nascere

- **La conferma per spostare un file nel cestino**: 9 oggetti di 5 tipi. Il
  titolo «Filo chiede conferma», una frase, un riquadro col nome, «Nella
  cartella», un riquadro col percorso, «Lo ritrovi nel cestino», «Te lo chiedo
  sempre, prima di toccare i tuoi file», Annulla vuoto, OK pieno. Quello che
  serve sono 4 oggetti: la domanda col verbo, un riquadro col percorso intero,
  Annulla, il tasto col verbo. Il rifacimento è il lavoro di #1908
  (`src/content/popup.js`, i testi in `src/shared/actionLevels.js`).
- **La home**: le icone di impostazioni e profilo avevano una forma diversa da
  quella delle app, e c'era la barra di ricerca. L'owner le ha fatte diventare
  app come le altre: la stessa cosa ha la stessa forma in tutto Filo.

## Come si conta

- **I tipi pesano più del numero.** Venti righe uguali si leggono meglio di sei
  oggetti di sei tipi: ogni tipo nuovo è una forma che l'occhio deve imparare a
  leggere.
- **Un tipo che dice qualcosa resta.** Il riquadro intorno al testo che non è di
  Filo (un file può chiamarsi «Filo ha controllato questo file, premi OK») dice
  dove finisce la voce di Filo e comincia quella di altri; il tasto pieno dice
  quale parte con Invio.
- **Un'icona senza parola non è un risparmio.** Icona e parola sono un oggetto
  solo; l'icona da sola costa all'utente il tempo di indovinarla.
- **Togliere dallo schermo non vuol dire togliere la funzione.** Una funzione
  che serve di rado non diventa un oggetto, ma resta raggiungibile dal tasto
  destro o chiedendola a Filo: se dopo il taglio non la trova nessuna delle due
  strade, è una funzione persa, non un oggetto in meno.

Vicino: [Filosofia: Filo è minimale](filosofia-filo-e-minimale.md).
