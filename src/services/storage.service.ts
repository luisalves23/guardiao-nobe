import fs from 'fs';
import path from 'path';
import { AppConfig, AuditLog, AgendaItem } from '../types/index.js';
import { DatabaseService } from './database.service.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const AGENDA_FILE = path.join(DATA_DIR, 'agenda.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const SHIFT_STATE_FILE = path.join(DATA_DIR, 'shift_state.json');

export interface PersistentShiftState {
  cardId: string | null;
  cardName: string | null;
  cardDate: string | null; // e.g. "24/08/2026"
  cardCreatedAt: number | null;
  accumulatedMinutes: number;
}

const DEFAULT_CONFIG: AppConfig = {
  trello: {
    apiKey: process.env.TRELLO_API_KEY || '',
    token: process.env.TRELLO_TOKEN || '',
    boardId: process.env.TRELLO_BOARD_ID || '',
    workingListId: process.env.TRELLO_WORKING_LIST_ID || '',
    waitListId: process.env.TRELLO_WAIT_LIST_ID || '',
    memberId: process.env.TRELLO_MEMBER_ID || '',
    userName: process.env.TRELLO_USER_NAME || 'Luís Alves',
  },
  schedule: {
    workStart: '07:00',
    workEnd: '18:00',
    workDays: [1, 2, 3, 4, 5],
    lunchEnabled: true,
    lunchStart: '12:00',
    lunchEnd: '13:00',
  },
  weeklySchedule: {
    autoStartEnabled: false,
    autoEndEnabled: false,
    days: {
      seg: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
      ter: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
      qua: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
      qui: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
      sex: { enabled: true, start: '08:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
      sab: { enabled: false, start: '08:00', end: '12:00', lunchStart: '12:00', lunchEnd: '13:00' },
      dom: { enabled: false, start: '08:00', end: '12:00', lunchStart: '12:00', lunchEnd: '13:00' },
    },
  },
  commentInterval: {
    minMinutes: 20,
    maxMinutes: 25,
    testMode: false,
  },
  hourlyRate: 18.0,
  notificationPhone: process.env.WHATSAPP_NOTIFICATION_PHONE || '',
  rotationLimitMinutes: 230,
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    enabled: true,
  },
  actionMessages: {
    start: { text: 'Iniciando as atividades do dia.', enabled: true },
    pause: { text: 'Pausa rápida.', enabled: false },
    resume: { text: 'Retomando as tarefas.', enabled: true },
    lunch: { text: 'Pausa para almoço.', enabled: true },
    end: { text: 'Finalizando o expediente por hoje.', enabled: false },
    rotate: { text: 'Atualizando card para continuidade das tarefas.', enabled: true },
  },
  fallbackTemplates: [
    'Seguindo com o desenvolvimento e testes das rotinas.',
    'Ajustando implementação e revisando lógica dos módulos.',
    'Investigando regras de negócio e refinando validações.',
    'Realizando testes manuais e checagem de fluxo.',
    'Depurando funções e otimizando performance das consultas.',
    'Atualizando documentação e alinhando detalhes técnicos.',
    'Trabalhando na resolução dos pontos pendentes da sprint.',
    'Refatorando componentes e melhorando a cobertura de testes.',
    'Validando comportamento em ambiente de homologação.',
    'Acompanhando build e corrigindo alertas do linter.'
  ],
};

export class StorageService {
  private static instance: StorageService;
  private config: AppConfig = DEFAULT_CONFIG;
  private agenda: AgendaItem[] = [];
  private logs: AuditLog[] = [];
  private shiftState: PersistentShiftState = {
    cardId: null,
    cardName: null,
    cardDate: null,
    cardCreatedAt: null,
    accumulatedMinutes: 0,
  };

  private constructor() {
    this.ensureDataDir();
    this.loadAll();
  }

