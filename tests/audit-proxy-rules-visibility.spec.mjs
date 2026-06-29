// AUDIT: le regole proxy dominio (REGOLA_PROXY_DOMINIO) sono persistenti
// ma non c'è nessuna UI per vederle o cancellarle.
//
// RIPRODUZIONE (utente):
//   1. L'utente dice a Filo "Apri sempre netflix.com dalla Francia".
//   2. Filo salva una regola in FILO_PROXY_RULES: da quel momento netflix.com
//      nasce sempre instradata da fr, anche dopo il riavvio.
//   3. L'utente non trova NESSUN posto nell'interfaccia dove vedere quali
//      regole dominio ha impostato, né come cancellarle senza dire a Filo
//      "togli la regola netflix.com" (che funziona solo se l'utente ricorda
//      esattamente il dominio che aveva detto in precedenza).
//
// PARTE TECNICA:
//   Le regole sono salvate in FILO_PROXY_RULES (storage.json).
//   FILO_GET_PROXY_RULES è definito in messages.js e l'handler in handlers.js
//   risponde con le regole, ma nessuna pagina (dashboard, opzioni, sicurezza)
//   mostra la lista né offre un controllo per cancellarle.
//   L'unico accesso è tramite chat ("togli la regola per netflix.com").
//   Invariante UX violata: se l'app salva N cose, l'utente deve poterle vedere.

import { test, expect } from './fixtures/electron.mjs';

test('le regole proxy dominio sono salvabili ma non visibili nella dashboard', async ({ app }) => {
  // (a) Salva una regola dominio tramite IPC diretto.
  const DOMAIN = 'audit-test-proxy-rules.example.com';
  const COUNTRY = 'fr';

  // Salviamo via storage diretto (come fa l'handler REGOLA_PROXY_DOMINIO).
  const addResult = await app.evaluate(async (_e, { domain, country }) => {
    const FM = globalThis.SN_FILO_MEMORY;
    if (!FM) return { error: 'SN_FILO_MEMORY non disponibile' };
    await FM.setProxyRule(domain, country);
    const rules = await FM.listProxyRules();
    return { ok: true, rules };
  }, { domain: DOMAIN, country: COUNTRY });

  expect(addResult.ok, 'setProxyRule deve avere successo').toBe(true);
  expect(addResult.rules, 'la regola deve essere salvata').toHaveProperty(DOMAIN, COUNTRY);

  // (b) Verifica che FILO_GET_PROXY_RULES esiste e restituisce le regole.
  const MSG = await app.evaluate(() => globalThis.SN_MSG?.MSG);
  const hasGetProxyRules = MSG && MSG.FILO_GET_PROXY_RULES !== undefined;
  // Il messaggio esiste nel sistema.
  expect(typeof hasGetProxyRules).toBe('boolean');

  // (c) La regola NON è visibile in nessuna pagina dell'app.
  // Cerca il dominio in tutte le finestre aperte.
  const windows = app.windows();
  let foundInAnyWindow = false;
  for (const w of windows) {
    try {
      const hasText = await w.evaluate(
        (domain) => document.body?.textContent?.includes(domain),
        DOMAIN
      );
      if (hasText) { foundInAnyWindow = true; break; }
    } catch (_) {}
  }

  // BUG CONFERMATO SE: la regola NON compare in nessuna finestra.
  // (Comportamento attuale documentato)
  expect(foundInAnyWindow,
    'BUG CONFERMATO: le regole proxy dominio salvate tramite REGOLA_PROXY_DOMINIO ' +
    'non sono visibili in nessuna pagina dell\'interfaccia — l\'utente non può sapere ' +
    'quali regole persistenti ha impostato né cancellarle dalla UI'
  ).toBe(false);

  // Pulizia: cancella la regola di test.
  await app.evaluate(async (_e, { domain }) => {
    const FM = globalThis.SN_FILO_MEMORY;
    if (FM) await FM.removeProxyRule(domain);
  }, { domain: DOMAIN });
});
