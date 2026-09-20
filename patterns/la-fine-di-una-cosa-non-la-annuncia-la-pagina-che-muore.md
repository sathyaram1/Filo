# La fine di una cosa la constata chi resta, non chi se ne va

[← Tutti i pattern](../PATTERNS.md)

Una pagina che tiene in vita qualcosa — una chat in corso, una sessione, una
bozza, un blocco su una risorsa — prima o poi deve dire che è finita. Il modo
che viene in mente è farlo dire alla pagina stessa, nel suo ultimo respiro:
`pagehide`, `beforeunload`, `unload`, e dentro un messaggio al main.

Quel messaggio spesso non arriva. Chiudere la scheda distrugge il processo che
lo sta spedendo: l'evento parte, la consegna no. Non c'è errore e non c'è modo
di accorgersene dalla parte di chi doveva ricevere: semplicemente non succede
niente, per sempre.

È successo con l'archivio delle chat (#525). Tornare alla home e aprire una
chat nuova annunciavano la chiusura e funzionavano; chiudere la scheda no, e
chiudere la scheda è il modo più comune di andarsene. La chat restava «in
corso»: niente titolo breve (in elenco compariva la prima frase scritta
dall'utente, così com'era) e invisibile a Filo, che quando gli si chiede
«riprendi la discussione di ieri» guarda solo le chat finite. Si rimetteva a
posto al riavvio dell'app, cioè giorni dopo.

**La regola: la fine la constata chi resta.** Il main la scheda la vede sparire
per davvero, senza bisogno che nessuno glielo spedisca. Quindi il main tiene
una mappa `cosa → webContents che la sta vivendo` e si iscrive alla sua morte:

```js
const proprietari = new Map();            // id → webContents
function affida(id, wc) {
  if (!id || !wc || wc.isDestroyed()) return;
  if (proprietari.get(id) === wc) return;
  proprietari.set(id, wc);
  wc.once('destroyed', () => {
    // Può essere passata a un'altra scheda nel frattempo: allora non è più
    // questa pagina a doverla chiudere.
    if (proprietari.get(id) !== wc) return;
    proprietari.delete(id);
    chiudi(id);
  });
}
```

Tre cose che questa forma porta con sé, e che vale la pena non riscoprire:

**Il passaggio di mano.** La stessa cosa può migrare a un'altra pagina (una
chat riaperta da Cronologia in una scheda nuova). Il controllo
`proprietari.get(id) !== wc` è ciò che impedisce alla scheda vecchia, morendo,
di chiudere una conversazione che nel frattempo è ricominciata altrove.

**Le eccezioni si dichiarano.** Non tutto ciò che è a schermo è «in corso»:
l'intervista di benvenuto chiusa a metà non è finita, riprende dov'era alla
prossima apertura, e trattarla come finita vorrebbe dire pagare un titolo a un
modello a ogni ricaricamento. L'eccezione sta accanto all'affido, non nascosta
dentro la chiusura.

**La chiusura diventa concorrente.** Adesso può partire da due parti insieme
(la scheda che sparisce e il messaggio che era riuscito a partire), e se
chiudere costa una chiamata a un modello, si paga due volte per scrivere lo
stesso titolo. Le chiusure della stessa cosa si mettono in fila per chiave:
la seconda parte quando la prima ha finito, e trova lo stato completo.

Il messaggio spedito dalla pagina resta, e va tenuto: quando arriva è più
rapido, e copre i casi in cui la pagina resta viva (si torna alla home, si
cambia indirizzo nella stessa scheda). Ma è un di più, non la garanzia. Il giro
di riordino all'avvio (chiudere tutto ciò che è rimasto appeso) resta l'ultima
rete, per quando a sparire è l'app intera.

Codice: `src/main/services/handlers.js` (`affidaChat`, `closeAndTriageChat`),
`src/pages/dashboard/dashboard.js` (l'avviso su `pagehide`, che ora è il
percorso veloce e non l'unico).
