// Sonda del verificatore #527 — chi possiede le scorciatoie Cmd su Mac.
//
// Su macOS la barra dei menu e' dell'APPLICAZIONE (sta in cima allo schermo,
// non nella finestra): esiste anche quando la finestra e' senza cornice. Se
// l'app non ne dichiara una, Electron ne installa una di suo, e i tasti di
// quella barra vincono sull'app. Qui guardo se quella barra c'e' e cosa
// dichiara.
import { test, expect } from './fixtures/electron.mjs';

test('che menu ha l\'applicazione, e quali tasti si prende', async ({ app, shell }) => {
  const menu = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    if (!m) return null;
    const dump = (items) => items.map((it) => ({
      label: it.label,
      role: it.role,
      accel: it.accelerator,
      registra: it.registerAccelerator,
      sub: it.submenu ? dump(it.submenu.items) : null,
    }));
    return dump(m.items);
  });
  console.log('MENU APPLICAZIONE:', JSON.stringify(menu, null, 1));
  expect(menu === null, 'nessun menu applicazione dichiarato').toBe(true);
});
