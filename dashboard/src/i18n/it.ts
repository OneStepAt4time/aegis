/**
 * i18n/it.ts — Italian message catalog for Aegis Dashboard.
 * Mirrors the exact key structure of en.ts.
 */



export const it = {
  nav: {
    overview: 'Panoramica',
    sessions: 'Sessioni',
    pipelines: 'Pipeline',
    activity: 'Attività',
    cost: 'Costi',
    audit: 'Audit',
    authKeys: 'Chiavi API',
    users: 'Utenti',
    settings: 'Impostazioni',
    logout: 'Esci',
  },

  overview: {
    title: 'Panoramica',
    subtitle: 'Stato del sistema e controllo sessioni.',
    newSession: 'Nuova Sessione',
    recentSessions: 'Sessioni Recenti',
  },

  sessions: {
    title: 'Sessioni',
    subtitle: 'Monitora gli agenti attivi e consulta lo storico.',
    tabActive: 'Attive',
    tabAll: 'Tutte',
    empty: 'Nessuna sessione trovata',
    createFirst: 'Crea la tua prima sessione per iniziare',
  },

  pipelines: {
    title: 'Pipeline',
    subtitle: 'Flussi di orchestrazione multi-stage',
    createNew: 'Nuova Pipeline',
    empty: 'Nessuna pipeline trovata',
    createFirst: 'Crea la tua prima pipeline per automatizzare flussi multi-step',
  },

  activity: {
    title: 'Attività',
    subtitle: 'Flusso eventi di sistema',
    empty: 'Nessuna attività',
  },

  cost: {
    title: 'Costi e Fatturazione',
    subtitle: 'Traccia l\'utilizzo API e la spesa',
    todaySpent: 'Oggi',
    monthSpent: 'Questo mese',
    dailyTrend: 'Trend giornaliero',
    byModel: 'Per modello',
    lastDays: 'Ultimi {count} giorni',
  },

  audit: {
    title: 'Log di Audit',
    subtitle: 'Eventi di sicurezza e conformità',
    empty: 'Nessun evento di audit',
  },

  authKeys: {
    title: 'Chiavi API',
    subtitle: 'Gestisci le credenziali di autenticazione',
    createNew: 'Nuova Chiave API',
    empty: 'Nessuna chiave API trovata',
    createFirst: 'Crea la tua prima chiave API per autenticare le richieste',
  },

  users: {
    title: 'Utenti',
    subtitle: 'Gestione membri del team',
    empty: 'Nessun utente trovato',
  },

  settings: {
    title: 'Impostazioni',
    subtitle: 'Preferenze dashboard',

    display: {
      title: 'Visualizzazione',
      theme: 'Tema',
      themeDescription: 'Passa tra modalità scura e chiara',
      themeDark: '🌙 Scuro',
      themeLight: '☀️ Chiaro',
      lightVariant: 'Variante chiara',
      lightVariantDescription: 'Scegli un sottotema per la modalità chiara',
      variantDefault: 'Predefinito',
      variantDefaultDescription: 'Bianco ardesia freddo',
      variantPaper: 'Carta',
      variantPaperDescription: 'Tono seppia caldo',
      variantAaa: 'AAA',
      variantAaaDescription: 'Contrasto massimo (7:1+)',
      autoTheme: 'Tema automatico',
      autoThemeDescription: 'Segui prefers-color-scheme di sistema',
      defaultPageSize: 'Dimensione pagina predefinita',
      defaultPageSizeDescription: 'Righe per pagina nello storico sessioni',
      readingFont: 'Font di lettura',
      readingFontDescription: 'Scegli un font per la leggibilità',
      fontDefault: 'Predefinito',
      fontDefaultDescription: 'DM Sans',
      fontHyperlegible: 'Iperleggibile',
      fontHyperlegibleDescription: 'Atkinson Hyperlegible',
      fontDyslexia: 'Dislessia',
      fontDyslexiaDescription: 'OpenDyslexic',
      locale: 'Lingua e Regione',
      localeDescription: 'Imposta lingua e formati regionali',
    },

    autoRefresh: {
      title: 'Aggiornamento Automatico',
      enable: 'Abilita aggiornamento automatico',
      enableDescription: 'Aggiorna automaticamente i dati della dashboard',
      interval: 'Intervallo di aggiornamento',
      intervalDescription: 'Frequenza del polling per gli aggiornamenti',
      intervalSeconds: '{count} secondi',
      intervalMinute: '1 minuto',
      intervalMinutes: '{count} minuti',
    },

    budget: {
      title: 'Budget e Avvisi di Costo',
      enableAlerts: 'Abilita avvisi di budget',
      enableAlertsDescription: 'Avviso all\'80% del limite',
      dailyCap: 'Limite di spesa giornaliero',
      dailyCapDescription: 'Massimo USD al giorno',
      monthlyCap: 'Limite di spesa mensile',
      monthlyCapDescription: 'Massimo USD al mese',
      hardStop: 'Blocco al 100%',
      hardStopDescription: 'Blocca nuove sessioni al raggiungimento del limite',
    },
  },

  login: {
    title: 'Accedi',
    subtitle: 'Inserisci le tue credenziali per accedere alla dashboard',
    usernameLabel: 'Nome utente',
    usernamePlaceholder: 'Inserisci il tuo nome utente',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Inserisci la tua password',
    signInButton: 'Accedi',
    signingIn: 'Accesso in corso...',
    error: 'Nome utente o password non validi',
  },

  modal: {
    cancel: 'Annulla',
    create: 'Crea',
    save: 'Salva',
    delete: 'Elimina',
    confirm: 'Conferma',
    close: 'Chiudi',
  },

  common: {
    loading: 'Caricamento...',
    error: 'Errore',
    success: 'Successo',
    noData: 'Nessun dato disponibile',
    retry: 'Riprova',
    refresh: 'Aggiorna',
    search: 'Cerca',
    filter: 'Filtra',
    sort: 'Ordina',
    actions: 'Azioni',
    status: 'Stato',
    name: 'Nome',
    createdAt: 'Creato',
    updatedAt: 'Aggiornato',
    lastActive: 'Ultimo accesso',
  },

  status: {
    idle: 'Inattivo',
    working: 'In esecuzione',
    waiting: 'In attesa',
    completed: 'Completato',
    failed: 'Fallito',
    cancelled: 'Annullato',
    running: 'In corso',
    stopped: 'Fermato',
  },

  errors: {
    notFound: 'Pagina non trovata',
    notFoundDescription: 'La pagina che cerchi non esiste',
    serverError: 'Errore del server',
    serverErrorDescription: 'Si è verificato un errore imprevisto',
    networkError: 'Errore di rete',
    networkErrorDescription: 'Impossibile connettersi al server',
    goHome: 'Torna alla home',
  },
};
