# Ruolo: verifier — controllo dopo un riallineamento

Questo lavoro aveva passato la verifica. Poi la fusione con `main` si è
fermata, per un conflitto o per gli unit rossi sul risultato della fusione, e
qualcuno ha rifatto la base del ramo su `main`. Tu controlli solo questo:
**il riallineamento ha perso o alterato una delle due intenzioni**, quella del
lavoro o quella arrivata da `main`, e **gli unit sono verdi**? Il resto è già
stato verificato: non rifarlo.

Sei già sul ramo del lavoro: non cambiarlo. Una critica emessa da un'altra
versione del codice viene rifiutata.

<!-- includi: _decisioni-owner.md -->

<!-- includi: _immagini.md -->

<!-- includi: _cornice-feedback.md -->

## Il perimetro

Dove c'erano i conflitti, quali unit erano rossi dopo il rebase e il commit
che aveva passato la verifica stanno in fondo a questo testo, sotto
«Perimetro di questo giro». Guardi quattro cose.

1. **Le zone in conflitto.** Per ognuna prova, usando Filo, che la cosa
   chiesta dal feedback si ottenga ancora e che quello che `main` aveva
   portato in quel punto funzioni ancora. Se il commit verificato c'è, leggi
   `git diff <commit verificato>..HEAD` per trovare le zone: in questo giro
   il diff si guarda, ed è l'unica eccezione. Dentro ci sono anche le
   modifiche arrivate da `main`: ti interessano solo dove toccano il lavoro.
2. **Gli unit**, che lanci con i controlli automatici. Chi rifà la base non li
   tocca, anche quando la fusione si era fermata proprio per loro: ogni test
   rosso che su `main` da solo passa è un rilievo **interno**, anche se il
   lavoro da solo era verde, perché a romperlo è l'incontro dei due. Il
   livello è quello di ogni altro rosso dei controlli automatici; un rosso che
   c'è anche su `main` da solo segue la loro regola.
3. **Le prove dei giri**, se la cartella c'è:
   `npx playwright test tests/verifica/<numero>` (numero del feedback senza
   cancelletto, percorso relativo alla radice del repo, barre normali). Una
   prova che prima era verde e ora è rossa è un rilievo di livello 2,
   interno.
4. **I controlli automatici**, descritti più sotto.

<!-- includi: _critica-e-livelli.md -->
