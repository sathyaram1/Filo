# Pattern e convenzioni di Filo

Catalogo del **sapere condiviso** su come si costruiscono le cose in Filo: pattern UI,
convenzioni di design, decisioni ricorrenti. Vale per le sessioni locali **e** per le
routine cloud.

**Quando leggerlo:** prima di toccare la UI o di prendere una decisione di design.
**Quando aggiornarlo:** ogni volta che stabilisci (o ti viene indicato) un pattern
nuovo, o che ne scopri uno implicito nel codice che vale la pena rendere esplicito.
Una voce qui dovrebbe **guadagnarsi il suo posto**: è una regola riusabile, non un
appunto monouso.

Formato di una voce: titolo breve → la regola in una frase → il perché → eventuale
riferimento al codice dove vive il pattern.

---

## Filosofia: Filo è minimale

Filo è volutamente scarno (non c'è nemmeno la barra URL). Scrivere più codice non
significa UX migliore: spesso la mossa giusta è **togliere**, non aggiungere. Le
feature collegate / invarianti UX vanno considerate, ma un'aggiunta deve guadagnarsi
la sua complessità — se rende l'app solo "più piena" e non più coerente, non va fatta.

## Controlli UI custom: tema di Filo, non default del browser

I controlli dell'interfaccia (menu a tendina, select, ecc.) devono usare la
**palette e il comportamento del tema di Filo**, non i default del browser/OS (es. il
blu di selezione nativo). Devono essere **coerenti tra loro**: un menu a tendina nuovo
deve sembrare e comportarsi come gli altri menu a tendina già presenti in Filo.

- **Perché:** i default nativi (blu di sistema, font, hover) spezzano l'identità
  visiva e fanno sembrare l'elemento "incollato" e non parte dell'app.
- **Dove:** i token di tema vivono in `src/styles/` (theme). Prima di stilare un
  controllo nuovo, guarda come è fatto un controllo equivalente esistente e riusane
  variabili/classi invece di reinventare i colori.

## Colore identità delle tab: brand del sito, mai chrome neutra

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
