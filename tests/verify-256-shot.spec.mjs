// Cattura visiva: la pagina Sicurezza intera in tema scuro e chiaro, per
// confrontare i controlli della nuova sezione con quelli già presenti.

import { test, expect } from './fixtures/electron.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seed(app, entries) {
  await app.evaluate(async (_e, list) => {
    const MSG = globalThis.SN_MSG.MSG;
    for (const entry of list) {
      await globalThis.SN_HANDLE_MESSAGE(
        { type: MSG.PUSH_CLIPBOARD_ENTRY, entry },
        { url: 'https://example.com/page' },
      );
    }
  }, entries.map((e) => (typeof e === 'string' ? { type: 'text', text: e } : e)));
}

for (const tema of ['dark', 'light']) {
  test(`#256 pagina Sicurezza intera, tema ${tema}`, async ({ app, shell, openTab }) => {
    void shell;
    await app.evaluate(async (_e, t) => {
      await globalThis.__filoStorage.set({ settings: { theme: t } });
    }, tema);
    await seed(app, ['password-copiata', 'un testo qualunque copiato prima', { type: 'image', dataUrl: PNG, description: 'una schermata' }]);
    const page = await openTab('filo://security/');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(3, { timeout: 10_000 });
    await page.screenshot({ path: `tests/.shots/256-sicurezza-intera-${tema}.png`, fullPage: true });
  });
}
