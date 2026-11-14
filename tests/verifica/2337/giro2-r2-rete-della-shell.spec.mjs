// #2337 giro 2: il rapporto di fine sessione conta la rete della shell solo per nome del programma; un percorso intero
// o un interprete che scarica restano fra gli strumenti puliti, e il controllo del server sul web non li vede.
import { test, expect } from '@playwright/test';
import { chiamaLaRete } from '../../../scripts/session-report.mjs';

test('r2 la shell che scarica una pagina conta come rete anche con il percorso intero o un interprete', () => {
  const comandi = [
    '/usr/bin/curl -s https://esempio.com/doc',
    'node -e "fetch(\'https://esempio.com/doc\').then((r) => r.text()).then(console.log)"',
    'python3 -c "import urllib.request as u; print(u.urlopen(\'https://esempio.com/doc\').read())"',
  ];
  expect(comandi.filter((c) => !chiamaLaRete(c))).toEqual([]);
});
