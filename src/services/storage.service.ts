import fs from 'fs';
import path from 'path';
import { AppConfig, AuditLog, AgendaItem } from '../types/index.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const AGENDA_FILE = path.join(DATA_DIR, 'agenda.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

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
  hourlyRate: 18.0,
  notificationPhone: process.env.WHATSAPP_NOTIFICATION_PHONE || '',
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
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      } else {
        this.saveConfig(DEFAULT_CONFIG);
      }
    } catch (e) {
      console.error('[Storage] Erro ao carregar config.json:', e);
      this.config = DEFAULT_CONFIG;
    }

    try {
      if (fs.existsSync(AGENDA_FILE)) {
        const raw = fs.readFileSync(AGENDA_FILE, 'utf-8');
        this.agenda = JSON.parse(raw);
      } else {
        this.agenda = [
          { id: '1', timeSlot: '07:00 - 10:00', topic: 'Análise de tarefas e desenvolvimento inicial', completed: false },
          { id: '2', timeSlot: '10:00 - 12:00', topic: 'Codificação de novas funcionalidades', completed: false },
          { id: '3', timeSlot: '13:00 - 15:30', topic: 'Refatoração e testes de integração', completed: false },
          { id: '4', timeSlot: '15:30 - 18:00', topic: 'Revisão de código e fechamento do dia', completed: false },
        ];
        this.saveAgenda(this.agenda);
      }
    } catch (e) {
      console.error('[Storage] Erro ao carregar agenda.json:', e);
      this.agenda = [];
    }

    try {
      if (fs.existsSync(LOGS_FILE)) {
        const raw = fs.readFileSync(LOGS_FILE, 'utf-8');
        this.logs = JSON.parse(raw);
        this.pruneOldLogs();
      } else {
        this.logs = [];
        this.saveLogs();
      }
    } catch (e) {
      console.error('[Storage] Erro ao carregar logs.json:', e);
      this.logs = [];
    }
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public saveConfig(newConfig: Partial<AppConfig>): AppConfig {
    this.config = {
      ...this.config,
      ...newConfig,
      trello: { ...this.config.trello, ...(newConfig.trello || {}) },
      schedule: { ...this.config.schedule, ...(newConfig.schedule || {}) },
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    return this.getConfig();
  }

  public getAgenda(): AgendaItem[] {
    return [...this.agenda];
  }

  public saveAgenda(newAgenda: AgendaItem[]): AgendaItem[] {
    this.agenda = newAgenda;
    fs.writeFileSync(AGENDA_FILE, JSON.stringify(this.agenda, null, 2), 'utf-8');
    return this.getAgenda();
  }

  public getLogs(limit = 100): AuditLog[] {
    return this.logs.slice(-limit).reverse();
  }

  public addLog(log: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
    const entry: AuditLog = {
      id: Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      ...log,
    };
    this.logs.push(entry);
    this.pruneOldLogs();
    this.saveLogs();
    return entry;
  }

  /**
   * Mantém estritamente registros de até 30 dias atrás
   */
  private pruneOldLogs() {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const initialCount = this.logs.length;
    this.logs = this.logs.filter((l) => new Date(l.timestamp).getTime() >= thirtyDaysAgo);
    if (this.logs.length !== initialCount) {
      console.log(`[Storage] Limpeza automática de logs: ${initialCount - this.logs.length} logs com mais de 30 dias foram descartados.`);
    }
  }

  private saveLogs() {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(this.logs, null, 2), 'utf-8');
  }
}
