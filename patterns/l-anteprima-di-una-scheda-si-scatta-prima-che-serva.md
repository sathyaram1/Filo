# L'anteprima di una scheda si scatta prima che serva

[← Tutti i pattern](../PATTERNS.md)

La carta che compare passando sopra una scheda (#430) non deve mai aspettare: al
momento dell'hover la foto è già nel main e già decodificata nella carta. Quindi
la foto si scatta quando la pagina è ancora a schermo, non quando qualcuno la
chiede.

- **Perché:** una scheda dietro ha l'area a zero e, dopo il primo cambio di
  scheda, è nascosta. Da nascosta non si disegna: una foto chiesta all'hover
  restituisce vuoto o l'ultimo fotogramma rimasto, e costerebbe comunque il
  tempo di una cattura.
- **La scheda davanti, quando va dietro.** La foto si chiede un attimo PRIMA di
  cambiare scheda (in `activate` e nell'apertura di una scheda davanti), così
  mostra quello che l'utente ci ha visto per ultimo.
- **La scheda nata dietro.** Una scheda aperta in secondo piano (un link, il
  ripristino della sessione) non si è mai disegnata. Resta «visibile» a zero
  finché non ha la sua foto, anche se nel frattempo si cambia scheda: nascosta
  non si disegnerebbe più. Finito di caricare, per un attimo prende l'area della
  pagina ma va in fondo alle viste (`addChildView(vista, 0)`), sotto quella
  davanti che la copre tutta; il layout lo sa e non la rimpicciolisce a metà.
  Una alla volta, e mai mentre la scheda davanti è nascosta (menu della shell
  sopra la pagina) o la finestra non si vede: lì la si vedrebbe, o non verrebbe.
- **La carta** è una finestra figlia (`src/main/popup-anteprima.js`, strada 2 di
  [la shell non disegna sopra la pagina](la-shell-non-disegna-sopra-la-pagina.md)):
  non prende il puntatore né la tastiera, nasce quando il puntatore entra nella
  barra e riceve tutte le foto in quel momento, poi ognuna appena scattata.
  Prima di sparire si svuota, così chi la rivede non trova per un istante la
  scheda di prima.
- **La prima compare dopo un attimo**, per non accendersi attraversando la
  barra; da lì, finché si resta sulle schede, passa dall'una all'altra subito.
  Sulla scheda davanti non c'è foto: la pagina si vede già.
- **Le foto stanno in memoria**, mai su disco (anche in incognito), e se ne
  vanno con la scheda.
- **Test:** `tests/tab-preview.spec.mjs` guarda la carta vera e il colore dei
  suoi pixel, per la scheda lasciata dietro, per quella nata dietro e per quella
  nascosta prima di finire di caricare.
