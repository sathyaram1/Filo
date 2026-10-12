// #1085 giro 2 — un proxy che risponde 403 al rinnovo della sessione Google non deve far dire a Gestione
// «non risulti amministratore, crea il documento admins»: è il servizio di accesso che non risponde.
// Logica pura, come la strada del triage: l'errore del rinnovo passa dalla traduzione dei 403.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const guasti = require('../../../src/main/auth/guastiAccesso.js');
const { permissionDeniedHelp } = require('../../../src/main/services/feedbackError.js');

test('r1 rinnovo respinto da un proxy con 403: Gestione dice che il servizio di accesso non risponde, non che non sei amministratore', () => {
  for (const status of [403, 407, 503]) {
    const raw = guasti.nonRaggiungibile(status).message;
    const visto = permissionDeniedHelp(raw, { email: 'owner@prova.test', email_verified: true }, { serverAdmin: null });
    expect(visto, `HTTP ${status}`).not.toContain('amministratore');
    expect(visto, `HTTP ${status}`).not.toContain('admins');
  }
});
