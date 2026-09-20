# Una classe che scrive `display` deve lasciarsi nascondere

[← Tutti i pattern](../PATTERNS.md)

L'attributo `hidden` sembra una garanzia: lo metti, l'elemento sparisce. Non è
così. `hidden` sparisce perché il foglio di stile del browser dice
`[hidden] { display: none }`, ed è una regola debolissima: qualunque regola
scritta da noi con un selettore di classe la batte. Quindi

```css
.arc-cmd-toggle { display: inline-flex; }
```

rende quell'elemento **impossibile da nascondere** con `hidden`. Il codice
della pagina glielo mette, la pagina crede di averlo tolto, e resta a schermo.

Non è un caso di scuola. Nella stessa pagina è successo due volte, a due mesi
di distanza: la prima con l'intestazione di una sezione — e chi l'ha risolta
ha scritto accanto perché — la seconda con l'interruttore «Mostra anche i
comandi», che è rimasto in vista con scritto «(0)» addosso a ogni utente che
salvava la sua prima chat, su una casella che non poteva fare niente (#525,
terzo giro di verifica). La prima cura era stata scritta come una toppa per
quell'elemento lì, non come una regola: l'elemento accanto è ricascato nella
stessa buca.

**La regola: dove scrivi un `display` in una classe, scrivi anche la riga che
lo lascia nascondere.** Sono due righe vicine, nello stesso punto del foglio,
così chi legge la seconda capisce la prima:

```css
.arc-cmd-toggle[hidden] { display: none; }
.arc-cmd-toggle { display: inline-flex; align-items: center; gap: 6px; }
```

Vale per `flex`, `grid`, `inline-flex`, `block`, `inline-block`: tutto ciò che
non è `display: none`. Non vale la pena distinguere «questo elemento non verrà
mai nascosto»: costa una riga adesso e nessuno saprà, fra un anno, che quella
promessa era stata fatta.

Come ci si accorge che è successo: l'attributo c'è e l'elemento si vede. Nel
test non basta `toHaveAttribute('hidden')` — quello sarebbe verde anche con
l'elemento a schermo. Si asserisce che **non si vede**:

```js
await expect(page.locator('#showCommandsLabel')).toBeHidden();
// oppure, dagli hook: el.getBoundingClientRect().height === 0
```

Lo stesso vale per il suo gemello: un `visibility: visible` o un `opacity: 1`
scritti in una classe reggono contro chi prova a spegnerli da JS con
`style.visibility`/`style.opacity` solo perché lo stile inline vince — ma
appena la spegnitura passa da una classe, vince la specificità, non
l'intenzione.

Codice: `src/pages/archive/archive.html` (le due righe `[hidden]`, accanto alle
classi che dichiarano il `display`), `tests/cronologia-chat.spec.mjs`
(«senza nemmeno una chat di comando l'interruttore non si vede»).
