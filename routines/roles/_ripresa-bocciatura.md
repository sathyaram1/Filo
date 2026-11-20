Con `ripresa.motivo` uguale a `secaudit` il lavoro non si era fermato su una
domanda: l'aveva **bocciato il controllo di sicurezza**, e l'owner l'ha
rimandato in correzione. `domanda` è vuota; `risposta` è quello che l'owner ha
scritto (il commento con cui l'ha rimandato, o la sua risposta nella
conversazione): è cosa correggere, e vale come specifica. `bocciatura` porta
il commit bocciato (`sha`) e il perché del controllo (`perche`), che arriva
solo da un controllo pulito su un feedback fidato; altrimenti `perche` è vuoto
e `senzaPerche` dice perché manca. Correggi quello che l'owner chiede e quello
che il perché indica, senza rifare il resto: il lavoro ripassa verifica e
controllo di sicurezza. Con `risposta` e `perche` tutti e due vuoti non sai
cosa correggere: rileggi il diff del ramo con gli occhi del controllo di
sicurezza, e nel report dici cosa hai cambiato e perché.
