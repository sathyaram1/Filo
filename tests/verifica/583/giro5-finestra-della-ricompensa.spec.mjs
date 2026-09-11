// Verifica #583, giro 5 — la finestra di caricamento vista dal lato di chi ha
// segnalato.
//
// I giri 3 e 4 avevano trovato lo stesso danno da due porte: una segnalazione
// più vecchia della pagina che si carica non arriva in bacheca, e chi l'aveva
// mandata non riceve né l'annuncio né i crediti. La correzione del giro 4 ha
// chiuso la porta di chi SCRIVE: adesso la scheda di una segnalazione vecchia
// chiusa oggi viene scritta lo stesso.
//
// Resta aperta la porta di chi LEGGE. L'annuncio della ricompensa, sul computer
// di chi ha segnalato, non chiede le schede per id: ne chiede una pagina, le
// 200 più recenti per data d'invio. Una segnalazione vecchia ha una data
// d'invio vecchia, quindi la sua scheda — appena scritta dalla correzione del
// giro 4 — sta fuori da quella pagina e l'annuncio non la vede mai.
//
// Le cifre vere del progetto (settembre 2026): 552 feedback chiusi, cioè 552
// schede. La duecentesima è la #323. Tutte le segnalazioni sotto quel numero
// sono fuori: la scheda c'è, la bacheca la mostra, e chi l'ha mandata non
// riceve niente.
//
// La prova modella `listPublic` come fa Firestore davvero — ordinate per data
// d'invio decrescente, tagliate a `pageSize` — e mette la scheda di questa
// installazione appena fuori dalla pagina.
//
// NOTA per chi corregge: la prova diventa verde comunque si scelga di chiudere
// la porta (chiedere le schede per id, chiedere anche le chiuse di recente,
// alzare il tetto). Quello che deve restare vero è che una segnalazione vecchia
// risolta oggi paghi chi l'ha mandata come una recente.

import { test, expect } from './../../fixtures/electron.mjs';

test('una segnalazione vecchia risolta oggi paga chi l\'ha mandata', async ({ app, shell }) => {
  void shell; // attende il boot: i moduli condivisi devono essere montati

  const out = await app.evaluate(async () => {
    const FB = globalThis.SN_FEEDBACK;
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;
    const S = globalThis.SN_STORAGE;

    const mio = 'installazione-di-prova-583-giro5';
    const veroGetRaw = S.getRaw.bind(S);
    S.getRaw = async (k, d) => (k === 'sn_feedback_client_id' ? mio : veroGetRaw(k, d));
    const mioHash = await H.hashClientId(mio);

    // Un feedback chiuso, con la data d'invio che decide la sua posizione.
    // La scheda la costruisce il codice vero del publisher, non la prova.
    const scheda = (id, giorno, hash) => ({
      _id: id,
      ...V.cardFor({
        _id: id,
        name: `Segnalazione ${id}`,
        text: 'testo della segnalazione',
        seq: 900, subSeq: 0,
        status: 'done',
        priority: 2,
        resolvedInVersion: '0.2.228',
        // la data d'invio: è l'unica cosa che decide chi entra nella pagina
        createdAt: `${giorno}T10:00:00Z`,
        // chiusa OGGI, come una qualunque appena risolta
        resolvedAt: '2026-09-11T10:00:00Z',
        userNote: 'Sistemato: ora funziona.',
        clientIdHash: hash,
      }),
    });

    const altrui = await H.hashClientId('un-altra-installazione');
    const schede = [];
    // 250 segnalazioni di altri, mandate di recente: riempiono la pagina.
    for (let i = 0; i < 250; i += 1) {
      const g = new Date(Date.UTC(2026, 7, 1) + i * 3600_000).toISOString().slice(0, 10);
      schede.push(scheda(`altrui-${String(i).padStart(3, '0')}`, g, altrui));
    }
    // La mia: mandata a maggio, cioè più vecchia di tutte quelle sopra.
    schede.push(scheda('la-mia-vecchia', '2026-05-20', mioHash));
    // Un'altra mia, mandata di recente: è il controllo. Se anche questa non
    // pagasse, il rosso non direbbe niente sulla finestra — direbbe che
    // l'annuncio non funziona più per nessuno.
    schede.push(scheda('la-mia-recente', '2026-08-30', mioHash));

    // Ordinamento e taglio come li fa Firestore: data d'invio decrescente,
    // `limit` = pageSize. La mia scheda esiste, ma è la 251esima.
    schede.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const veroListPublic = FB.listPublic;
    FB.listPublic = async ({ pageSize = 500 } = {}) => schede.slice(0, pageSize);

    try {
      const r = await globalThis.SN_HANDLE_MESSAGE(
        { type: globalThis.SN_MSG.MSG.GET_FEEDBACK_REWARDS },
        { url: 'filo://newtab/' },
      );
      return { r, posizione: schede.findIndex((c) => c._id === 'la-mia-vecchia') };
    } finally {
      FB.listPublic = veroListPublic;
      S.getRaw = veroGetRaw;
    }
  });

  // Prima di tutto: la scheda c'è davvero, ed è fuori dalla pagina che il
  // popup chiede. Se un domani il popup chiedesse tutto, questa riga resta
  // vera e la prova continua a voler dire qualcosa.
  expect(out.posizione).toBeGreaterThanOrEqual(200);

  expect(out.r.ok).toBe(true);
  const miei = (out.r.rewards || []).map((x) => x.id);
  // Il controllo: la mia segnalazione recente paga. Senza questa riga un rosso
  // qui sotto potrebbe voler dire tutt'altro.
  expect(miei, 'l\'annuncio non paga più nemmeno una segnalazione recente: il rosso qui sotto non parla della finestra').toContain('la-mia-recente');
  expect(
    miei,
    'la segnalazione vecchia è stata risolta e la sua scheda è in bacheca, ma chi l\'aveva mandata non riceve né l\'annuncio né i crediti: il popup guarda solo le schede più recenti per data d\'invio',
  ).toContain('la-mia-vecchia');
});
