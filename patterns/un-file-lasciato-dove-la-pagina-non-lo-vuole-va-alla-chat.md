# Un file lasciato dove la pagina non lo vuole va alla chat

[← Tutti i pattern](../PATTERNS.md)

Un'immagine trascinata dentro Filo e lasciata in un punto che non la accoglie entra nella chat come allegato, uguale
all'incolla: nella home nel campo della home, su ogni altra pagina (siti e pagine di Filo) nell'Aiuto, dalla fila
delle schede o dalla barra laterale nella chat della scheda davanti. Dove la pagina accoglie il rilascio vince lei.

## Perché

Solo il campo della home prendeva un file trascinato (#1623): lasciato un centimetro più in là, su un sito o sulla
fila delle schede non succedeva niente, perché Chromium apre il file solo con `navigateOnDragDrop`, che Filo non
accende. Il gesto voleva dire «guarda questa», e andava perso.

## Come è fatta, e le trappole

- **Decide il drop, non il dragover.** Il preload ascolta in cattura e aggiunge, mentre l'evento scende, un ascolto
  in bolla su `window` che arriva dopo quelli della pagina. Se nessuno ha cancellato il dragover lo cancella lui, e
  al drop ferma l'evento prima della pagina: i file erano per la chat, e la pagina non li vede. Vale anche sopra una
  casella di testo o un editor: un file non è testo, e in un browser qualunque la pagina che il passaggio non l'ha
  accettato il drop non lo riceve (#1623, giro 5). Dove la pagina ha accettato il passaggio, il drop arriva a lei e
  Filo lo prende in bolla su `window` solo se nessuno l'ha cancellato: una pagina può accettare il file su tutto il
  documento e prenderlo solo in una zona (#1623, giro 3).
  Il campo file prende il rilascio da sé senza che la pagina cancelli niente: lì Filo non si mette in mezzo, o un
  sito con un semplice `<input type="file">` lo perde.
- **Quello che si dà al pannello non passa dalla pagina.** Il pannello sta nel documento del sito: un file lasciato
  sul pannello, un'immagine incollata nella sua casella o mandata da «Incolla» del menu (`filo:paste-image`) la
  prende il preload in cattura su `window`, prima di ogni ascolto della pagina, e la ferma lì.
  Codice: `src/preload/rilascio-file.js`, montato da `page-preload.js` in ogni frame e da `internal-preload.js`. Un
  riquadro incorporato non ha il pannello: legge le immagini e le manda al main, che le gira al frame principale della
  sua scheda senza mai leggere un percorso per conto di un sito.
- **Solo eventi veri.** Un rilascio fabbricato dallo script della pagina (`isTrusted` falso) non arriva all'Aiuto, e
  nemmeno un incolla: [Un pezzo di Filo dentro un sito ubbidisce solo all'utente](un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md).
  Non si passa da una navigazione a `file://`: una pagina potrebbe chiederla da sé, il dragover no.
- **Nell'Aiuto niente percorsi.** Il pannello sta nel documento del sito: anteprime in uno Shadow DOM chiuso, e oltre
  i 4 MB l'immagine si rimpicciolisce finché ci sta (l'Aiuto non apre file dal disco, e il percorso lo leggerebbe il
  sito); solo oltre il tetto di lettura non entra, e lo dice un avviso. Nella home oltre il tetto entra come file col
  suo percorso; senza percorso si rimpicciolisce come nell'Aiuto (#1298). Tetti e frasi stanno in `ALLEGATI_CHAT`
  (`src/shared/constants.js`).
- **Al modello solo formati che legge tutti.** PNG, JPEG, WebP e GIF passano come sono; SVG, BMP, AVIF e gli altri si
  ridisegnano in PNG, prima di entrare, in ogni strada della home e dell'Aiuto (`src/shared/immaginiChat.js`). Una
  richiesta rifiutata dal fornitore toglie le immagini dalla cronologia dell'Aiuto, e lo dice: restando, ogni domanda
  dopo fallirebbe uguale (#1623, giro 4).
- **Nessun file sparisce in silenzio.** Alla chat arrivano tutti i file lasciati insieme a un'immagine: la home prende
  gli altri col percorso, l'Aiuto dice in un avviso che non sono immagini.
- **Le immagini restano nel turno.** Nell'Aiuto stanno nella cronologia, così i passi che fa da solo le vedono ancora;
  il main le lascia passare solo come `data:` di un'immagine (`src/main/services/storiaAiuto.js`). Nel filo della
  home le immagini non si salvano: il messaggio resta, anche senza testo, e dice quante erano.
- **Fila delle schede e barra laterale** prendono il rilascio nel loro documento (`src/renderer/rilascio.js`) e lo
  mandano al main, che legge dal disco solo immagini e solo per loro (`src/main/rilascioNellaChat.js`), e le consegna
  alla scheda davanti con `CHAT_ALLEGA`.
- **Nella home il campo si accende** mentre un file passa sopra la pagina: si vede dove andrà a finire.

Prove: `tests/rilascio-nella-chat.spec.mjs` (trascinamento vero via DevTools, `Input.dispatchDragEvent`) e
`tests/unit/allegatiChat.test.mjs`.
