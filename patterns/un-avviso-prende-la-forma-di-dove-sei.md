# Un avviso prende la forma di dove sei

[← Tutti i pattern](../PATTERNS.md)

Filo ha un avviso solo. La forma la sceglie una funzione sola, `SN_FORMA_AVVISO.forma()`
(`src/shared/formaAvviso.js`), e la chiama la shell in `NOTIFS.show`, dove passano tutti gli avvisi: quelli
nati nella shell e quelli che il main manda come `shell:toast`.

- **Filo non davanti** (nessuna sua finestra col fuoco: ridotta a icona, dietro un'altra, senza fuoco):
  notifica del sistema, l'unico modo di farsi vedere fuori da Filo. La mostra solo
  `src/main/services/avvisoSistema.js`, che sa chi ha il fuoco, rifiuta l'incognito e fa di più copie dello
  stesso avviso (lo stesso `uid`) una notifica sola. Nella shell l'avviso resta parcheggiato (`data-luogo="fuori"`):
  il clic sulla notifica lo riporta nella finestra con la forma di lì; quelli senza durata tornano da soli quando
  Filo torna davanti.
- **Filo davanti su una pagina**: l'angolo in basso a destra, nella vista sopra la pagina
  (patterns/la-shell-non-disegna-sopra-la-pagina.md).
- **Filo davanti nella home**: se la cosa ha già la sua carta (`carta: 'timer:<id>'`, `'download:<id>'`) la home fa
  notare quella e l'avviso se ne va (`assorbi`); se no l'avviso sta nell'angolo il tempo di leggerlo e poi vola in
  cima alla colonna di sinistra, dove resta finché lo si chiude. Il modello resta nella shell: la home disegna le
  carte che il main le gira (`AVVISI_COLONNA`) e ogni gesto torna alla shell. Il volo lo disegna la home (una copia
  della carta dall'angolo alla colonna); con la riduzione del movimento la carta compare subito nella colonna.
  Fa eccezione un avviso a tempo la cui uscita fa partire qualcosa (`alChiudere`, come la segnalazione automatica
  che «Annulla» trattiene): nella colonna non scadrebbe mai e quel qualcosa resterebbe appeso, quindi sta
  nell'angolo e alla scadenza se ne va, come su una pagina (#2570).

Perché la home e non l'angolo: nell'angolo l'avviso copriva il tasto Invio, e stringere il campo per lasciargli
posto (#1551) lo riduceva a una fessura. Dove un avviso ha un posto fisso che è suo, lì va.

Un avviso nuovo non sceglie la propria forma: passa da `avvisoNellaFinestra` (main) o `NOTIFS.show` (shell) e, se
racconta una cosa che ha una carta nella home, dice quale con `carta`. Mai una `new Notification` altrove.
Sentinella: `tests/unit/formaAvviso.test.mjs`; prova d'uso: `tests/avvisi-forma.spec.mjs`.
