# Una finestra a comparsa nasce una volta e si riusa

[← Tutti i pattern](../PATTERNS.md)

Menu, fumetto e carta d'anteprima stanno sopra le schede, quindi sono finestre
figlie (la shell non disegna sopra una WebContentsView). Una `BrowserWindow`
nuova è un processo renderer nuovo: sul PC lento il menu compariva verso il
secondo, e il secondo clic non era più veloce del primo (#1090). Quindi una
finestra a comparsa nasce una volta (menu e carta: una per finestra madre) e poi
si riusa: all'apertura cambiano contenuto, posizione e visibilità, mai il
documento.

- **Nasce prima del clic.** Il menu nasce nascosto quando la barra della
  finestra ha finito di caricarsi (`preparaMenu` in `src/main/window.js`), col
  documento e il preload già caricati. Chi lo distrugge (uno spec, la chiusura
  della madre) non rompe niente: la prossima apertura lo ricrea.
- **Col processo morto si butta e rinasce.** Riusata, una finestra il cui
  renderer è morto lascerebbe la madre senza menu (o fumetto, o carta) fino al
  riavvio: su `render-process-gone` si distrugge, la prossima apertura la
  ricrea, e il menu che stava per comparire si riapre una volta. Sentinella:
  `tests/unit/popupRinasce.test.mjs`.
- **Quello che resta si collega alla nascita.** Scorciatoie, invisibilità nei test
  e l'ascoltatore dei messaggi della pagina si attaccano una volta. Il gestore
  dei messaggi è unico e risolve la scelta del menu aperto adesso.
- **Ogni apertura ha un numero (`giro`).** Le voci arrivano col numero, la scelta
  e la chiusura tornano col numero, e il main scarta ciò che arriva da un menu
  già passato: un clic sul menu di prima non sceglie per quello nuovo. Vale
  anche per il fumetto: la misura del testo torna col numero, e se nel frattempo
  qualcuno l'ha nascosto non lo rimostra. Altrimenti resta appeso sopra la
  pagina, perché chi l'ha chiesto crede di averlo già tolto (#1201, prova:
  `tests/barra-laterale-suggerimento.spec.mjs`).
- **Compare quando la pagina conferma le voci nuove** (`popup-menu:pronto`), e
  sparisce solo dopo aver disegnato il vuoto (`popup-menu:vuoto`, con un tetto
  se la pagina non risponde). Nascosta col menu dentro, alla comparsa dopo lo
  rimostrerebbe per un istante.
- **Si chiude prima di chiamare chi ha scelto.** Chi sceglie può riaprire
  subito lo stesso menu: è il secondo livello di una voce a due zone
  ([pattern](popup-menu-il-submenu-e-una-voce-a-due-zone-che-riapre.md)).
- **Il blur di una chiusura può arrivare dopo la comparsa seguente** (X11). Entro
  un breve tempo dalla comparsa conta solo se il fuoco non è tornato al menu.
- **Chi aspetta la chiusura chiede a `quandoChiuso`**, non a `'closed'`: la
  finestra non si chiude più, si nasconde.
- **Le finestre figlie stanno anche in testa a `getAllWindows()`.** La finestra
  con le schede si cerca con `w._filoTabs`, mai con `[0]`.
- **Negli spec il menu aperto è quello con `.menu` dentro** (vuoto quando è
  chiuso) o quello visibile: che esista una finestra `data:` non vuol dire niente.
  Prova: `tests/menu-a-comparsa-riusato.spec.mjs`.
