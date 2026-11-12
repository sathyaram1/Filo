   Prima del rebase, `node scripts/dispatch.mjs --rimetti-lockfile`, da solo
   nella sua chiamata: l'install può riscrivere `package-lock.json`, e il
   rebase rifiuterebbe la cartella sporca. Il comando lo rimette com'è nel
   commit; exit diverso da 0 → chiudi il giro, come per un rebase che non
   riesce.
