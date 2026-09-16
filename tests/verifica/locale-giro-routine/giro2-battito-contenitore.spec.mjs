// Prove del giro 2 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 4: il battito deve portare la memoria e l'età del CONTENITORE, non
// del processo che batte né della macchina che lo ospita (porta aperta dal
// giro 1, livello 1). Un contenitore vero qui non c'è: si danno alle funzioni
// i file di sistema che troverebbero dentro (cgroup v2, cgroup v1, /proc) e si
// guarda cosa ne ricavano.

import { test, expect } from '@playwright/test';
import { memoriaContenitore, uptimeContenitore, rssProcessi, statoContenitore } from '../../../scripts/routine-channel.mjs';

const MB = 1048576;
const lettore = (mappa) => (p) => (Object.prototype.hasOwnProperty.call(mappa, p) ? mappa[p] : null);
const osFinto = { loadavg: () => [1.234, 0, 0], uptime: () => 100000, freemem: () => 20000 * MB };
const procFinto = { memoryUsage: () => ({ rss: 30 * MB }) };

test.describe('battito — memoria e uptime del contenitore', () => {
  test('cgroup v2 con tetto: usata e libera sono quelle del contenitore, non del kernel', () => {
    const leggi = lettore({
      '/sys/fs/cgroup/memory.current': `${String(1536 * MB)}\n`,
      '/sys/fs/cgroup/memory.max': `${String(2048 * MB)}\n`,
      '/proc/1/stat': `1 (node (x)) S 0 1 1 0 -1 4194560 100 0 0 0 5 5 0 0 20 0 1 0 ${String(100 * (100000 - 3600))} 1000 100 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n`,
    });
    expect(memoriaContenitore(leggi)).toEqual({ usedMb: 1536, limitMb: 2048 });
    const st = statoContenitore({ osImpl: osFinto, proc: procFinto, leggi, elenca: () => [] });
    expect(st.rssMb).toBe(1536);
    expect(st.freeMb).toBe(512);
    expect(st.uptimeS).toBe(3600);
    expect(st.loadAvg).toBe(1.23);
    for (const v of Object.values(st)) expect(typeof v).toBe('number');
  });

  test('cgroup v2 senza tetto («max»): la libera torna quella del sistema, l\'usata resta del contenitore', () => {
    const leggi = lettore({ '/sys/fs/cgroup/memory.current': String(700 * MB), '/sys/fs/cgroup/memory.max': 'max\n' });
    expect(memoriaContenitore(leggi)).toEqual({ usedMb: 700, limitMb: 0 });
    const st = statoContenitore({ osImpl: osFinto, proc: procFinto, leggi, elenca: () => [] });
    expect(st.rssMb).toBe(700);
    expect(st.freeMb).toBe(20000);
  });

  test('cgroup v1: il tetto «infinito» di v1 non è un tetto; uno vero sì', () => {
    const senza = lettore({ '/sys/fs/cgroup/memory/memory.usage_in_bytes': String(300 * MB), '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712' });
    expect(memoriaContenitore(senza)).toEqual({ usedMb: 300, limitMb: 0 });
    const con = lettore({ '/sys/fs/cgroup/memory/memory.usage_in_bytes': String(300 * MB), '/sys/fs/cgroup/memory/memory.limit_in_bytes': String(1024 * MB) });
    expect(memoriaContenitore(con)).toEqual({ usedMb: 300, limitMb: 1024 });
    expect(statoContenitore({ osImpl: osFinto, proc: procFinto, leggi: con, elenca: () => [] }).freeMb).toBe(724);
  });

  test('senza cgroup ma con /proc: la memoria è la somma di TUTTI i processi, non di chi batte', () => {
    const leggi = lettore({
      '/proc/7/statm': '5000 2560 100 1 0 200 0',   // 2560 pagine = 10 MB
      '/proc/42/statm': '90000 25600 100 1 0 200 0', // 25600 pagine = 100 MB
      '/proc/1/stat': `1 (bash) S 0 1 1 0 -1 4194560 100 0 0 0 5 5 0 0 20 0 1 0 ${String(100 * (100000 - 42))} 1000 100 0 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n`,
    });
    const elenca = (p) => (p === '/proc' ? ['1', '7', '42', 'cpuinfo', 'self'] : []);
    expect(rssProcessi(leggi, elenca)).toBe(110);
    expect(uptimeContenitore(100000, leggi)).toBe(42);
    const st = statoContenitore({ osImpl: osFinto, proc: procFinto, leggi, elenca });
    expect(st.rssMb).toBe(110);
    expect(st.uptimeS).toBe(42);
    expect(st.freeMb).toBe(20000);
  });

  test('un /proc/1/stat storto non manda in errore il battito: si ripiega sull\'uptime del sistema', () => {
    const leggi = lettore({ '/proc/1/stat': 'roba illeggibile' });
    expect(uptimeContenitore(100000, leggi)).toBeNull();
    const st = statoContenitore({ osImpl: osFinto, proc: procFinto, leggi, elenca: () => [] });
    expect(st.uptimeS).toBe(100000);
    expect(st.rssMb).toBe(30);
  });

  test('dove /proc e cgroup non ci sono (Windows): uptime del sistema, memoria libera del sistema, rss di questo processo', () => {
    const st = statoContenitore({ osImpl: osFinto, proc: procFinto, leggi: () => null, elenca: () => [] });
    expect(st).toEqual({ uptimeS: 100000, freeMb: 20000, rssMb: 30, loadAvg: 1.23 });
    // E con i lettori veri di questa macchina: quattro numeri finiti.
    const vero = statoContenitore();
    for (const k of ['uptimeS', 'freeMb', 'rssMb', 'loadAvg']) expect(Number.isFinite(vero[k]), k).toBe(true);
  });
});
