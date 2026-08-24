export type ShiftState = 'IDLE' | 'WORKING' | 'LUNCH' | 'PAUSED';

export type LogType =
  | 'SHIFT_STARTED'
  | 'SHIFT_ENDED'
  | 'LUNCH_STARTED'
  | 'LUNCH_ENDED'
  | 'PAUSED'
  | 'RESUMED'
  | 'CARD_CREATED'
  | 'CARD_ROTATED'
  | 'COMMENT_SENT'
  | 'AUTO_RESCUED'
  | 'MANUAL_SYNC'
  | 'WARNING'
  | 'ERROR';

export type CommentSource = 'WHATSAPP' | 'AGENDA' | 'FALLBACK_TEMPLATE' | 'MANUAL' | 'SYSTEM';

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
  timeSlot?: string; // e.g. "08:00 - 10:00"
  topic: string; // e.g. "Refatoração do módulo de autenticação"
  completed?: boolean;
}

export interface AppConfig {
  trello: {
    apiKey: string;
    token: string;
    boardId: string;
    workingListId: string;
    waitListId: string; // "EM ESPERA" list ID
    memberId: string;
    userName: string; // "Luís Alves"
  };
  schedule: {
    workStart: string; // "07:00"
    workEnd: string; // "18:00"
    workDays: number[]; // [1, 2, 3, 4, 5] (Mon-Fri)
    lunchEnabled: boolean;
    lunchStart: string; // "12:00"
    lunchEnd: string; // "13:00"
  };
  hourlyRate: number; // 18.00
  notificationPhone: string; // User WhatsApp number for alerts & questions
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
  todayEarnings: number;
  lastSyncTime: string;
}
