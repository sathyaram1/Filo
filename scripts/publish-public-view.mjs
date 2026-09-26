// Pubblica (e rimette in pari) la VISTA PUBBLICA dei feedback — #583.
//
// COSA FA
//   Legge i feedback con le credenziali dell'owner, li decifra, decide con la
//   logica PURA di src/shared/feedbackPublicView.js quali meritano una scheda
//   pubblica (`feedback-public/{id}`: solo campi pubblici, solo fix chiusi e
//   mai segnalati dalla sicurezza), e scrive le differenze: le schede nuove o
//   cambiate, e via quelle che non devono più esserci. Rimette in pari anche
//   `counters/feedbackSeq`, il contatore da cui i feedback nuovi prendono il
//   numero ora che la collezione non si può più interrogare senza credenziali.
//
// QUANDO SERVE
//   Subito dopo aver pubblicato le regole (`firebase deploy --only
//   firestore:rules`): da quel momento la bacheca legge la vista, che va
//   riempita una prima volta. Dopo, lo fa da sé l'app dell'owner (il main
//   sincronizza a ogni triage e a ogni caricamento della dashboard), ma questo
//   comando resta la strada per rifarlo a mano senza aprire Filo.
//
// USO
//   node scripts/publish-public-view.mjs              scrive davvero
//   node scripts/publish-public-view.mjs --dry-run    dice solo cosa farebbe
//
// SERVE
//   - le credenziali dell'owner (le stesse degli altri script: service account
//     o `FILO_ADMIN_REFRESH_TOKEN`, vedi scripts/lib/firestore-auth.mjs);
//   - la CHIAVE PRIVATA dei feedback (`FILO_FEEDBACK_PRIVKEY`): senza, lo
//     status di ogni feedback è un blob e non si può dire di nessuno che sia
//     chiuso e pulito. In quel caso il comando si ferma invece di svuotare la
//     bacheca.

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquireBearer } from './lib/firestore-auth.mjs';
import { decryptFeedbackList, PLACEHOLDER } from './lib/decrypt-feedback-fields.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

require(resolve(ROOT, 'src', 'shared', 'feedback.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackPublicView.js'));

const FB = globalThis.SN_FEEDBACK;
const PV = globalThis.SN_FEEDBACK_PUBLIC_VIEW;

// Quante schede fuori pagina si chiedono per richiesta (batchGet).
const SCHEDE_PER_VOLTA = 200;

// Le segnalazioni che la pagina PER DATA D'INVIO non vede, e che qui servono
// lo stesso. È la stessa domanda che l'app dell'owner fa dentro Filo
// (`conLeSegnalazioniFuoriPagina` in src/main/services/handlers/auth.js), e va
// fatta anche da qui: senza, una segnalazione vecchia chiusa dal server o da
// riga di comando non avrebbe mai una scheda — niente bacheca, niente annuncio
// e niente crediti per chi l'aveva mandata.
//
//   · i feedback CHIUSI più di recente (ordinati per data di chiusura): è lì
//     che sta una segnalazione vecchia chiusa oggi;
//   · i feedback delle schede già in bacheca che non sono nella pagina: così un
//     fix vecchio che torna in lavorazione perde la scheda, invece di restare
//     «risolto», votabile e riapribile a pagamento.
//
// Best-effort: se una delle due domande non riesce si prosegue con quello che
// si ha, invece di non pubblicare niente.
// Torna anche `schedeCoperte`: se il feedback di OGNI scheda in bacheca è
// passato di qui, una scheda rimasta sola è un orfano vero.
async function conLeSegnalazioniFuoriPagina(base, bearer, schede) {
  const rows = Array.isArray(base) ? base.slice() : [];
  const visti = new Set(rows.map((r) => String((r && r._id) || '')).filter(Boolean));
  const aggiungi = (arr) => {
    for (const r of Array.isArray(arr) ? arr : []) {
      const id = String((r && r._id) || '');
      if (!id || visti.has(id)) continue;
      visti.add(id);
      rows.push(r);
    }
  };

  if (typeof FB.listResolved === 'function') {
    try { aggiungi(await FB.listResolved({ pageSize: FB.LIST_PAGE_SIZE, idToken: bearer, fields: FB.CAMPI_LISTA })); }
    catch (e) { console.warn(`AVVISO: chiusi di recente non letti (${e?.message || e})`); }
  }

  // TUTTE le schede fuori pagina, a blocchi: fermarsi al tetto lasciava
  // indietro proprio le più vecchie, che nessun'altra strada guarda.
  const mancanti = (Array.isArray(schede) ? schede : [])
    .map((c) => String((c && c._id) || ''))
    .filter((id) => id && !visti.has(id));
  let schedeCoperte = true;
  if (typeof FB.getMany === 'function') {
    for (let i = 0; i < mancanti.length; i += SCHEDE_PER_VOLTA) {
      const pezzo = mancanti.slice(i, i + SCHEDE_PER_VOLTA);
      try {
        // eslint-disable-next-line no-await-in-loop
        aggiungi(await FB.getMany(pezzo, { idToken: bearer, fields: FB.CAMPI_LISTA }));
      } catch (e) {
        schedeCoperte = false;
        console.warn(`AVVISO: feedback delle schede fuori pagina non letti (${e?.message || e})`);
      }
    }
  } else if (mancanti.length) {
    schedeCoperte = false;
  }
  return { rows, schedeCoperte };
}

