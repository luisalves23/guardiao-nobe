import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'guardiao_db.json');

export interface WorkSession {
  id: number;
  card_id: string | null;
  card_name: string | null;
  date_str: string;
  state: string;
  start_time: number;
  end_time: number | null;
  duration_seconds: number;
  end_reason: string | null;
  is_active: number;
  created_at: string;
}

export interface ActivityRecord {
  id: number;
  timestamp: number;
  category: 'CONTROL' | 'TRELLO' | 'TELEGRAM' | 'SCHEDULER' | 'SYSTEM' | 'ERROR';
  action: string;
  title: string;
  details: string | null;
  is_error: number;
  created_at: string;
}

export interface ErrorLogRecord {
  id: number;
  timestamp: number;
  module: string;
  error_code: string | null;
  error_message: string;
  stack_trace: string | null;
  context_json: string | null;
  created_at: string;
}

interface DatabaseSchema {
  nextSessionId: number;
  nextActivityId: number;
  nextErrorId: number;
  work_sessions: WorkSession[];
  activities: ActivityRecord[];
  errors_log: ErrorLogRecord[];
}

export class DatabaseService {
  private static instance: DatabaseService;
  private data: DatabaseSchema;

  private constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    this.data = this.loadDatabase();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private loadDatabase(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          nextSessionId: parsed.nextSessionId || 1,
          nextActivityId: parsed.nextActivityId || 1,
          nextErrorId: parsed.nextErrorId || 1,
          work_sessions: parsed.work_sessions || [],
          activities: parsed.activities || [],
          errors_log: parsed.errors_log || [],
        };
      }
    } catch (err: any) {
      console.warn('[DatabaseService] Arquivo de dados corrompido ou ausente. Reinicializando:', err.message);
    }

    const defaultData: DatabaseSchema = {
      nextSessionId: 1,
      nextActivityId: 1,
      nextErrorId: 1,
      work_sessions: [],
      activities: [],
      errors_log: [],
    };
    this.saveDatabase(defaultData);
    return defaultData;
  }

  private saveDatabase(dataToSave?: DatabaseSchema): void {
    try {
      const data = dataToSave || this.data;
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[DatabaseService] Erro ao salvar banco de dados em disco:', err.message);
    }
  }

  // ----------------------------------------------------
  // GESTÃO DE SESSÕES DE TRABALHO
  // ----------------------------------------------------
  public startWorkSession(cardId: string | null, cardName: string | null, state = 'WORKING'): WorkSession {
    const now = Date.now();
    const dateStr = this.getTodayDateStr();

    // Fecha qualquer sessão ativa pendente antes de abrir uma nova
    this.endActiveWorkSession('TRANSITION_NEW_SESSION');

    const sessionId = this.data.nextSessionId++;
    const createdAt = new Date(now).toISOString();

    const session: WorkSession = {
      id: sessionId,
      card_id: cardId,
      card_name: cardName,
      date_str: dateStr,
      state,
      start_time: now,
      end_time: null,
      duration_seconds: 0,
      end_reason: null,
      is_active: 1,
      created_at: createdAt,
    };

    this.data.work_sessions.push(session);
    this.saveDatabase();

    this.logActivity(
      'CONTROL',
      'SESSION_START',
      `Sessão iniciada: ${state}`,
      JSON.stringify({ sessionId, cardId, cardName, state, startTime: createdAt })
    );

    return session;
  }

  public endActiveWorkSession(reason = 'USER_ACTION'): WorkSession | null {
    const activeIndex = this.data.work_sessions.findIndex((s) => s.is_active === 1);
    if (activeIndex === -1) return null;

    const active = this.data.work_sessions[activeIndex];
    const now = Date.now();
    const durationSec = Math.max(0, (now - active.start_time) / 1000);

    const updatedSession: WorkSession = {
      ...active,
      end_time: now,
      duration_seconds: durationSec,
      end_reason: reason,
      is_active: 0,
    };

    this.data.work_sessions[activeIndex] = updatedSession;
    this.saveDatabase();

    this.logActivity(
      'CONTROL',
      'SESSION_END',
      `Sessão finalizada (${active.state}) - ${Math.floor(durationSec)}s`,
      JSON.stringify({ sessionId: active.id, reason, durationSeconds: durationSec })
    );

    return updatedSession;
  }

  public getActiveWorkSession(): WorkSession | null {
    const active = this.data.work_sessions.slice().reverse().find((s) => s.is_active === 1);
    return active || null;
  }

  public getTodayWorkSessions(dateStr?: string): WorkSession[] {
    const date = dateStr || this.getTodayDateStr();
    return this.data.work_sessions.filter((s) => s.date_str === date);
  }

  /**
   * Retorna os segundos trabalhados hoje somando apenas as sessões de estado WORKING
   */
  public getTodayWorkedSeconds(dateStr?: string): number {
    const date = dateStr || this.getTodayDateStr();
    const now = Date.now();
    const sessions = this.data.work_sessions.filter((s) => s.date_str === date && s.state === 'WORKING');

    let totalSeconds = 0;
    for (const sess of sessions) {
      if (sess.is_active === 1 || sess.end_time === null) {
        const currentDuration = Math.max(0, (now - sess.start_time) / 1000);
        totalSeconds += currentDuration;
      } else {
        totalSeconds += sess.duration_seconds || 0;
      }
    }

    return Math.floor(totalSeconds);
  }

  // ----------------------------------------------------
  // GESTÃO DE ATIVIDADES E AUDITORIA
  // ----------------------------------------------------
  public logActivity(
    category: 'CONTROL' | 'TRELLO' | 'TELEGRAM' | 'SCHEDULER' | 'SYSTEM' | 'ERROR',
    action: string,
    title: string,
    details?: string | null,
    isError = false
  ): ActivityRecord {
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const activityId = this.data.nextActivityId++;

    const record: ActivityRecord = {
      id: activityId,
      timestamp: now,
      category,
      action,
      title,
      details: details || null,
      is_error: isError ? 1 : 0,
      created_at: createdAt,
    };

    this.data.activities.push(record);
    // Limita atividades a no máximo 5000 registros para economizar memória e I/O
    if (this.data.activities.length > 5000) {
      this.data.activities = this.data.activities.slice(-5000);
    }
    this.saveDatabase();

    return record;
  }

  public getRecentActivities(limit = 100, category?: string, errorsOnly = false): ActivityRecord[] {
    let list = this.data.activities.slice().reverse();

    if (category) {
      list = list.filter((a) => a.category === category);
    }
    if (errorsOnly) {
      list = list.filter((a) => a.is_error === 1);
    }

    return list.slice(0, limit);
  }

  // ----------------------------------------------------
  // GESTÃO E DIAGNÓSTICO DE ERROS
  // ----------------------------------------------------
  public logError(
    module: string,
    errorMessage: string,
    stackTrace?: string | null,
    context?: any,
    errorCode?: string | null
  ): ErrorLogRecord {
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const contextJson = context ? (typeof context === 'string' ? context : JSON.stringify(context)) : null;
    const errorId = this.data.nextErrorId++;

    const errorRecord: ErrorLogRecord = {
      id: errorId,
      timestamp: now,
      module,
      error_code: errorCode || null,
      error_message: errorMessage,
      stack_trace: stackTrace || null,
      context_json: contextJson,
      created_at: createdAt,
    };

    this.data.errors_log.push(errorRecord);
    if (this.data.errors_log.length > 1000) {
      this.data.errors_log = this.data.errors_log.slice(-1000);
    }
    this.saveDatabase();

    // Registra também na lista de atividades
    this.logActivity('ERROR', 'ERROR_OCCURRED', `[${module}] ${errorMessage}`, contextJson, true);

    return errorRecord;
  }

  public getRecentErrors(limit = 50): ErrorLogRecord[] {
    return this.data.errors_log.slice().reverse().slice(0, limit);
  }

  public clearErrors(): void {
    this.data.errors_log = [];
    this.saveDatabase();
  }

  public clearActivities(): void {
    this.data.activities = [];
    this.saveDatabase();
  }

  // ----------------------------------------------------
  // HELPERS
  // ----------------------------------------------------
  private getTodayDateStr(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
