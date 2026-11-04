// Le parole d'ordine del server (routineKeys, ROUTINE-AUTH-SPEC): i poteri, dove va la parola appena nata e le
// impostazioni delle chiavi di routine. Logica pura, la usano Gestione → Automazioni, il main e routine-keys.mjs;
// l'ultima parola resta al server. Prove: tests/unit/routineChiavi.test.mjs.

(function (global) {
  'use strict';

  // Un segreto, un potere: l'ordine è quello del menu di Gestione.
  const POTERI = Object.freeze(['routine', 'sessione', 'manutentore', 'owner-non-fidato', 'build']);
  const NOMI = Object.freeze({
    routine: 'Routine',
    sessione: 'Sessione locale',
    manutentore: 'Manutentore',
    'owner-non-fidato': 'Tu da una sede non fidata',
    build: 'Costruzione',
  });

  // Dove va la parola appena nata, per potere. Una di routine NON va nell'ambiente: lo eredita ogni lavoratore che
  // parte da lì; sta solo nel prompt della routine schedulata, l'unica cosa che l'orchestratore tiene per sé.
  const DOVE_VA = Object.freeze({
    build: "Va nell'ambiente «rilascio» del repo (Settings → Environments → rilascio), come FILO_BUILD_PASSPHRASE: fra i segreti del repo non la legge nessuno.",
    routine: 'Va nel PROMPT della routine schedulata: "routine automatica. <parola d\'ordine>".\n'
      + "Mai nell'ambiente: da lì la erediterebbe ogni lavoratore che parte.",
    // SPEC-MANUTENTORE § 3: serve alla chat e alla sessione locale; la sessione accesa dal pacemaker ha il suo biglietto.
    manutentore: "È la chiave del manutentore: apre i suoi ordini sul server, mai fusioni, L5 o codice. Va nell'ambiente di QUESTO PC,\n"
      + "come FILO_MANUTENTORE_KEY: la usano npm run manutentore e la sua chat. Mai nell'ambiente di una routine che lavora\n"
      + 'feedback: la sessione che il pacemaker accende per il manutentore non la vuole, ha il suo biglietto.',
    'owner-non-fidato': "È la tua chiave da una sede non fidata: i poteri del manutentore più le domande per te (leggere, rispondere,\n"
      + "archiviare, riaprire). Niente fusioni, L5, chiavi, interruttori, «segna fidato», abbassare una priorità 3.\n"
      + 'Mettila solo nella sede da cui lavori tu. Quello che scrive nasce non fidato: le risposte che registra le trovi\n'
      + 'segnate in Gestione → Domande, e quelle di ieri nel recap del mattino.',
    // Spec identità delle sessioni § 1: prende il biglietto locale al posto del token admin.
    sessione: "È la chiave delle sessioni locali sul tuo PC: va in tests/agent/.env come FILO_SESSIONE_PAROLA, al posto del\n"
      + 'token admin. Con quella una sessione prende il suo biglietto e lavora; le risposte che registra alle domande le trovi\n'
      + 'segnate in Gestione → Domande. Niente «segna fidato», approvazioni di fusione, chiavi, interruttori.',
  });

  // Le impostazioni che valgono solo per una chiave di routine, coi loro valori e il predefinito del server.
  const IMPOSTAZIONI = Object.freeze({
    account: Object.freeze({ valori: Object.freeze(['A', 'B']), predefinito: '', etichetta: 'Account' }),
    rete: Object.freeze({ valori: Object.freeze(['limitata', 'aperta']), predefinito: 'aperta', etichetta: 'Rete' }),
    lavori: Object.freeze({ valori: Object.freeze(['normali', 'server']), predefinito: 'normali', etichetta: 'Lavori' }),
    ambiente: Object.freeze({ valori: Object.freeze(['normale', 'riservati']), predefinito: 'normale', etichetta: 'Ambiente' }),
  });

  // Un nome lungo come una riga dell'elenco: oltre si rifiuta col numero, mai si taglia.
  const NOME_MAX = 64;
  const DESCRIZIONE_MAX = 500;

  /** La richiesta di una parola nuova, controllata: { ok, dati: { slug, scope, label } } o { ok:false, testo }. PURA. */
  function validaNuova(v) {
    const slug = String((v && v.slug) || '').trim();
    const scope = String((v && v.scope) || '').trim();
    const label = String((v && v.label) || '').trim();
    if (!slug) return { ok: false, testo: 'Dalle un nome: è quello con cui la ritrovi e la revochi.' };
    if (slug.length > NOME_MAX) return { ok: false, testo: `Il nome è di ${slug.length} caratteri, il massimo è ${NOME_MAX}.` };
    if (/\s/.test(slug)) return { ok: false, testo: 'Il nome non può avere spazi: usa un trattino.' };
    if (!POTERI.includes(scope)) return { ok: false, testo: 'Scegli a cosa serve.' };
    if (label.length > DESCRIZIONE_MAX) return { ok: false, testo: `La descrizione è di ${label.length} caratteri, il massimo è ${DESCRIZIONE_MAX}.` };
    return { ok: true, dati: { slug, scope, label } };
  }

  /** Un cambio di impostazione su una chiave di routine: { ok, dati: { op, slug, [op]: valore } } o { ok:false, testo }. PURA. */
  function validaImpostazione(v) {
    const op = String((v && v.op) || '');
    const slug = String((v && v.slug) || '').trim();
    const regola = Object.prototype.hasOwnProperty.call(IMPOSTAZIONI, op) ? IMPOSTAZIONI[op] : null;
    if (!regola) return { ok: false, testo: 'Impostazione sconosciuta.' };
    if (!slug) return { ok: false, testo: 'Manca la chiave da cambiare.' };
    const valore = String((v && v.valore) || '');
    if (!regola.valori.includes(valore)) return { ok: false, testo: `${regola.etichetta}: ${regola.valori.join(' o ')}.` };
    return { ok: true, dati: { op, slug, [op]: valore } };
  }

  /** Il valore di un'impostazione come lo vede il server (campo assente = predefinito). PURA. */
  function valoreDi(chiave, op) {
    const regola = IMPOSTAZIONI[op];
    if (!regola) return '';
    const v = chiave && chiave[op];
    return regola.valori.includes(v) ? v : regola.predefinito;
  }

  /** Le chiavi del server pulite per la pagina: attive prima, poi le revocate; dentro, per nome. PURA. */
  function ordina(keys) {
    const testo = (x) => (typeof x === 'string' ? x : '');
    return (Array.isArray(keys) ? keys : [])
      .filter((k) => k && typeof k.slug === 'string' && k.slug)
      .map((k) => ({
        slug: k.slug,
        scope: testo(k.scope),
        label: testo(k.label),
        revoked: k.revoked === true,
        lastUsedAt: testo(k.lastUsedAt),
        createdAt: testo(k.createdAt),
        account: testo(k.account),
        rete: testo(k.rete),
        lavori: testo(k.lavori),
        ambiente: testo(k.ambiente),
      }))
      .sort((a, b) => (a.revoked - b.revoked) || a.slug.localeCompare(b.slug));
  }

  global.SN_ROUTINE_CHIAVI = Object.freeze({
    POTERI, NOMI, DOVE_VA, IMPOSTAZIONI, NOME_MAX, DESCRIZIONE_MAX, validaNuova, validaImpostazione, valoreDi, ordina,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
