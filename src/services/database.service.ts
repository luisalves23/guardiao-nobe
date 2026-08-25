import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'guardiao.db');

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

export class DatabaseService {
  private static instance: DatabaseService;
  private db: DatabaseSync;

  private constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    this.db = new DatabaseSync(DB_FILE);
    this.initDatabase();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private initDatabase(): void {
    // Configurações de performance e integridade do SQLite
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Tabela: work_sessions (Sessões reais de expediente)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT,
        card_name TEXT,
        date_str TEXT NOT NULL,
        state TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration_seconds REAL NOT NULL DEFAULT 0,
        end_reason TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON work_sessions(date_str);
      CREATE INDEX IF NOT EXISTS idx_sessions_active ON work_sessions(is_active);
    `);

    // Tabela: activities (Histórico completo auditável de todas as ações)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT,
        is_error INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activities_ts ON activities(timestamp);
      CREATE INDEX IF NOT EXISTS idx_activities_cat ON activities(category);
      CREATE INDEX IF NOT EXISTS idx_activities_err ON activities(is_error);
    `);

    // Tabela: errors_log (Rastreamento aprofundado de falhas e causas)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS errors_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        module TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT NOT NULL,
        stack_trace TEXT,
        context_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_errors_ts ON errors_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_errors_module ON errors_log(module);
    `);

    // Tabela: daily_metrics (Sumários diários calculados)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_metrics (
        date_str TEXT PRIMARY KEY,
        total_seconds REAL NOT NULL DEFAULT 0,
        total_earnings REAL NOT NULL DEFAULT 0,
        sessions_count INTEGER NOT NULL DEFAULT 0,
        comments_count INTEGER NOT NULL DEFAULT 0,
        last_updated TEXT NOT NULL
      );
    `);
  }

  // ----------------------------------------------------
  // GESTÃO DE SESSÕES DE TRABALHO
  // ----------------------------------------------------
  public startWorkSession(cardId: string | null, cardName: string | null, state = 'WORKING'): WorkSession {
    const now = Date.now();
    const dateStr = this.getTodayDateStr();

    // Fecha qualquer sessão ativa pendente antes de abrir uma nova
    this.endActiveWorkSession('TRANSITION_NEW_SESSION');

    const stmt = this.db.prepare(`
      INSERT INTO work_sessions (
        card_id, card_name, date_str, state, start_time, end_time,
        duration_seconds, end_reason, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, 1, ?)
    `);

    const createdAt = new Date(now).toISOString();
    const result = stmt.run(cardId, cardName, dateStr, state, now, createdAt);
    const sessionId = Number(result.lastInsertRowid);

    this.logActivity(
      'CONTROL',
      'SESSION_START',
      `Sessão iniciada: ${state}`,
      JSON.stringify({ sessionId, cardId, cardName, state, startTime: createdAt })
    );

    return {
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
  }

  public endActiveWorkSession(reason = 'USER_ACTION'): WorkSession | null {
    const active = this.getActiveWorkSession();
    if (!active) return null;

    const now = Date.now();
    const durationSec = Math.max(0, (now - active.start_time) / 1000);

    const stmt = this.db.prepare(`
      UPDATE work_sessions
      SET end_time = ?, duration_seconds = ?, end_reason = ?, is_active = 0
      WHERE id = ?
    `);

    stmt.run(now, durationSec, reason, active.id);

    this.logActivity(
      'CONTROL',
      'SESSION_END',
      `Sessão finalizada (${active.state}) - ${Math.floor(durationSec)}s`,
      JSON.stringify({ sessionId: active.id, reason, durationSeconds: durationSec })
    );

    return {
      ...active,
      end_time: now,
      duration_seconds: durationSec,
      end_reason: reason,
      is_active: 0,
    };
  }

  public getActiveWorkSession(): WorkSession | null {
    const stmt = this.db.prepare(`
      SELECT * FROM work_sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1
    `);
    const row = stmt.get() as any;
    return row || null;
  }

  public getTodayWorkSessions(dateStr?: string): WorkSession[] {
    const date = dateStr || this.getTodayDateStr();
    const stmt = this.db.prepare(`
      SELECT * FROM work_sessions WHERE date_str = ? ORDER BY id ASC
    `);
    return stmt.all(date) as any[];
  }

  /**
   * Retorna os segundos trabalhados hoje somando apenas as sessões de estado WORKING
   */
  public getTodayWorkedSeconds(dateStr?: string): number {
    const date = dateStr || this.getTodayDateStr();
    const now = Date.now();

    const stmt = this.db.prepare(`
      SELECT * FROM work_sessions WHERE date_str = ? AND state = 'WORKING' ORDER BY id ASC
    `);
    const sessions = stmt.all(date) as any[];

    let totalSeconds = 0;
    for (const sess of sessions) {
      if (sess.is_active === 1 || sess.end_time === null) {
        // Sessão ainda aberta
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

    const stmt = this.db.prepare(`
      INSERT INTO activities (timestamp, category, action, title, details, is_error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(now, category, action, title, details || null, isError ? 1 : 0, createdAt);

    return {
      id: Number(result.lastInsertRowid),
      timestamp: now,
      category,
      action,
      title,
      details: details || null,
      is_error: isError ? 1 : 0,
      created_at: createdAt,
    };
  }

  public getRecentActivities(limit = 100, category?: string, errorsOnly = false): ActivityRecord[] {
    let query = 'SELECT * FROM activities WHERE 1=1';
    const params: any[] = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    if (errorsOnly) {
      query += ' AND is_error = 1';
    }

    query += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as any[];
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

    const stmt = this.db.prepare(`
      INSERT INTO errors_log (timestamp, module, error_code, error_message, stack_trace, context_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(now, module, errorCode || null, errorMessage, stackTrace || null, contextJson, createdAt);

    // Registra também na tabela de atividades
    this.logActivity('ERROR', 'ERROR_OCCURRED', `[${module}] ${errorMessage}`, contextJson, true);

    return {
      id: Number(result.lastInsertRowid),
      timestamp: now,
      module,
      error_code: errorCode || null,
      error_message: errorMessage,
      stack_trace: stackTrace || null,
      context_json: contextJson,
      created_at: createdAt,
    };
  }

  public getRecentErrors(limit = 50): ErrorLogRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM errors_log ORDER BY id DESC LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  public clearErrors(): void {
    this.db.prepare(`DELETE FROM errors_log`).run();
  }

  public clearActivities(): void {
    this.db.prepare(`DELETE FROM activities`).run();
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
