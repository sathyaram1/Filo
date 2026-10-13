// Verifica #974 giro 2: una conversazione dell'Editor di giorni fa, aperta dalla Cronologia nella home, è davanti al
// modello quando l'utente ci chiede qualcosa subito dopo.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

test('r1 riga vecchia aperta dalla Cronologia: la domanda che segue la ha davanti', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const id = await app.evaluate(async () => {
    const T = globalThis.SN_FILO_EVENTI.TIPI;
    const id = globalThis.SN_FILO_EVENTI.uuid();
    const t0 = Date.now() - 10 * 86400000;
    const ts = (k) => new Date(t0 + k * 1000).toISOString();
    await globalThis.SN_IL_FILO.transazione(async (t) => {
      await t.scrivi([
        t.evento(T.CHAT_APERTA, { chat: id, app: 'editor', rif: 'docvecchio:m1', soggetto: 'relazione sui castori', dove: 'filo://editor/editor.html?file=docvecchio' }, { autore: 'utente', ts: ts(0) }),
        t.evento(T.CHAT_TITOLO, { chat: id, title: 'Editor · relazione sui castori', kind: globalThis.SN_CHAT_ARCHIVE.KIND_TALK, soggetto: 'relazione sui castori' }, { autore: 'filo', ts: ts(0) }),
        t.evento(T.MESSAGGIO, { chat: id, msg: { role: 'user', text: 'quanto pesano i castori adulti?' } }, { autore: 'utente', ts: ts(1) }),
        t.evento(T.MESSAGGIO, { chat: id, msg: { role: 'filo', text: 'Fra 16 e 30 chili.', esterno: "dalla chat dell'Editor, sul testo di un documento" } }, { autore: 'filo', ts: ts(2) }),
      ]);
    });
    return id;
  });
  await home(app);
  const archivio = await openTab('filo://archive/archive.html');
  await archivio.locator('.arc-chat[data-app="editor"]').click();
  await expect.poll(() => app.windows().some((w) => w.url().includes(`?chat=${id}`))).toBe(true);
  const casa = app.windows().find((w) => w.url().includes(`?chat=${id}`));
  await casa.waitForLoadState('domcontentloaded');
  await expect(casa.locator('.dash-riga-app .dash-riga-app-msg-filo')).toHaveText('Fra 16 e 30 chili.', { timeout: 10_000 });
  await modelloFinto(app, [{ text: 'Riassunto fatto.' }]);
  await chiedi(casa, 'riassumimi questa conversazione');
  await expect(casa.locator('.dash-bubble-filo', { hasText: 'Riassunto fatto' })).toBeVisible({ timeout: 15_000 });
  const [prima] = await chiamateAlModello(app);
  const testo = prima.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  expect(testo, 'la conversazione a schermo arriva al modello (almeno la riga col suo id)').toContain(id);
});
