// #2505: la consegna con la prova accanto si legge in Gestione. La classe di rischio sta in fondo alla fila delle forme,
// col suo colore e chi l'ha decisa nell'hover; il clic apre nel pannello tabella dei criteri, elementi nuovi e prova dei
// test nuovi, coi casi verdi anche senza il lavoro segnalati. La busta la apre il main con la chiave dell'owner.
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import '../src/shared/feedbackCrypto.js';
import '../src/shared/consegna.js';

const MANAGE = 'filo://manage/manage.html';
const base = { clientId: 'tester@example.com', createdAt: '2026-11-14T08:00:00Z', images: [], subSeq: 0, text: 'x', status: 'revision_capability', pipeline: { action: 'human_review', verdicts: [] } };
const dettaglio = {
  criteri: globalThis.SN_CONSEGNA.CRITERI.map((k) => (k.n === 5
    ? { criterio: 5, esito: 'non si applica', motivo: 'Nessuna interfaccia toccata dal lavoro.' }
    : { criterio: k.n, esito: 'fatto', prova: k.n === 3 ? 'tests/unit/a.test.mjs, <b>caso</b> «vuoto»' : `tests/unit/caso${k.n}.test.mjs` })),
  elementi: [{ elemento: 'Riquadro Consegna', perche: 'Senza, la classe non si vede.', clic: 'apre il pannello', destro: 'menu della scheda', trascina: 'non serve', hover: 'chi l\'ha decisa' }],
  motivo: 'Cambia solo come si mostra la scheda.',
  zone: [{ chiave: 'dati', nome: 'formato dei dati salvati e migrazioni', percorsi: ['src/shared/storage.js'] }],
  provaTest: { versione: 1, app: { casi: [
    { file: 'tests/unit/a.test.mjs', caso: 'salva il vuoto', senza: 'rosso', con: 'verde' },
    { file: 'tests/unit/a.test.mjs', caso: 'costante', senza: 'verde', con: 'verde' },
  ], verdiSenza: 1, nonVerdiCon: 0 } },
};
const chiaro = { versione: 1, classe: 'irreparabile', dichiarata: 'visibile', minimo: 'irreparabile', decisaDa: 'minimo', zone: ['formato dei dati salvati e migrazioni'], percorsiCompleti: true, casi: 2, verdiSenza: 1, sha: 'a'.repeat(40), at: '2026-11-15T07:00:00Z' };

async function apri(page, fbs) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((x) => window.__mgTest.setData(x), fbs);
}

test('la busta della consegna la apre il main; la classe si vede sulla scheda e il clic apre criteri, elementi e prova', async ({ app, openTab }) => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))).toString('base64url');
  const priv = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))).toString('base64');
  const testo = await globalThis.SN_FEEDBACK_CRYPTO.encryptForOwner(JSON.stringify(dettaglio), pub);
  await app.evaluate((_e, k) => { process.env.FILO_FEEDBACK_PRIVKEY = k; }, priv);

  const page = await openTab(MANAGE);
  await apri(page, []);
  const r = await page.evaluate((fields) => window.filo.message({ type: 'feedback_decrypt_fields', fields }), { consegna: { ...chiaro, testo } });
  expect(r.ok).toBe(true);
  expect(r.fields.consegna.testo).toBeUndefined();
  expect(r.fields.consegna.dettaglio).toEqual(dettaglio);

  await page.evaluate((x) => window.__mgTest.setData(x), [
    { ...base, _id: 'fb-cons', seq: 2505, name: 'Consegna con la prova', consegna: r.fields.consegna },
    { ...base, _id: 'fb-senza', seq: 2506, name: 'Lavoro di prima' },
  ]);
  await page.evaluate(() => window.__mgTest.openDetail('fb-cons'));
  const chip = page.locator('#mgLivelliRow #mgClasse');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('irreparabile');
  await expect(chip).toHaveClass(/mg-classe--irreparabile/);
  await expect(chip).toHaveAttribute('title', 'Classe di rischio: irreparabile, alzata dal minimo (formato dei dati salvati e migrazioni)');
  await chip.click();
  await expect(page.locator('#mgSideTitle')).toHaveText('Consegna');
  const side = page.locator('#mgSideBody');
  await expect(side).toContainText('Dichiarata:visibile');
  await expect(side).toContainText('Decisa da:il minimo dai file toccati');
  await expect(side).toContainText('Cambia solo come si mostra la scheda.');
  await expect(side).toContainText('Test nuovi: 2 casi, 1 verde anche senza il lavoro');
  await expect(side.locator('.mg-consegna-segnalato')).toHaveText(['tests/unit/a.test.mjs › costante: senza il lavoro verde, con verde']);
  await expect(side.locator('li', { hasText: '5. Aspetto, non si applica: Nessuna interfaccia toccata dal lavoro.' })).toHaveCount(1);
  await expect(side.locator('li', { hasText: 'Riquadro Consegna: Senza, la classe non si vede.' })).toHaveCount(1);
  // Il testo di chi lavora resta testo: niente markup dalla tabella.
  await expect(side.locator('li', { hasText: '3. Stress, fatto: tests/unit/a.test.mjs, <b>caso</b> «vuoto»' })).toHaveCount(1);
  await expect(side.locator('b')).toHaveCount(0);
  await expect(chip).toHaveClass(/mg-classe--scelta/);

  mkdirSync('tests/.shots', { recursive: true });
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.screenshot({ path: `tests/.shots/manage-consegna-${tema}.png` });
  }

  // Un altro feedback, senza consegna: la parola sparisce, non resta quella di prima.
  await page.evaluate(() => window.__mgTest.openDetail('fb-senza'));
  await expect(chip).toBeHidden();
});

test('senza la chiave dell\'owner la classe si vede lo stesso, e il pannello dice che il resto è cifrato', async ({ app, openTab }) => {
  await app.evaluate(() => { delete process.env.FILO_FEEDBACK_PRIVKEY; });
  const page = await openTab(MANAGE);
  await apri(page, [{ ...base, _id: 'fb-cifr', seq: 2507, name: 'Consegna cifrata', consegna: { ...chiaro, classe: 'nascosto', minimo: '', decisaDa: 'chi lavora', zone: [], dettaglio: null } }]);
  await page.evaluate(() => window.__mgTest.openDetail('fb-cifr'));
  const chip = page.locator('#mgClasse');
  await expect(chip).toHaveText('nascosto');
  await expect(chip).toHaveAttribute('title', 'Classe di rischio: nascosto, dichiarata da chi ha lavorato');
  await chip.click();
  await expect(page.locator('#mgSideBody')).toContainText('cifrati con la tua chiave');
  await expect(page.locator('#mgSideBody')).toContainText('Minimo dai file:nessuna zona');
});
