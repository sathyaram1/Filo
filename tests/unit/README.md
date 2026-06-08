# Unit test (logica pura, senza Electron)

Questo è il **livello base della piramide dei test** di Filo: test veloci sulla
**logica pura** dei moduli `src/shared/*` e dei servizi che non toccano Electron.

- **Runner**: `node:test` (incluso in Node 20, zero dipendenze nuove).
- **Come si lanciano**: `npm run test:unit` — girano in **millisecondi**, **senza
  aprire nessuna finestra Electron** (niente lampeggio in locale).
- **File**: `tests/unit/*.test.mjs`. Il `testMatch` di Playwright è `*.spec.mjs`,
  quindi i due livelli non si pestano: `npm run test:unit` ≠ `npm test`.

## Quando scrivere uno unit test qui (vs un e2e Playwright)

- **Qui (unit)**: funzioni con input→output netto, senza DOM né Electron —
  parsing, classificazione, validazione, trasformazioni di dati. Es:
  `modelCaps` (capacità modello da nome/metadati), parsing risposte provider,
  logica di categorizzazione URL.
- **e2e Playwright (`tests/*.spec.mjs`)**: tutto ciò che è **composito**
  (shell + WebContentsView native), interazione UI, wiring IPC. Gli unit test
  non vedono questi bug — restano dominio degli e2e (regressione completa: cloud).

## Come caricare un modulo IIFE

I moduli `src/shared/*` usano il pattern IIFE che si registra su `globalThis`.
Per testarli da un file ESM si caricano con `createRequire` (come fa il loader
del main process) e poi si legge l'oggetto da `globalThis`:

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require(join(__dirname, '..', '..', 'src', 'shared', 'modelCaps.js'));
const CAPS = globalThis.SN_MODEL_CAPS;
```

Scegli moduli **autonomi** (che non richiedono altri moduli caricati prima);
se servono dipendenze, caricale nell'ordine di `src/main/services/loader.js`.
