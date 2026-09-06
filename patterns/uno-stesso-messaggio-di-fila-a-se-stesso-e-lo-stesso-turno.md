# Uno stesso messaggio, di fila a sé stesso, è lo stesso turno

Un turno di chat che si interrompe riparte per tre strade diverse: la finestra
chiusa mentre l'assistente scriveva e riaperta, il «Riprova» dopo un errore, una
seconda scheda aperta durante l'attesa. Tutte e tre rispediscono lo STESSO
messaggio. Dove il testo viene anche salvato (la conversazione dell'accoglienza)
finiva scritto due volte, e dove viene anche CONTATO (i cinque scambi
dell'intervista) un intoppo di rete costava una delle domande.

`SN_ONBOARDING.appendTurn` scarta il messaggio identico al precedente dello
stesso ruolo. Non è deduplicazione generica. È la definizione giusta di «turno».
Se salvi o conti i turni di una conversazione che può essere ripresa, chiediti
quale ripartenza li fa contare due volte prima di fidarti del contatore.
