# Quello che deve farsi sentire ovunque vive nella shell, non in una pagina

[← Tutti i pattern](../PATTERNS.md)

Un avviso che deve raggiungere l'utente **qualunque cosa stia guardando** —
la suoneria di un timer o di una sveglia, un allarme — non può vivere nel
codice di una pagina. Le pagine di Filo sono schede: si chiudono, si navigano
altrove, possono non essere mai state aperte. La shell (`src/renderer/`) c'è
sempre, finché c'è la finestra.

- **Il caso che l'ha fatto nascere (#667, «il timer non suona»).** La suoneria
  era un `AudioContext` dentro `src/pages/dashboard/dashboard.js`: suonava solo
  se la pagina Nuova scheda era aperta. Chi metteva un timer e poi andava a
  navigare non sentiva niente. Il watcher nel main (#322) aveva già chiuso metà
  della stessa lacuna — la notifica di sistema — ma il suono era rimasto lì.
- **La divisione giusta.** Il processo main tiene lo **stato** (chi è scaduto:
  `src/main/services/alarmWatcher.js`) e lo manda in giro con
  `broadcastLiveUpdate()`. La shell lo **rende percepibile** (suono +
  controllo). Le pagine mostrano quello che sanno mostrare, e se non ci sono non
  manca niente di essenziale.
- **Una sola sorgente di suono.** Quando sposti il suono nella shell, TOGLILO
  dalla pagina: due superfici che suonano lo stesso motivo sfasate sono peggio
  del silenzio. La pagina tiene lo stato visibile (in dashboard
  `#live[data-ringing]`), non l'audio.
- **Il comando per farlo smettere sta nella fila di tab.** È l'unica striscia
  della shell **mai coperta** dalla WebContentsView della pagina (vedi
  [Animazioni che coprono la pagina](animazioni-che-coprono-la-pagina-vivono-nel-content-overlay.md)):
  un pulsante disegnato dalla shell nell'area pagina non si vede e non si
  clicca. Il chip `#ring-indicator` sta accanto a quello degli scaricamenti,
  per lo stesso motivo.
- **«Mai coperta» ha un'eccezione: il tutto schermo.** Lì la view della pagina
  parte da y=0 e prende anche la fila di tab, quindi il pulsante c'è ma nessuno
  lo vede né lo clicca, e nessun tasto zittisce. Il main fa rientrare la finestra
  dal tutto schermo (`alarmWatcher`) **finché qualcosa suona**, non solo
  all'istante della scadenza: legato all'istante, bastava mandare un video a
  tutto schermo un secondo dopo per riavere il rumore senza interruttore.
- **Una finestra incognito ha la SUA lista.** I timer non sono fra le chiavi che
  l'incognito eredita dal disco, quindi ogni shell chiede le proprie scadenze e
  nessuna può squillare in due finestre insieme. Il rovescio: chi guarda solo la
  lista su disco non vede mai quelle scadenze, e il watcher del main deve fare
  una passata anche dentro `runIncognito()` o quei timer restano muti per
  sempre. La notifica di sistema lì resta fuori di proposito: il nome del timer
  finirebbe fra le notifiche del sistema, cioè una traccia su questo computer.
- **Con la finestra ridotta a icona resta solo la notifica di sistema**, quindi
  un click su quella deve riportare su la finestra: altrimenti l'unica cosa che
  l'utente vede non porta da nessuna parte.
- **I `setTimeout` di una pagina nascosta vengono strozzati** (fino a uno al
  minuto): un ciclo «suona, riprogramma fra un secondo» si sbriciola proprio
  quando serve, cioè con Filo ridotto a icona. La linea del tempo
  dell'`AudioContext` non si strozza: si programma un **lotto lungo** di note in
  un colpo solo (`SN_SOUNDS.ring`, `LOTTO_MS`) e si tiene il riferimento agli
  oscillatori per poterli zittire subito con `silence()`.
- **Il lotto dopo si accoda al precedente, non ricomincia da «adesso».** Il
  rifornimento arriva prima che il lotto in onda finisca (deve, altrimenti si
  sente un buco), quindi programmarlo da `currentTime` fa suonare due copie
  della stessa suoneria sovrapposte finché il primo lotto non si esaurisce: un
  minuto di suoneria e ci si era già dentro. Sentinella:
  `tests/unit/suoneriaLotti.test.mjs`.
- **Dove:** `src/shared/sounds.js` (`ring`/`silence`/`isRinging`/`state`),
  `src/renderer/shell.js` (chip + risveglio sulla scadenza),
  `src/main/services/alarmWatcher.js`. Test: `tests/timer-ringtone.spec.mjs`.
- **Come si prova che suona davvero.** Un flag alzato da noi non dimostra
  niente: `SN_SOUNDS.state()` torna lo stato vero dell'`AudioContext`, e uno
  spec pretende `'running'`.
