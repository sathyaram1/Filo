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

export async function publishPublicView({ dryRun = false } = {}) {
  const bearer = await acquireBearer();
  const grezzi = await FB.list({ pageSize: FB.LIST_PAGE_SIZE, idToken: bearer });
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

  const published = await FB.listPublic({ pageSize: FB.LIST_PAGE_SIZE });
  const complete = grezzi.length < FB.LIST_PAGE_SIZE;
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
  if (maxSeq > 0 && !dryRun) counter = await FB.ensureSeqCounter(maxSeq, { idToken: bearer, allowLower: complete });

  return { letti: feedbacks.length, complete, plan, maxSeq, counter, dryRun };
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
    console.log(`Feedback letti: ${r.letti}${r.complete ? '' : ' (tetto raggiunto: le schede più vecchie non si toccano)'}`);
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