  public static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadAll() {
    try {
      const db = DatabaseService.getInstance();
      const dbConfig = db.getSystemConfig();
      const dbTemplates = db.getFallbackTemplates();
      const dbAgenda = db.getAgendaItems();

      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.config = {
          ...DEFAULT_CONFIG,
          ...parsed,
          ...(dbConfig || {}),
          trello: { ...DEFAULT_CONFIG.trello, ...(parsed.trello || {}), ...(dbConfig?.trello || {}) },
          actionMessages: { ...DEFAULT_CONFIG.actionMessages, ...(parsed.actionMessages || {}), ...(dbConfig?.actionMessages || {}) },
          fallbackTemplates: dbTemplates || parsed.fallbackTemplates || DEFAULT_CONFIG.fallbackTemplates,
        };
      } else if (dbConfig) {
        this.config = {
          ...DEFAULT_CONFIG,
          ...dbConfig,
          fallbackTemplates: dbTemplates || dbConfig.fallbackTemplates || DEFAULT_CONFIG.fallbackTemplates,
        };
        this.saveConfig(this.config);
      } else {
        this.saveConfig(DEFAULT_CONFIG);
      }

      if (fs.existsSync(AGENDA_FILE)) {
        const raw = fs.readFileSync(AGENDA_FILE, 'utf-8');
        this.agenda = JSON.parse(raw);
      } else if (dbAgenda) {
        this.agenda = dbAgenda;
      }

      if (fs.existsSync(LOGS_FILE)) {
        const raw = fs.readFileSync(LOGS_FILE, 'utf-8');
        this.logs = JSON.parse(raw);
        this.pruneOldLogs();
      }

      if (fs.existsSync(SHIFT_STATE_FILE)) {
        const raw = fs.readFileSync(SHIFT_STATE_FILE, 'utf-8');
        this.shiftState = JSON.parse(raw);
      }
    } catch (err: any) {
      console.error('[StorageService] Erro ao carregar dados:', err.message);
    }
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public saveConfig(newConfig: Partial<AppConfig>): AppConfig {
    this.config = {
      ...this.config,
      ...newConfig,
      trello: { ...this.config.trello, ...(newConfig.trello || {}) },
      actionMessages: { ...this.config.actionMessages, ...(newConfig.actionMessages || {}) },
      fallbackTemplates: newConfig.fallbackTemplates || this.config.fallbackTemplates,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    
    // Persiste também no DatabaseService
    DatabaseService.getInstance().saveSystemConfig(this.config);
    if (this.config.fallbackTemplates) {
      DatabaseService.getInstance().saveFallbackTemplates(this.config.fallbackTemplates);
    }

    return this.config;
  }

  public getAgenda(): AgendaItem[] {
    return this.agenda;
  }

  public saveAgenda(newAgenda: AgendaItem[]): AgendaItem[] {
    this.agenda = newAgenda;
    fs.writeFileSync(AGENDA_FILE, JSON.stringify(this.agenda, null, 2), 'utf-8');
    DatabaseService.getInstance().saveAgendaItems(this.agenda);
    return this.agenda;
  }

  public getShiftState(): PersistentShiftState {
    return this.shiftState;
  }

  public saveShiftState(state: Partial<PersistentShiftState>): PersistentShiftState {
    this.shiftState = { ...this.shiftState, ...state };
    fs.writeFileSync(SHIFT_STATE_FILE, JSON.stringify(this.shiftState, null, 2), 'utf-8');
    return this.shiftState;
  }

  public addLog(entry: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
    const log: AuditLog = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.logs.unshift(log);
    this.pruneOldLogs();
    this.persistLogs();

    let cat: 'CONTROL' | 'TRELLO' | 'TELEGRAM' | 'SCHEDULER' | 'SYSTEM' | 'ERROR' = 'SYSTEM';
    const srcStr = String(entry.source || '');
    if (srcStr === 'TELEGRAM') cat = 'TELEGRAM';
    else if (entry.type.includes('CARD') || entry.type.includes('COMMENT') || srcStr === 'TRELLO') cat = 'TRELLO';
    else if (entry.type === 'ERROR') cat = 'ERROR';
    else if (entry.type.includes('SHIFT') || entry.type.includes('PAUSE') || entry.type.includes('LUNCH') || entry.type.includes('RESUMED')) cat = 'CONTROL';

    DatabaseService.getInstance().logActivity(
      cat,
      entry.type,
      entry.message,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.type === 'ERROR'
    );

    return log;
  }

  public getLogs(limit = 100): AuditLog[] {
    return this.logs.slice(0, limit);
  }

  public getAllLogs(): AuditLog[] {
    return this.logs;
  }

  public clearLogs(): void {
    this.logs = [];
    this.persistLogs();
    DatabaseService.getInstance().clearAllLogs();
  }

  private pruneOldLogs() {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.logs = this.logs.filter((l) => new Date(l.timestamp).getTime() >= thirtyDaysAgo);
  }

  private persistLogs() {
    try {
      fs.writeFileSync(LOGS_FILE, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[StorageService] Falha ao salvar logs:', err.message);
    }
  }
}
