// #2217 giro 1: il segno «lavoro server» deve portare il lavoro a qualcuno. r1: il feedback fermo per il timbro (ora
// col segno) approvato col tasto principale dei Ricevuti finisce In coda non fidato, dove nessuna routine lo prende.
// r2: `--server=true` passa i controlli dello strumento del manutentore e il segno sparisce senza dirlo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const radice = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(join(radice, 'src', 'shared', 'feedbackStatus.js'));
require(join(radice, 'src', 'shared', 'domande.js'));
require(join(radice, 'src', 'shared', 'manageReview.js'));
const MR = globalThis.SN_MANAGE_REVIEW;

// Quello che fa Gestione al clic (manage.js): lo stato nuovo, e col segno d'azione `locale` anche fiducia e segno.
function applica(fb, a) {
  const dopo = { ...fb, status: a.to, statusReason: '' };
  if (a.locale) Object.assign(dopo, { fiducia: 'fidato', localOnly: { by: 'owner', at: 2 } });
  return dopo;
}
// Le routine prendono un lavoro server solo fidato (select.lavoroServerPerChiave sul server).
const loPrendeQualcuno = (fb) => !MR.isLocalOnly(fb) || MR.isFidato(fb);

test('r1 nei Ricevuti, ogni tasto che rimette In coda chi aspettava il timbro lo lascia a qualcuno che lo lavora', () => {
  // Come lo lascia il server dopo «tocca il server» su un feedback non fidato (design, motivo fidato, segno della routine).
  const fermo = { status: 'design', statusReason: 'fidato', fiducia: 'non_fidato', localOnly: { by: 'routine', at: 1 } };
  expect(MR.manageTabFor(fermo, {})).toBe('inbox');
  const inCoda = MR.ownerActions(fermo, {}).filter((a) => a.to === 'todo');
  expect(inCoda.length).toBeGreaterThan(0);
  for (const a of inCoda) expect(loPrendeQualcuno(applica(fermo, a)), `tasto «${a.label}»`).toBe(true);
});

test('r2 manutentore: --server=true mette il segno, o lo strumento lo rifiuta', async () => {
  const { controlliLocali, vuoleServer } = await import('../../../scripts/manutentore.mjs');
  for (const argv of [['feedback', 'Titolo', '-', '--server=true'], ['pacchetto', '900', '901', '--lavoro-server=si']]) {
    const rifiuto = controlliLocali(argv[0], argv);
    expect(rifiuto !== '' || vuoleServer(argv), argv.join(' ')).toBe(true);
  }
});
