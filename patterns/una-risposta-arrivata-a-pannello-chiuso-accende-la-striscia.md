# Una risposta arrivata a pannello chiuso accende la striscia della barra

[← Tutti i pattern](../PATTERNS.md)

Se Filo risponde mentre il pannello dove parla con l'utente non si vede (ridotto o chiuso da lui), la risposta non
si perde e non gli si apre addosso: la striscia d'indizio della barra laterale resta accesa, col colore d'accento e
senza lampeggiare, finché la risposta non si apre. Vale per l'Aiuto sulla pagina e per il pannello di destra delle
app di Filo.

## Perché

Chi riduce o chiude il pannello mentre Filo pensa sta dicendo «non adesso»: riaprirglielo sopra la pagina quando
arriva la risposta lo contraddice, buttarla via gli fa rifare la domanda (#1432). Prima l'Aiuto faceva tutte e due
le cose: ridotto si riapriva da solo, chiuso perdeva la risposta.

## Come è fatta

- **Chi ha il pannello dice solo «c'è una risposta da leggere» e «l'ho aperta»**: `MSG.RISPOSTA_IN_ATTESA` con la
  sua `fonte` (`aiuto`, `app`). La tiene il main per scheda e per fonte (`src/main/risposteInAttesa.js`), e la
  striscia segue la scheda davanti, come tutta la barra. Una fonte nuova si aggiunge a `FONTI`, non con un canale suo.
- **La fine la constata il main**: il documento nuovo e la pagina caduta portano via la risposta insieme al pannello
  (`tabs.js`, `did-navigate` e `render-process-gone`), e una scheda chiusa se la porta via da sé. La pagina che
  muore non lo direbbe ([La fine di una cosa la constata chi resta, non chi se ne va](la-fine-di-una-cosa-non-la-annuncia-la-pagina-che-muore.md)).
- **A barra aperta la striscia non si vede**: l'icona che apre il pannello porta un punto dello stesso accento.
- **Ridotto dall'utente vince sul modello**: la richiesta del modello di tenere aperta la chat resta in memoria, ma
  il pannello si riapre solo quando lo chiede l'utente (`expand` in `src/content/sidebar.js`). Ridotto dal modello
  (un passo da cliccare sulla pagina) non accende niente: lì la risposta è il segno sulla pagina.
- **Chiuso a metà di un turno, il pannello si nasconde invece di sparire**: la risposta ci entra, i passi che
  l'Aiuto farebbe da solo e i segni sulla pagina no, e qualunque strada lo riapra (icona, tasto destro,
  scorciatoia) mostra quella conversazione. Se il turno finisce senza niente da leggere, è chiuso davvero.

Prova: `tests/barra-laterale-aiuto.spec.mjs`; vicino: [Globale nella barra, contestuale nel tasto destro](globale-nella-barra-contestuale-nel-tasto-destro.md).
