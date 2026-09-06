# Colore identità delle tab: brand del sito, mai chrome neutra

Il colore con cui si tingono le tab (attiva = "vetro smerigliato" §1.1; inattive
= tinta identità attenuata §1.2) deve rappresentare il **brand del sito**, non la
sua chrome neutra. Un `theme-color`/sfondo bianco, nero o grigio **non è
un'identità** e non va usato come tinta: in quel caso si ripiega sul **favicon**
(il segnale di brand più affidabile). Es: YouTube dichiara `theme-color` bianco
ma il suo brand è il rosso del favicon → la tab dev'essere rossa, non bianca.

- **Regola operativa:** un colore "conta" come identità solo se ha croma
  sufficiente (max−min dei canali RGB ≥ 24). La logica pura è in
  `src/shared/tabColor.js` (`SN_TAB_COLOR.hasIdentity`), unit-testata in
  `tests/unit/tabColor.test.mjs`. La catena di derivazione è
  `theme-color → manifest → favicon`, ma ogni anello neutro viene saltato.
- **Perché:** una tinta bianca/grigia è indistinguibile dal tab bar (tinta
  invisibile) o, per la tab attiva, dà un bianco senza significato. Il favicon
  porta quasi sempre il colore vero del sito.
- **Limite noto:** se il favicon è cross-origin senza header CORS, il canvas si
  "taint-a" e il colore non è estraibile → la tab resta neutra (meglio che
  sbagliata). I favicon same-origin (come YouTube) funzionano.
- **Dove:** campionamento in `src/content/pageColor.js` (catena `compute()`);
  applicazione/ripiego nella shell in `src/renderer/shell.js` (`render`,
  `hasColorIdentity`).
- **Parametri regolabili (6):** l'estrazione e il blend sono governati da sei
  parametri (`soglia_saturazione`, `peso_centralita`, `bucket_tinta`,
  `saturazione_tab`, `luminosita_tab`, `opacita_tab`). La **fonte di verità** di
  default/range/etichette/commenti è **una sola**: `IDENTITY_PARAM_META` in
  `src/shared/tabColor.js` (con `defaultParams()`/`clampParams()`). I primi
  cinque (`stage:'extract'`) sono passati a `extractIdentityFromPixels`; il
  sesto (`opacita_tab`, `stage:'blend'`) è la frazione di tinta nel `color-mix`
  della shell. I valori vivono in `settings.tabColor`; `DEFAULT_SETTINGS` in
  `constants.js` deve restare allineato ai default del meta.
- **Due strade per cambiarli (parità di cammini):** (1) **a voce in chat** — il
  setter `colore_tab` in `src/shared/preferences.js` mappa richieste verbali
  ("più vivaci"/"più neutre"/"nessuno"/"più preciso"/"predefinito") su preset
  **assoluti** dei parametri (non delta: il setter non vede lo stato corrente);
  (2) **Preferenze avanzate** — la "zona codice" numerica (stesso stile dei token
  estetici) in `src/pages/preferences/`. Entrambe scrivono via `UPDATE_SETTINGS`,
  che fa **deepMerge** su `tabColor` (un preset parziale lascia intatti gli altri
  parametri) e ribroadcast `SETTINGS_UPDATED`: il content **ri-estrae** il colore
  del favicon coi nuovi parametri e la shell **ri-renderizza** il blend, live.
- **Quando aggiungi/cambi un parametro:** toccalo SOLO in `IDENTITY_PARAM_META`
  (più il default speculare in `constants.js`); UI prefs, validazione e mapping a
  voce lo ereditano. Niente slider per questi: sono valori numerici espliciti.
