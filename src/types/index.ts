export type ShiftState = 'IDLE' | 'WORKING' | 'LUNCH' | 'PAUSED';

export type LogType =
  | 'SHIFT_STARTED'
  | 'SHIFT_ENDED'
  | 'LUNCH_STARTED'
  | 'LUNCH_ENDED'
  | 'PAUSED'
  | 'RESUMED'
  | 'CARD_CREATED'
  | 'CARD_MOVED'
  | 'CARD_UNARCHIVED'
  | 'CARD_ROTATED'
  | 'CARD_ADOPTED'
  | 'COMMENT_SENT'
  | 'QUESTION_ASKED'
  | 'QUESTION_ANSWERED'
  | 'QUESTION_TIMEOUT'
  | 'AUTO_RESCUED'
  | 'MIDNIGHT_ROTATION'
  | 'MANUAL_SYNC'
  | 'COMMAND_RECEIVED'
  | 'JITTER_CALCULATED'
  | 'WARNING'
  | 'ERROR';

export type CommentSource = 'WHATSAPP' | 'TELEGRAM' | 'AGENDA' | 'FALLBACK_TEMPLATE' | 'MANUAL' | 'SYSTEM' | 'USER_WEB';

export interface AuditLog {
  id: string;
  timestamp: string; // ISO 8601
  type: LogType;
  message: string;
  details?: Record<string, any>;
  source?: CommentSource;
}

export interface AgendaItem {
  id: string;
  timeSlot?: string;
  topic: string;
  completed?: boolean;
}

export interface DaySchedule {
  enabled: boolean;
  start: string;       // "09:00"
  end: string;         // "18:00"
  lunchStart?: string; // "12:00"
  lunchEnd?: string;   // "13:00"
}

export interface WeeklyScheduleConfig {
  autoStartEnabled: boolean;
  autoEndEnabled: boolean;
  days: {
    seg: DaySchedule;
    ter: DaySchedule;
    qua: DaySchedule;
    qui: DaySchedule;
    sex: DaySchedule;
    sab: DaySchedule;
    dom: DaySchedule;
  };
}

export interface CommentIntervalConfig {
  minMinutes: number; // ex: 20
  maxMinutes: number; // ex: 25
  testMode?: boolean;
}

export interface ActionMessageConfig {
  text: string;
  enabled: boolean;
}

export interface AppConfig {
  trello: {
    apiKey: string;
    token: string;
    boardId: string;
    workingListId: string;
    waitListId: string;
    memberId: string;
    userName: string;
  };
  schedule: {
    workStart: string;
    workEnd: string;
    workDays: number[];
    lunchEnabled: boolean;
    lunchStart: string;
    lunchEnd: string;
  };
  weeklySchedule?: WeeklyScheduleConfig;
  commentInterval?: CommentIntervalConfig;
  hourlyRate: number;
  notificationPhone: string;
  rotationLimitMinutes?: number; // Padrão: 230 (~3h50m)
  telegram?: {
    botToken?: string;
    chatId?: string;
    enabled?: boolean;
  };
  actionMessages: {
    start: ActionMessageConfig;
    pause: ActionMessageConfig;
    resume: ActionMessageConfig;
    lunch: ActionMessageConfig;
    end: ActionMessageConfig;
    rotate: ActionMessageConfig;
  };
  fallbackTemplates: string[];
}

export interface LiveStatus {
  state: ShiftState;
  activeCardId: string | null;
  activeCardName: string | null;
  cardStartTime: string | null;
  lastCommentTime: string | null;
  nextCommentTargetTime: string | null;
  nextRotationTargetTime: string | null;
  isWhatsAppConnected: boolean;
  isTrelloConnected: boolean;
  todayMinutesWorked: number;
  todaySecondsWorked: number;
  todayFormattedTime: string;
  todayEarnings: number;
  lastSyncTime: string;
}
