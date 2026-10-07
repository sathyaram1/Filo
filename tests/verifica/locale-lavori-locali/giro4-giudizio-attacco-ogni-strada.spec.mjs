// Verifica locale «lavori locali», giro 4: la porta del giro 3 riprovata. Il giudizio d'attacco che ferma il lettore
// ferma anche chi dà fiducia: segno locale (strumento e Gestione), prova del mittente («È mio» e --riconosci), ripasso.
// Rete finta: nessuna lettura né scrittura su Firestore vero.
import { test, expect } from './../../fixtures/electron.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

// Le forme del giudizio d'attacco che Gestione mostra come segnalato.
const GIUDIZI = {
  filtro: { status: 'unlabeled', pipeline: { l1Category: 'dangerous' } },
  collegioCompleto: { status: 'unlabeled', pipeline: { panelSize: 3, verdicts: [{ class: 'attack' }, { class: 'attack' }, { class: 'aligned' }] } },
  collegioAMeta: { status: 'unlabeled', pipeline: { panelSize: 3, verdicts: [{ class: 'attack' }] } },
  allineatoConUnAttacco: { status: 'aligned', pipeline: { panelSize: 3, verdicts: [{ class: 'attack' }, { class: 'aligned' }, { class: 'aligned' }] } },
  design: { status: 'design', pipeline: { action: 'block_attack' } },
};

function docFirestore(id, { clientId, status, senderProof, pipeline }) {
  const fields = { clientId: { stringValue: clientId }, status: { stringValue: status }, statusPublic: { stringValue: 'open' } };
  if (senderProof) fields.senderProof = { stringValue: senderProof };
  if (pipeline) fields.pipeline = { stringValue: JSON.stringify(pipeline) };
  return { name: `projects/x/databases/(default)/documents/feedback/${id}`, fields };
}

async function conRete(docs, fn) {
  const vero = globalThis.fetch;
  const scritture = [];
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') { scritture.push(url); return new Response('{}', { status: 200 }); }
    const id = decodeURIComponent(String(url).split('/feedback/')[1].split('?')[0]);
    const d = docs[id];
    return d ? new Response(JSON.stringify(d), { status: 200 }) : new Response('{}', { status: 404 });
  };
  try { return await fn(scritture); } finally { globalThis.fetch = vero; }
}

test('il segno «solo locale» dallo strumento della sessione si rifiuta su ogni forma del giudizio d’attacco', async () => {
  const of = await imp('scripts/owner-feedback.mjs');
  const docs = {};
  for (const [k, g] of Object.entries(GIUDIZI)) docs[k] = docFirestore(k, { clientId: 'local:claude', senderProof: 'admin', ...g });
  docs.pulito = docFirestore('pulito', { clientId: 'local:claude', senderProof: 'admin', status: 'todo' });
  await conRete(docs, async (scritture) => {
    for (const k of Object.keys(GIUDIZI)) {
      const r = await of.segnaLocale(k, true, { bearer: 'finto' });
      expect(r.ok, `${k}: ${r.motivo}`).toBe(false);
      expect(r.motivo, k).toMatch(/attacco|giudizio/);
    }
    // Controllo: senza giudizio d'attacco il segno passa (a vuoto).
    const ok = await of.segnaLocale('pulito', true, { bearer: 'finto', dryRun: true });
    expect(ok.ok, ok.motivo).toBe(true);
    expect(scritture).toEqual([]);
  });
});

test('la prova del mittente su parola dell’owner (--riconosci) si rifiuta sui segnalati, passa sui puliti', async () => {
  const of = await imp('scripts/owner-feedback.mjs');
  const docs = {};
  for (const [k, g] of Object.entries(GIUDIZI)) docs[k] = docFirestore(k, { clientId: 'local:claude', ...g });
  docs.pulito = docFirestore('pulito', { clientId: 'owner:me', status: 'aligned', pipeline: { panelSize: 3, verdicts: [{ class: 'aligned' }, { class: 'aligned' }, { class: 'aligned' }] } });
  await conRete(docs, async (scritture) => {
    for (const k of Object.keys(GIUDIZI)) {
      const r = await of.riconosciMittente(k, { bearer: 'finto' });
      expect(r.ok, `${k}: ${r.motivo}`).toBe(false);
    }
    const ok = await of.riconosciMittente('pulito', { bearer: 'finto', dryRun: true });
    expect(ok.ok, ok.motivo).toBe(true);
    expect(scritture).toEqual([]);
  });
});

test('il ripasso non dà la prova a un feedback dell’owner o di una sessione fermo nei Ricevuti col giudizio d’attacco', async () => {
  const R = await imp('scripts/ripasso-mittenti.mjs');
  const prima = '2026-09-20T10:00:00Z';
  const docs = Object.entries(GIUDIZI).map(([k, g], i) => ({ id: k, clientId: i % 2 ? 'owner:me' : 'local:claude', createTime: prima, seq: 9100 + i, ...g }));
  docs.push({ id: 'pulito', clientId: 'local:claude', createTime: prima, seq: 9199, status: 'aligned', pipeline: { verdicts: [{ class: 'aligned' }] } });
  const soglia = Date.parse('2026-10-01T11:16:16Z');
  const esito = R.candidatiAlRipasso(docs, { local: soglia, owner: soglia });
  expect(esito.promossi.map((d) => d.id), R.resoconto(esito).join(' | ')).toEqual(['pulito']);
});

test('in Gestione: su un tuo feedback segnalato il tasto «Locale» non mette il segno e il tasto destro non lo offre; «È mio» avverte da tutte e due le strade', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true, by: 'owner@esempio', at: 1 }; }
      return orig(msg);
    };
  });
  const base = { name: 'Una cosa da fare', text: 'testo', statusPublic: 'open', createdAt: '2026-09-30T07:00:00Z', images: [] };
  const provato = { ...base, _id: 'p-1', seq: 9301, clientId: 'local:claude', senderProof: 'admin', ...GIUDIZI.collegioCompleto };
  const senzaProva = { ...base, _id: 'n-1', seq: 9302, clientId: 'owner:me', ...GIUDIZI.allineatoConUnAttacco };
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setTab('inbox'); }, [provato, senzaProva]);

  await page.evaluate((id) => window.__mgTest.openDetail(id), 'p-1');
  const locale = page.locator('#mgLocalBtn');
  if (await locale.isVisible()) {
    await expect(locale).toHaveAttribute('title', /Adesso non si può/);
    await locale.click();
    await expect(page.locator('#mgManageMsg')).toContainText('Segno non messo');
  }
  await page.locator('.mg-item[data-id="p-1"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await expect(page.locator('.mg-ctxmenu')).not.toContainText('locale');
  await page.keyboard.press('Escape');

  await page.evaluate((id) => window.__mgTest.openDetail(id), 'n-1');
  await expect(page.locator('#mgSenderBtn')).toHaveAttribute('title', /Attenzione/);
  await page.locator('.mg-item[data-id="n-1"]').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'È mio' })).toHaveAttribute('title', /Attenzione/);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__updates)).toEqual([]);
});
