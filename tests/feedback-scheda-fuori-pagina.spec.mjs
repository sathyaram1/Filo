// Un feedback più vecchio della pagina di caricamento entra ed esce dalla
// bacheca lo stesso (#583).
//
// Le schede della bacheca le scrive l'app di chi gestisce i feedback, e il giro
// generale guarda i 500 feedback più recenti PER DATA D'INVIO. Filo quel numero
// l'ha già passato: i più vecchi restano fuori da quel giro, e per loro la
// bacheca si congelava all'ultima volta che erano dentro.
//
// Si vedeva in due modi, tutti e due dal lato dell'utente:
//   · chiudere oggi una segnalazione vecchia non le scriveva nessuna scheda,
//     quindi il fix non compariva in bacheca e chi l'aveva mandata non riceveva
//     né l'annuncio né i crediti;
//   · rimettere in lavorazione un fix vecchio non gli toglieva la scheda,
//     quindi restava in bacheca come risolto, votabile e riapribile a pagamento.
//
// Il triage conosce l'id, quindi non ha bisogno di cercarlo in una pagina: qui
// si prova che ci va dritto. Senza quel pezzo questo spec è rosso: nessuna
// scheda scritta, nessuna tolta.

import { test, expect } from './fixtures/electron.mjs';

const VECCHIO = 'fb-di-un-anno-fa';
const PAGINA_DI_FILO = { url: 'filo://manage/manage.html' };

// Fa credere al processo principale di avere la sessione di chi gestisce i
// feedback e la chiave per leggerli. È l'unico pezzo finto: un token admin vero
// in uno spec non esiste. Torna il registratore delle chiamate alla vista
// pubblica.
async function bancoDiProva(app, feedback) {
  await app.evaluate(async (_electron, { id, fb }) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const ga = req('./auth/google-auth');
    ga.isAdmin = () => true;
    ga.getIdToken = async () => 'tok-di-prova';
    // La chiave privata: i campi di questo feedback sono in chiaro, quindi non
    // viene mai usata per decifrare. Serve solo perché il main sappia di averla:
    // senza, si ferma apposta invece di pubblicare alla cieca.
    process.env.FILO_FEEDBACK_PRIVKEY = 'chiave-di-prova';

    globalThis.__scheda = { pubblicate: [], tolte: [] };
    const FB = globalThis.SN_FEEDBACK;
    FB.updateStatus = async () => true;
    // Il caricamento generale: una pagina PIENA che non contiene il nostro
    // feedback, esattamente come in produzione.
    FB.list = async () => Array.from({ length: FB.LIST_PAGE_SIZE }, (_, i) => ({
      _id: `recente-${i}`, name: `Fix recente ${i}`, status: 'todo',
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
    }));
    FB.listPublic = async () => [];
    FB.getPublic = async () => null;
    FB.maxSeq = async () => null;
    FB.ensureSeqCounter = async () => 0;
    FB.getMany = async (ids) => (ids.includes(id) ? [globalThis.__fbVecchio] : []);
    FB.publishPublicCard = async (docId, card) => { globalThis.__scheda.pubblicate.push({ docId, card }); return true; };
    FB.unpublishPublicCard = async (docId) => { globalThis.__scheda.tolte.push(docId); return true; };
    globalThis.__fbVecchio = fb;
  }, { id: VECCHIO, fb: null });
}

async function metti(app, fb) {
  await app.evaluate((_e, v) => { globalThis.__fbVecchio = v; }, fb);
}

async function triage(app, campi) {
  return app.evaluate(async (_e, { campi, mittente }) => {
    const MSG = globalThis.SN_MSG.MSG;
    return globalThis.SN_HANDLE_MESSAGE({ type: MSG.FEEDBACK_UPDATE, ...campi }, mittente);
  }, { campi, mittente: PAGINA_DI_FILO });
}

function esito(app) {
  return app.evaluate(() => globalThis.__scheda);
}

const BASE = {
  _id: VECCHIO,
  name: 'Un fix di un anno fa',
  seq: 12,
  subSeq: 0,
  priority: 2,
  clientIdHash: 'a'.repeat(32),
  createdAt: '2025-09-01T00:00:00Z',
};

test('chiudere una segnalazione vecchia le scrive la scheda: entra in bacheca e premia chi l\'aveva mandata', async ({ app, shell }) => {
  void shell; // attende il boot
  await bancoDiProva(app);
  await metti(app, { ...BASE, status: 'done', resolvedAt: '2026-09-11T10:00:00Z', resolvedInVersion: '0.2.229', userNote: 'sistemato' });

  const r = await triage(app, { id: VECCHIO, status: 'done', userNote: 'sistemato' });
  expect(r.ok).toBe(true);

  const out = await esito(app);
  const mia = out.pubblicate.find((p) => p.docId === VECCHIO);
  expect(mia, 'la scheda del feedback vecchio non è stata scritta: in bacheca non comparirà mai').toBeTruthy();
  expect(mia.card.name).toBe('Un fix di un anno fa');
  expect(mia.card.status).toBe('done');
  expect(mia.card.userNote).toBe('sistemato');
  // La cifra della ricompensa segue quanto contava la segnalazione: senza la
  // scheda, chi l'aveva mandata non prenderebbe niente.
  expect(mia.card.reward).toBe(200);
  expect(out.tolte).not.toContain(VECCHIO);
});

test('rimettere in lavorazione un fix vecchio gli toglie la scheda: esce dalla bacheca', async ({ app, shell }) => {
  void shell;
  await bancoDiProva(app);
  await metti(app, { ...BASE, status: 'todo' });

  const r = await triage(app, { id: VECCHIO, status: 'todo' });
  expect(r.ok).toBe(true);

  const out = await esito(app);
  expect(out.tolte, 'la scheda resta in bacheca: il fix continua a risultare risolto, votabile e riapribile a pagamento')
    .toContain(VECCHIO);
  expect(out.pubblicate.find((p) => p.docId === VECCHIO)).toBeFalsy();
});

test('un feedback fermato dalla sicurezza non entra in bacheca nemmeno per questa strada', async ({ app, shell }) => {
  void shell;
  await bancoDiProva(app);
  await metti(app, {
    ...BASE, status: 'done', resolvedInVersion: '0.2.229',
    pipeline: { action: 'block_attack', l2Class: 'attack' },
  });

  const r = await triage(app, { id: VECCHIO, status: 'done' });
  expect(r.ok).toBe(true);

  const out = await esito(app);
  expect(out.pubblicate.find((p) => p.docId === VECCHIO), 'materiale segnalato dalla sicurezza pubblicato in bacheca').toBeFalsy();
  expect(out.tolte).toContain(VECCHIO);
});
