// Verifica #583, giro 4 — le porte che stanno ACCANTO a quelle chiuse.
//
// Questo lavoro ha spostato dentro Filo la lettura dei feedback e ha messo su
// quelle porte un controllo di provenienza: una pagina di un sito visitato
// bussa e si sente dire di no prima ancora che si guardi chi è loggato. Il
// giro 2 l'ha esteso alle porte che scrivono, il giro 3 alle altre porte del
// proprietario. Restavano, nello stesso canale, porte senza quel controllo:
//
//   · chi sei, che rispondeva con l'indirizzo email e l'identificativo
//     dell'account di chi sta usando Filo;
//   · esci, con cui un sito visitato faceva uscire dall'account chi sta usando
//     Filo (da lì in poi la posta delle segnalazioni non si apre e la bacheca
//     di tutti smette di aggiornarsi);
//   · vota, ritira il voto e riapri a pagamento, che non sono del proprietario
//     ma di chiunque abbia fatto l'accesso: con una sessione aperta un sito
//     visitato votava al posto suo, gli cancellava il voto e gli spendeva i
//     crediti per riaprire un fix, aprendo a suo nome una segnalazione col
//     testo che voleva;
//   · l'elenco di chi usa Filo e il regalo di crediti, i due comandi del
//     proprietario che vivono nella chat della dashboard.
//
// Dopo la correzione del giro 4: uscire, votare, ritirare, riaprire, elencare e
// regalare rispondono «rifiutato per provenienza». «Chi sei» invece risponde
// ancora, perché serve a due pezzi di Filo che girano DENTRO le pagine dei siti
// (la griglia del tasto destro, che mostra l'icona Feedback solo a chi i
// feedback li gestisce, e il pannello del red-team, che invita ad accedere), ma
// senza identità: niente email, niente nome, niente identificativo.
//
// La guardia permanente è `tests/feedback-canali-origine.spec.mjs`.

import { test, expect } from './../../fixtures/electron.mjs';

const SITO = { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' };
const PAGINA_DI_FILO = { url: 'filo://board/board.html' };

test('un sito visitato non scopre CHI sta usando Filo, e non lo fa uscire', async ({ app, shell }) => {
  void shell; // attende il boot: il dispatcher dev'essere montato

  const out = await app.evaluate(async (_electron, { sito, filo }) => {
    const MSG = globalThis.SN_MSG.MSG;
    return {
      chiSeiDalSito: await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AUTH_STATUS }, sito),
      chiSeiDaFilo: await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AUTH_STATUS }, filo),
      esci: await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AUTH_SIGNOUT }, sito),
    };
  }, { sito: SITO, filo: PAGINA_DI_FILO });

  // L'identità non attraversa il confine: un sito visitato non impara né
  // l'indirizzo email né l'identificativo dell'account.
  expect(out.chiSeiDalSito.profile, 'il profilo di chi usa Filo finisce a un sito visitato').toBeUndefined();
  expect(out.chiSeiDalSito.uid, 'l\'identificativo dell\'account finisce a un sito visitato').toBeUndefined();
  expect(Object.keys(out.chiSeiDalSito).sort()).toEqual(['isAdmin', 'ok', 'signedIn']);

  // Da una pagina di Filo la risposta resta intera: è da lì che le pagine
  // mostrano chi è entrato.
  expect(out.chiSeiDaFilo.ok).toBe(true);
  expect(Object.keys(out.chiSeiDaFilo).sort()).toEqual(['isAdmin', 'ok', 'profile', 'signedIn', 'uid']);

  expect(out.esci.ok, 'un sito visitato fa uscire dall\'account chi sta usando Filo').toBe(false);
  expect(String(out.esci.code || '')).toBe('forbidden');
});

test('un sito visitato non vota, non ritira voti e non spende i crediti di chi usa Filo', async ({ app, shell }) => {
  void shell;

  const out = await app.evaluate(async (_electron, S) => {
    const MSG = globalThis.SN_MSG.MSG;
    const bussa = (m) => globalThis.SN_HANDLE_MESSAGE(m, S);
    return {
      vota: await bussa({ type: MSG.BOARD_CAST_VOTE, id: 'fb-uno', vote: 'works' }),
      ritira: await bussa({ type: MSG.BOARD_CLEAR_VOTE, id: 'fb-uno' }),
      riapri: await bussa({ type: MSG.BOARD_REOPEN, id: 'fb-uno', text: 'scritto da un sito' }),
      elencoUtenti: await bussa({ type: MSG.OWNER_LIST_USERS }),
      regalaCrediti: await bussa({ type: MSG.OWNER_GIFT_CREDITS, email: 'chiunque@example.com', amount: 1000 }),
    };
  }, SITO);

  for (const [porta, r] of Object.entries(out)) {
    expect(r.ok, `${porta}: un sito visitato non deve ottenere niente`).toBe(false);
    expect(
      String(r.code || ''),
      `${porta}: il rifiuto deve arrivare per PROVENIENZA, non perché qui manca una sessione o un amministratore`,
    ).toBe('forbidden');
  }
});