export async function publishPublicView({ dryRun = false } = {}) {
  const bearer = await acquireBearer();
  // Decidere una scheda non richiede il documento intero: la stessa
  // proiezione delle liste dell'app (conversazione, livelli e allegati fuori).
  const base = await FB.list({ pageSize: FB.LIST_PAGE_SIZE, idToken: bearer, fields: FB.CAMPI_LISTA });
  // TUTTE le schede già pubblicate, paginate: con una finestra sui 500 più
  // recenti per data d'invio, le schede oltre quel tetto non le poteva togliere
  // più nessuno, e non servivano nemmeno a ripescare i feedback fuori pagina.
  const published = typeof FB.listAllPublic === 'function'
    ? await FB.listAllPublic()
    : await FB.listPublic({ pageSize: FB.LIST_PAGE_SIZE });
  const { rows: grezzi, schedeCoperte } = await conLeSegnalazioniFuoriPagina(base, bearer, published);
  const feedbacks = await decryptFeedbackList(grezzi);

  // Senza chiave privata ogni status è illeggibile: non si pubblicherebbe
  // niente e si toglierebbe tutto. Meglio fermarsi.
  const illeggibili = feedbacks.filter((f) => f && f.status === PLACEHOLDER).length;
  if (illeggibili > 0) {
    throw new Error(
      `chiave privata dei feedback non configurata (${illeggibili} stati illeggibili): `
      + 'imposta FILO_FEEDBACK_PRIVKEY prima di pubblicare la vista.',
    );
  }

  // Due domande diverse, e confonderle costa caro.
  //   · `complete` decide se una scheda rimasta senza feedback è un orfano da
  //     togliere: lo è quando il feedback di ogni scheda l'abbiamo chiesto
  //     davvero. Legarlo al tetto della pagina per data d'invio voleva dire,
  //     passati i cinquecento feedback, non togliere mai più niente.
  //   · `tuttiLetti` decide se il massimo `seq` qui sotto è il massimo VERO:
  //     lo è solo se la pagina non ha toccato il tetto. Su questo si può
  //     ABBASSARE il contatore dei numeri, e abbassarlo su un massimo parziale
  //     rimetterebbe in circolo numeri già assegnati.
  const tuttiLetti = base.length < FB.LIST_PAGE_SIZE;
  const complete = schedeCoperte || tuttiLetti;
  const plan = PV.planSync(published, feedbacks, { complete });

  if (!dryRun) {
    for (const { id, card } of plan.upsert) await FB.publishPublicCard(id, card, { idToken: bearer });
    for (const id of plan.remove) await FB.unpublishPublicCard(id, { idToken: bearer });
  }

  // Il contatore dei numeri: se manca lo crea, se è indietro lo allinea.
  const maxSeq = feedbacks.reduce((m, f) => Math.max(m, Number(f && f.seq) || 0), 0);
  let counter = null;
  // `allowLower` solo se abbiamo letto TUTTI i feedback: un contatore più alto
  // del massimo `seq` esistente l'ha gonfiato qualcuno (farlo avanzare di uno è
  // alla portata di chiunque) e va riportato in pari.
  if (maxSeq > 0 && !dryRun) counter = await FB.ensureSeqCounter(maxSeq, { idToken: bearer, allowLower: tuttiLetti });

  return { letti: feedbacks.length, complete, tuttiLetti, plan, maxSeq, counter, dryRun };
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Uso: node scripts/publish-public-view.mjs [--dry-run]\n'
      + '  rimette in pari la vista pubblica dei feedback (#583); --dry-run mostra solo cosa farebbe');
    process.exit(0);
  }
  const { controllaArgomenti, argomentiDaNpm, opzioneStorpiata } = await import('./lib/argomenti.mjs');
  const storpiata = opzioneStorpiata(process.env, ['--dry-run']);
  if (storpiata) { console.error(`RIFIUTATO: ${storpiata}`); process.exit(1); }
  const daNpm = argomentiDaNpm(process.env, { opzioni: ['--dry-run'] });
  if (daNpm.nota) { console.error(daNpm.nota); process.argv.push(...daNpm.args); }
  const male = controllaArgomenti(process.argv.slice(2), { opzioni: ['--dry-run'], senzaParoleLibere: true });
  if (male) { console.error(`RIFIUTATO: ${male}`); process.exit(1); }

  const dryRun = process.argv.includes('--dry-run');
  try {
    const r = await publishPublicView({ dryRun });
    const prefisso = dryRun ? '[dry-run] ' : '';
    console.log(`Feedback letti: ${r.letti}${r.tuttiLetti ? '' : ` (tetto di ${FB.LIST_PAGE_SIZE} raggiunto: i più vecchi per data d'invio non sono in questa lettura)`}`);
    if (!r.complete) console.log('Schede orfane: non si toccano (non tutte le schede in bacheca hanno potuto essere confrontate).');
    console.log(`${prefisso}Schede da scrivere: ${r.plan.upsert.length}`);
    for (const u of r.plan.upsert) console.log(`  + ${u.id} — #${u.card.seq || '?'} ${u.card.name || '(senza titolo)'}`);
    console.log(`${prefisso}Schede da togliere: ${r.plan.remove.length}`);
    for (const id of r.plan.remove) console.log(`  - ${id}`);
    if (r.counter !== null) console.log(`Contatore dei numeri: ${r.counter}`);
    else if (dryRun) console.log(`Contatore dei numeri: sarebbe allineato a ${r.maxSeq}`);
  } catch (e) {
    console.error(`RIFIUTATO: ${e?.message || e}`);
    process.exit(1);
  }
}
