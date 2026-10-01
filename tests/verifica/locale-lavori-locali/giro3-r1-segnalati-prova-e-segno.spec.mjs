// Verifica locale «lavori locali», giro 3, rilievo 1: un feedback che il lettore della sessione rifiuta come segnalato
// (filtro o giudici) non deve prendere la prova del mittente dal ripasso né il segno locale, e «È mio» lo dice su ogni strada.
// Logica pura più Gestione con dati finti: nessuna rete, nessuna scrittura.
import { test, expect } from '../../fixtures/electron.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

async function moduli() {
  await imp('src/shared/feedbackStatus.js');
  await imp('src/shared/feedbackThread.js');
  await imp('src/shared/manageReview.js');
  const R = await imp('scripts/ripasso-mittenti.mjs');
  const L = await imp('scripts/leggi-feedback.mjs');
  return { R, L, MR: globalThis.SN_MANAGE_REVIEW };
}

const NATO = '2026-10-01T15:00:00Z';
// Senza prova, col prefisso di una sessione, giudicato come un utente: un giudice ha detto attacco.
const SENZA_PROVA_SEGNALATI = [
  { id: 'allineato', clientId: 'local:claude', status: 'aligned', createTime: NATO, seq: 9101, pipeline: { verdicts: [{ judge: 'A', class: 'aligned' }, { judge: 'B', class: 'aligned' }, { judge: 'C', class: 'attack' }] } },
  { id: 'design', clientId: 'owner:x', status: 'design', createTime: NATO, seq: 9102, pipeline: { verdicts: [{ judge: 'A', class: 'design' }, { judge: 'B', class: 'attack' }] } },
];
// Con la prova, fermi nei Ricevuti col giudizio d'attacco del filtro o dei giudici.
const PROVATI_SEGNALATI = [
  { _id: 'l1', clientId: 'local:claude', senderProof: 'admin', status: 'unlabeled', pipeline: { stage: 'L1', action: 'block_attack', l1Category: 'dangerous' } },
  { _id: 'completo', clientId: 'local:claude', senderProof: 'admin', status: 'unlabeled', pipeline: { verdicts: [{ judge: 'A', class: 'attack' }, { judge: 'B', class: 'attack' }], expectedJudges: ['A', 'B'] } },
  { _id: 'parziale', clientId: 'owner:x', senderProof: 'admin', status: 'unlabeled', pipeline: { verdicts: [{ judge: 'A', class: 'attack' }], expectedJudges: ['A', 'B', 'C'] } },
];

test('il ripasso non dà la prova a un feedback che il lettore rifiuta come segnalato', async () => {
  const { R, L } = await moduli();
  for (const d of SENZA_PROVA_SEGNALATI) expect(L.vietatoLeggere(d.status, d.pipeline), d.id).not.toBe('');
  const soglie = { local: Date.parse('2026-10-02T00:00:00Z'), owner: Date.parse('2026-10-02T00:00:00Z') };
  const esito = R.candidatiAlRipasso(SENZA_PROVA_SEGNALATI, soglie, { inizioProva: { local: Infinity, owner: Infinity } });
  expect(esito.promossi.map((d) => d.id), R.resoconto(esito).join(' | ')).toEqual([]);
});

test('il segno «solo in locale» non si mette su un feedback che il lettore rifiuta come segnalato', async () => {
  const { MR } = await moduli();
  for (const fb of PROVATI_SEGNALATI) {
    expect(MR.segnalatoComeAttacco(fb), fb._id).not.toBe('');
    expect(MR.localSignCheck(fb, true).ok, fb._id).toBe(false);
  }
});

test('in Gestione «È mio» dal tasto destro avverte del giudizio d’attacco come il tasto del dettaglio', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  const falso = { _id: 'f-att', seq: 9104, subSeq: 0, name: 'Finta sessione', text: 'x', clientId: 'local:claude', createdAt: NATO, status: 'unlabeled', pipeline: { verdicts: [{ judge: 'A', class: 'attack' }, { judge: 'B', class: 'attack' }], expectedJudges: ['A', 'B'] } };
  await page.evaluate((fb) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([fb]); window.__mgTest.setTab('inbox'); }, falso);
  await page.locator('.mg-item[data-id="f-att"]').click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'È mio' });
  await expect(voce).toHaveCount(1);
  expect(await voce.getAttribute('title')).toMatch(/attacco/);
});
