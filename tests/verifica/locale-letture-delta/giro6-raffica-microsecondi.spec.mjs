// Giro 6, prova del verificatore (#676): la Gestione legge tutto all'apertura, poi solo i cambiati.
// Firestore finto nel main al livello della singola pagina della domanda dei cambiati, con le ore in
// MICROSECONDI come quello vero (l'emulatore le tiene al millesimo): la paginazione vera del giro gira sopra.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const TEMPI = { pollMs: 400, rientroMs: 200, clockMs: 100 };

function doc(i, extra = {}) {
  return {
    _id: `d${String(i).padStart(5, '0')}`,
    _updateTime: '2026-09-01T10:00:00.000000Z',
    updatedAt: '2026-09-01T10:00:00.000000Z',
    text: `Testo ${i}`,
    name: `Feedback ${i}`,
    seq: 2000 + i,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
    status: 'done',
    ...extra,
  };
}

async function fingi(app, docs) {
  await app.evaluate(async (_e, { docs, ritmo }) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';
    globalThis.__docs = docs;
    globalThis.__conta = { tutti: 0, pagine: 0, righe: 0 };
    const C = globalThis.__conta;
    const FB = globalThis.SN_FEEDBACK;
    const copia = (d) => JSON.parse(JSON.stringify(d));
    // Ora ISO in microsecondi, qualunque precisione abbia il testo.
    const us = (s) => {
      const m = /\.(\d+)Z$/.exec(String(s));
      const frac = m ? Number((m[1] + '000000').slice(0, 6)) : 0;
      return Date.parse(String(s).replace(/\.\d+Z$/, 'Z')) * 1000 + frac;
    };
    const base = 'projects/x/databases/(default)/documents/feedback/';
    const nome = (d) => FB.nomeDocumento ? FB.nomeDocumento('feedback', d) : base + d._id;
    FB.listAllPaged = async () => {
      C.tutti += 1;
      return { rows: globalThis.__docs.map(copia), complete: true, readTime: new Date().toISOString() };
    };
    // Una pagina come la darebbe Firestore: updatedAt > since, ordine (updatedAt, nome), cursore stretto.
    FB.listChangedDirect = async ({ since, after, pageSize }) => {
      C.pagine += 1;
      const s = us(since);
      let righe = globalThis.__docs.filter((d) => d.updatedAt && us(d.updatedAt) > s);
      righe.sort((a, b) => (us(a.updatedAt) - us(b.updatedAt)) || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
      if (after && after.name) {
        const t = us(after.at);
        const id = String(after.name).split('/').pop();
        righe = righe.filter((d) => us(d.updatedAt) > t || (us(d.updatedAt) === t && d._id > id));
      }
      const out = righe.slice(0, pageSize).map((d) => ({ ...copia(d), _proiezione: true }));
      C.righe += out.length;
      out.readTime = new Date().toISOString();
      return out;
    };
    FB.versionsOf = async (ids) => globalThis.__docs.filter((d) => ids.includes(d._id)).map((d) => ({ _id: d._id, _updateTime: d._updateTime }));
    FB.getMany = async (ids) => globalThis.__docs.filter((d) => ids.includes(d._id)).map(copia);
    FB.submissionCount = async () => 5000;
    FB.idDelNumero = async () => null;
    FB.getManyPublic = async () => [];
    FB.listAllPublic = async () => [];
    FB.listResolved = async () => [];
    globalThis.__filoDefaults.getWorkerLog = async () => [];
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, ritmo: TEMPI.pollMs });
}

// Il server scrive: stessa ora in microsecondi per tutto il blocco, come una scrittura a lotti.
async function scriveIlServer(app, cambi) {
  await app.evaluate((_e, cambi) => {
    const ora = new Date(Date.now() + 1000).toISOString().replace(/Z$/, '');
    for (const [i, c] of cambi.entries()) {
      const stamp = `${ora}${String(c.micro ?? 437).padStart(3, '0')}Z`;
      const d = globalThis.__docs.find((x) => x._id === c.id);
      const nuovo = { ...(d || {}), ...c.campi, _id: c.id, updatedAt: stamp, _updateTime: `${stamp}#${i}` };
      if (d) Object.assign(d, nuovo); else globalThis.__docs.push(nuovo);
    }
  }, cambi);
}

test('Gestione: il 530 vecchio nei Ricevuti, poi una raffica di 1100 scritture con la stessa ora arriva intera', async ({ app, openTab }) => {
  const docs = [];
  for (let i = 0; i < 1300; i += 1) docs.push(doc(i));
  // Il 530: più vecchio di tutti, nei Ricevuti, oltre i primi 500 per data.
  docs.push(doc(9999, { _id: 'il530', seq: 530, name: 'Livelli di autonomia', status: 'design', createdAt: '2026-01-03T10:00:00.000Z' }));
  await fingi(app, docs);

  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((t) => { window.__mgTest.setAdmin(true); window.__mgTest.setLiveTiming(t); }, TEMPI);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));

  const ricevuti = page.locator('.mg-tab[data-tab="inbox"]');
  await expect(ricevuti).toHaveText('Ricevuti (1)', { timeout: 30000 });
  await expect(page.locator('body')).toContainText('Livelli di autonomia');

  // 1100 feedback tornano nei Ricevuti in un colpo, stessa ora al microsecondo; uno nuovo nasce.
  const cambi = [];
  for (let i = 0; i < 1100; i += 1) cambi.push({ id: `d${String(i).padStart(5, '0')}`, campi: { status: 'design' } });
  cambi.push({ id: 'nuovo1', campi: { ...doc(7777), _id: 'nuovo1', name: 'Appena nato', status: 'unlabeled', createdAt: new Date().toISOString() } });
  await scriveIlServer(app, cambi);
  await expect(ricevuti).toHaveText('Ricevuti (1102)', { timeout: 20000 });

  // Il 530 passa in coda: esce dai Ricevuti al giro dopo.
  await scriveIlServer(app, [{ id: 'il530', campi: { status: 'todo' }, micro: 901 }]);
  await expect(ricevuti).toHaveText('Ricevuti (1101)', { timeout: 20000 });

  const c = await app.evaluate(() => globalThis.__conta);
  // Una sola lettura completa: tutto il resto sono domande dei cambiati.
  expect(c.tutti).toBe(1);
  // La raffica letta una volta, non ripetuta a ogni giro.
  expect(c.righe).toBeLessThan(1100 * 3);
});
