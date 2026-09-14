# Una garanzia non si fa raccontare dal mondo della pagina

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Quando Filo promette a chi usa Filo che una cosa è chiusa
(«togliendo il permesso hai chiuso anche il microfono che il sito aveva già»),
il conto che decide non può arrivare dal mondo della pagina. Lì dentro gli
stampi li riscrive il sito: una pagina che dichiara finite le proprie tracce
mentre sono vive fa concludere a Filo che non è rimasto niente. Il conto si
tiene nel preload, dove gli stampi sono nostri, e al mondo della pagina si
chiede solo di collaborare. Il ponte fra i due è il DOM, che è condiviso: le
tracce si appendono a un elemento nascosto marcato
(`data-filo-traccia="<chiave>"`), il preload le rilegge da lì con i propri
`MediaStream.prototype` e `MediaStreamTrack.prototype`, e ferma con quelli.

E quando il preload non vede niente mentre Filo sa di aver concesso qualcosa,
non si conclude «è tutto a posto»: si prende la strada dura (ricaricare la
scheda). Si sbaglia dalla parte di chi ha tolto il permesso, non dalla parte
del sito.

**Il caso.** #586 ha chiuso i permessi che i siti chiedono. La promessa «se te
lo tolgo non ce l'hai più» si è riaperta quattro volte, ogni volta da una porta
nuova:

- giro 4: la revoca valeva solo per la volta dopo, il microfono restava aperto.
  La correzione ricaricava la pagina, che chiude tutto per forza.
- giro 5: ricaricare buttava via quello che chi naviga stava scrivendo lì. La
  correzione ha sostituito la ricarica con una domanda alla pagina, «ferma quello
  che ti ho dato, e dimmi quante ne restano vive», e la ricarica solo se qualcosa
  restava vivo.
- giro 6: la domanda arrivava al solo riquadro principale, e una traccia presa
  da un riquadro incorporato, o una copia messa da parte, sopravviveva.
- giro 7: il conto lo teneva una funzione avvolta sull'oggetto, e l'originale
  restava lì accanto sullo stampo: chi ne prendeva una seconda per quella via
  non veniva contato.
- giro 9: il conto arrivava comunque come una risposta della pagina. Una pagina
  che ridefiniva `readyState` per dire sempre `ended`, e `stop()` per non fare
  niente, teneva il microfono aperto a permesso tolto. Nessuna ricarica, nessun
  cartello, e in Impostazioni niente da togliere: per chiudere davvero restava
  solo chiudere la scheda, e senza cartello non si sapeva quale.

Le prime quattro correzioni hanno tappato ognuna la sua porta, restando dentro
il mondo della pagina. La quinta ha spostato il confine: il pezzo che conta e
che ferma è passato nel preload
(`src/preload/page-preload.js`, il giro su `filo:permessi-ferma`), e quello che
gira nella pagina (`src/preload/permessi-guard.js`,
`buildCatturaSicuraSource`) si limita a consegnare le tracce al DOM e a fermare
quello che sa. Se la pagina se lo toglie di mezzo, il preload non vede tracce,
il conto delle viste è zero e Filo ricarica.

**Come si riconosce il caso.** Ogni volta che una difesa chiede alla cosa
difesa di dichiarare il proprio stato. Il segnale è una risposta che arriva da
`window`, da un evento del DOM o da un canale che la pagina può intercettare, e
che poi decide se una protezione scatta o no. La domanda da farsi è: se chi sta
dall'altra parte mentisse, cosa succederebbe? Se la risposta è «la protezione
non scatta», il conto va spostato.

**Dove guardare.** `src/preload/page-preload.js` (il registro nel mondo del
preload, riempito da un `MutationObserver` sugli elementi marcati),
`src/preload/permessi-guard.js` (`ATTR_TRACCIA`, `appendi`),
`src/main/services/permessiSito.js` (`chiediAllaPaginaDiFermare`: nessuna
traccia mai vista significa strada dura). La prova che lo tiene chiuso è
`tests/permessi-siti.spec.mjs`, «la revoca chiude il microfono anche se la
pagina giura che è già chiuso».
