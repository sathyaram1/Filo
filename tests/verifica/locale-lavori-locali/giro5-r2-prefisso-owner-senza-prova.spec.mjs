// Verifica locale «lavori locali», giro 5, rilievo 2: il ripasso dà la prova dell'owner a ogni feedback col suo prefisso
// nato senza prova finché non esce una versione di Filo che la scrive, anche dopo la fusione, quando chi crea dal main
// la scrive già: il prefisso lo può scrivere chiunque (#595). Git e documenti finti; non apre Filo, non tocca la rete.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

// Il giorno dopo la fusione: su main le sessioni e l'app scrivono la prova, nessuna versione pubblicata ancora.
const FUSIONE = '2026-10-02T08:00:00+00:00';
const gitDopoLaFusione = (args) => {
  if (args[0] === 'log' && args.includes('senderProof')) return `abcdef1234567890 ${FUSIONE}\n`;
  return '';
};

test('dopo la fusione, un feedback col prefisso dell’owner nato senza prova (come lo scrive un falso) non riceve la prova dal ripasso', async () => {
  const R = await imp('scripts/ripasso-mittenti.mjs');
  const inizioProva = R.inizioDellaProva(gitDopoLaFusione);
  const soglia = Date.parse('2026-10-01T11:16:16.832Z');
  const giudici = { panelSize: 3, verdicts: [{ class: 'aligned' }, { class: 'aligned' }, { class: 'aligned' }] };
  const docs = [
    { id: 'falso-owner', clientId: 'owner:qualunque', status: 'aligned', pipeline: giudici, createTime: '2026-10-03T09:00:00Z', seq: 9501 },
    { id: 'falso-local', clientId: 'local:claude', status: 'aligned', pipeline: giudici, createTime: '2026-10-03T09:05:00Z', seq: 9502 },
  ];
  const esito = R.candidatiAlRipasso(docs, { local: soglia, owner: soglia }, { inizioProva });
  expect(esito.promossi.map((d) => d.id), R.resoconto(esito).join(' | ')).toEqual([]);
});
