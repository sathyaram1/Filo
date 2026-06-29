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
//   Le regole sono salvate in FILO_PROXY_RULES (storage.json) tramite
//   FiloMem.setProxyRule() chiamato da TabManager.setDomainProxyRule().
//   Nessuna pagina (dashboard, opzioni, sicurezza) mostra la lista né offre
//   un controllo per cancellarle.
//   L'unico accesso è tramite chat ("togli la regola per netflix.com").
//   Invariante UX violata: se l'app salva N cose, l'utente deve poterle vedere.

import { test, expect } from './fixtures/electron.mjs';

test('le regole proxy dominio sono salvabili ma non visibili nella dashboard', async ({ app, shell }) => {
  // Aspettiamo che la shell sia pronta.
  await shell.waitForLoadState('domcontentloaded');
  await shell.waitForTimeout(500);

  // (a) Salva una regola dominio tramite SN_STORAGE (come fa setDomainProxyRule).
  const DOMAIN = 'audit-test-proxy-rules.example.com';
  const COUNTRY = 'fr';

  // Salviamo direttamente via storage (stesso percorso dell'handler).
  const addResult = await app.evaluate(async (_e, { domain, country }) => {
    const FM = globalThis.SN_FILO_MEMORY;
    if (!FM) return { error: 'SN_FILO_MEMORY non disponibile' };
    if (typeof FM.setProxyRule !== 'function') return { error: 'setProxyRule non è una funzione', keys: Object.keys(FM) };
    await FM.setProxyRule(domain, { country });
    const rules = await FM.listProxyRules();
    return { ok: true, rules };
  }, { domain: DOMAIN, country: COUNTRY });

  if (addResult.error) {
    // Se FM non è disponibile nel main process evaluate, prova via storage diretto.
    const addResult2 = await app.evaluate(async (_e, { domain, country }) => {
      const SN_STORAGE = globalThis.SN_STORAGE;
      if (!SN_STORAGE) return { error: 'SN_STORAGE non disponibile' };
      const settings = await SN_STORAGE.getSettings?.() || {};
      const KEYS = globalThis.SN_CONST?.STORAGE_KEYS;
      if (!KEYS) return { error: 'SN_CONST non disponibile' };
      const existing = await SN_STORAGE.getRaw?.(KEYS.FILO_PROXY_RULES, {}) || {};
      existing[domain] = country;
      await SN_STORAGE.setRaw?.(KEYS.FILO_PROXY_RULES, existing);
      const rules = await SN_STORAGE.getRaw?.(KEYS.FILO_PROXY_RULES, {});
      return { ok: true, rules };
    }, { domain: DOMAIN, country: COUNTRY });
    expect(addResult2.ok, `setProxyRule fallito: ${addResult2.error}`).toBe(true);
    expect(addResult2.rules).toHaveProperty(DOMAIN, COUNTRY);
  } else {
    expect(addResult.ok, `setProxyRule deve avere successo: ${addResult.error}`).toBe(true);
    expect(addResult.rules, 'la regola deve essere salvata').toHaveProperty(DOMAIN, COUNTRY);
  }

  // (b) La regola NON è visibile in nessuna pagina dell'app.
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
  // (Comportamento attuale documentato — deve essere false)
  expect(foundInAnyWindow,
    'BUG CONFERMATO: le regole proxy dominio salvate tramite REGOLA_PROXY_DOMINIO ' +
    'non sono visibili in nessuna pagina dell\'interfaccia — l\'utente non può sapere ' +
    'quali regole persistenti ha impostato né cancellarle dalla UI'
  ).toBe(false);
});
