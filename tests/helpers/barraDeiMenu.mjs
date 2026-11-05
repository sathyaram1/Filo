// Aziona una voce della barra dei menu dell'applicazione per etichetta, come fa il tasto su Mac.
import { expect } from '@playwright/test';

export async function voceDellaBarra(app, etichetta) {
  const trovata = await app.evaluate(({ Menu }, label) => {
    const barra = Menu.getApplicationMenu();
    if (!barra) return false;
    const cerca = (voci) => {
      for (const v of voci) {
        if (v.label === label && typeof v.click === 'function') return v;
        if (v.submenu) { const dentro = cerca(v.submenu.items); if (dentro) return dentro; }
      }
      return null;
    };
    const voce = cerca(barra.items);
    if (!voce) return false;
    voce.click();
    return true;
  }, etichetta);
  expect(trovata, `la barra dei menu non ha una voce "${etichetta}"`).toBe(true);
}
