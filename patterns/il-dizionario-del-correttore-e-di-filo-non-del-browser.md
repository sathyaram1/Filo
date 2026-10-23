# Il dizionario del correttore è di Filo, non del browser

[← Tutti i pattern](../PATTERNS.md)

Quali parole sono sbagliate lo dice il dizionario di Filo (Hunspell in WebAssembly nel processo principale,
`src/main/services/dizionarioDiFilo.js`), mai `webFrame.isWordMisspelled` né `getWordSuggestions`. Le pagine lo
chiedono con `SN_DIZIONARIO` (`src/preload/dizionario.js`), e il browser risponde solo finché quello di Filo non è
pronto.

Il perché (#1585). Su Windows Chromium controlla l'ortografia in due posti: le lingue che il sistema ha installate le
controlla il correttore di Windows, nel processo del browser; le altre Hunspell, nella pagina. `isWordMisspelled`
interroga solo la parte della pagina, e una lingua lasciata al sistema lì è «spenta»: con nessuna lingua accesa la
risposta è «giusta» per ogni parola. Su un Windows italiano l'italiano è del sistema, quindi i candidati del correttore
(#1446) non nascevano mai, e col modello spento non c'era nessun segno. Su un Windows inglese col solo italiano di
Hunspell nella pagina, ogni parola inglese nasceva sbagliata. Su Mac il correttore è tutto del sistema. Non c'è
un'opzione per spegnere il correttore di Windows (Chromium la tiene solo per le sue prove), e il menu nativo intanto
funziona: il guasto si vede solo dove Filo chiede alla pagina.

Le sorgenti sono le stesse ovunque: l'italiano da `assets/dizionari/sorgenti` (Latin-9 con CRLF, convertito al
caricamento, più il delta che Chromium aggiunge al suo `.bdic`), l'inglese dai pacchetti `dictionary-en` e
`dictionary-en-gb`. Le lingue le sceglie `spellLanguages.js` come per il browser: l'italiano sempre, l'inglese se è
la lingua del sistema. I limiti di parola sono quelli di Chromium (64 byte per il controllo, 24 per le proposte, al
più cinque proposte alternate fra le lingue).

Il correttore chiede le parole nuove di un testo in un viaggio solo (`pareriDelTesto` in `src/content/spellcheck.js`):
una domanda sincrona per parola bloccava la pagina per centinaia di viaggi al primo ingresso in un campo lungo.

Prove: `tests/unit/dizionarioDiFilo.test.mjs` (gira anche nel lavoro Windows della suite) e, con il browser lasciato
senza lingue come su Windows, `tests/correttore-dizionari.spec.mjs`. Per Mac nessuna prova lo dice senza una macchina
vera.
