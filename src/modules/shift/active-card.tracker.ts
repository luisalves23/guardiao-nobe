import { StorageService } from '../../services/storage.service.js';
import { TrelloTimeAuditor, TrelloCardsManager } from '../trello/index.js';
import { formatTodayDate } from '../scheduler/index.js';

export interface ActiveCardState {
  cardId: string | null;
  cardName: string | null;
  cardDate: string | null;
  cardCreatedAt: number | null;
  workingSeconds: number;
  workingMinutes: number;
  lastCommentTimestamp: number | null;
  remainingRotationMinutes: number;
  isRotationDue: boolean;
}

export class ActiveCardTracker {
  private static instance: ActiveCardTracker;
  private cardId: string | null = null;
  private cardName: string | null = null;
  private cardDate: string | null = null;
  private cardCreatedAt: number | null = null;
  private workingSeconds = 0;
  private lastCommentTimestamp: number | null = null;

  // Rastreamento de card em pausa
  private pausedCardId: string | null = null;
  private pausedCardName: string | null = null;
  private pausedCardCreatedAt: number | null = null;
  private pausedWorkingSeconds = 0;

  private constructor() {
    this.restore();
  }

  public static getInstance(): ActiveCardTracker {
    if (!ActiveCardTracker.instance) {
      ActiveCardTracker.instance = new ActiveCardTracker();
    }
    return ActiveCardTracker.instance;
  }

  public restore() {
    const saved = StorageService.getInstance().getShiftState();
    const today = formatTodayDate(new Date());
    if (saved && saved.cardId && saved.cardDate === today) {
      this.cardId = saved.cardId;
      this.cardName = saved.cardName;
      this.cardDate = saved.cardDate;
      this.cardCreatedAt = saved.cardCreatedAt || Date.now();
      this.workingSeconds = (saved.accumulatedMinutes || 0) * 60;
    }
  }

  public setActiveCard(cardId: string, cardName: string, createdAt: number = Date.now()) {
    this.cardId = cardId;
    this.cardName = cardName;
    this.cardDate = formatTodayDate(new Date());
    this.cardCreatedAt = createdAt;
    this.workingSeconds = 0;
    this.lastCommentTimestamp = null;
    this.clearPausedCard();
  }

  public setPausedCard(cardId: string, cardName: string, createdAt: number, workingSeconds: number) {
    this.pausedCardId = cardId;
    this.pausedCardName = cardName;
    this.pausedCardCreatedAt = createdAt;
    this.pausedWorkingSeconds = workingSeconds;
    this.cardId = null;
    this.cardName = null;
  }

  public canRescuePausedCard(limitMinutes: number = 230): boolean {
    if (!this.pausedCardId) return false;
    const minutes = this.pausedWorkingSeconds / 60;
    return minutes < limitMinutes;
  }

  public restorePausedCard(): { cardId: string; cardName: string; createdAt: number; workingSeconds: number } | null {
    if (!this.pausedCardId || !this.pausedCardName) return null;
    this.cardId = this.pausedCardId;
    this.cardName = this.pausedCardName;
    this.cardDate = formatTodayDate(new Date());
    this.cardCreatedAt = this.pausedCardCreatedAt || Date.now();
    this.workingSeconds = this.pausedWorkingSeconds;
    
    const restored = {
      cardId: this.cardId,
      cardName: this.cardName,
      createdAt: this.cardCreatedAt,
      workingSeconds: this.workingSeconds,
    };
    this.clearPausedCard();
    return restored;
  }

  public clearPausedCard() {
    this.pausedCardId = null;
    this.pausedCardName = null;
    this.pausedCardCreatedAt = null;
    this.pausedWorkingSeconds = 0;
  }

  public getPausedCardId(): string | null {
    return this.pausedCardId;
  }

  public clearCard() {
    this.cardId = null;
    this.cardName = null;
    this.cardDate = null;
    this.cardCreatedAt = null;
    this.workingSeconds = 0;
    this.lastCommentTimestamp = null;
    this.clearPausedCard();
  }

  public recordComment(timestamp: number = Date.now()) {
    this.lastCommentTimestamp = timestamp;
  }

  public async syncWithTrello(): Promise<ActiveCardState> {
    const storage = StorageService.getInstance();
    const config = storage.getConfig();

    if (this.cardId && config.trello.workingListId) {
      try {
        const auditor = TrelloTimeAuditor.getInstance();
        const cardSummary = await auditor.calculateCardWorkingSeconds(
          this.cardId,
          config.trello.workingListId
        );
        this.workingSeconds = cardSummary.seconds;

        if (!this.lastCommentTimestamp) {
          const lastComment = await TrelloCardsManager.getInstance().getLastComment(this.cardId);
          if (lastComment) {
            this.lastCommentTimestamp = new Date(lastComment.date).getTime();
          }
        }
      } catch (err: any) {
        console.warn('[ActiveCardTracker] Erro ao sincronizar card com Trello:', err.message);
      }
    }

    return this.getState();
  }

  public updateTime(elapsedSeconds: number) {
    if (this.cardId) {
      this.workingSeconds += elapsedSeconds;
    }
  }

  public getState(): ActiveCardState {
    const config = StorageService.getInstance().getConfig();
    const rotationLimit = config.rotationLimitMinutes || 230;
    const workingMinutes = this.workingSeconds / 60;
    const remainingRotationMinutes = Math.max(0, rotationLimit - workingMinutes);

    return {
      cardId: this.cardId,
      cardName: this.cardName,
      cardDate: this.cardDate,
      cardCreatedAt: this.cardCreatedAt,
      workingSeconds: Math.floor(this.workingSeconds),
      workingMinutes: Math.round(workingMinutes * 10) / 10,
      lastCommentTimestamp: this.lastCommentTimestamp,
      remainingRotationMinutes: Math.round(remainingRotationMinutes * 10) / 10,
      isRotationDue: workingMinutes >= rotationLimit,
    };
  }

  public getCardId() { return this.cardId; }
  public getCardName() { return this.cardName; }
  public getWorkingSeconds() { return this.workingSeconds; }
  public getWorkingMinutes() { return this.workingSeconds / 60; }
  public getLastCommentTimestamp() { return this.lastCommentTimestamp; }
}
