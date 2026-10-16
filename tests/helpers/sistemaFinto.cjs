// Precaricato con `node --require`: il processo si crede sul sistema scritto in FILO_SISTEMA_FINTO prima che il file di
// prova carichi qualunque cosa. Lo usa tests/unit/aggiornamentiDaOgniSistema.test.mjs.
'use strict';

if (process.env.FILO_SISTEMA_FINTO) {
  Object.defineProperty(process, 'platform', { value: process.env.FILO_SISTEMA_FINTO, configurable: true });
}
