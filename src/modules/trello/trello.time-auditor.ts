import { TrelloClient } from './trello.client.js';

export interface CardWorkSummary {
  cardId: string;
  cardName: string;
  seconds: number;
  formatted: string;
  intervals: Array<{ start: string; end: string; seconds: number }>;
}

export interface DayWorkSummary {
  totalSeconds: number;
  formattedTime: string;
  totalEarnings: number;
  cards: CardWorkSummary[];
}

export class TrelloTimeAuditor {
  private static instance: TrelloTimeAuditor;
  private cachedDaySummary: { timestamp: number; data: DayWorkSummary } | null = null;
  private CACHE_TTL_MS = 2000; // Cache de 2 segundos para evitar rate limit em múltiplos clientes

  private constructor() {}

  public static getInstance(): TrelloTimeAuditor {
    if (!TrelloTimeAuditor.instance) {
      TrelloTimeAuditor.instance = new TrelloTimeAuditor();
    }
    return TrelloTimeAuditor.instance;
  }

  /**
   * Converte segundos em formato estrito 00h00min00seg
   */
  public static formatSecondsToHMS(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    return `${String(hours).padStart(2, '0')}h${String(minutes).padStart(2, '0')}min${String(seconds).padStart(2, '0')}seg`;
  }

  /**
   * Calcula milimetricamente o tempo que um card passou na coluna 'Trabalhando Agora'
   * com base nas Actions oficiais da API do Trello.
   */
  public async calculateCardWorkingSeconds(
    cardId: string,
    workingListId: string,
    options?: { since?: number; until?: number }
  ): Promise<CardWorkSummary> {
    const client = TrelloClient.getInstance();
    const now = Date.now();
    const since = options?.since || 0;
    const until = options?.until || now;

    try {
      const res = await client.getHttp().get(`/cards/${cardId}/actions`, {
        params: {
          ...client.getAuthParams(),
          filter: 'createCard,updateCard,copyCard',
          limit: 1000,
        },
      });

      const actions = (res.data || []).reverse(); // Ordem cronológica ascendente (mais antigo primeiro)
      let currentListId: string | null = null;
      let isClosed = false;
      let lastWorkingEnteredTime: number | null = null;
      let accumulatedSeconds = 0;
      let cardName = 'Card';
      const intervals: Array<{ start: string; end: string; seconds: number }> = [];

      for (const a of actions) {
        if (a.data?.card?.name) {
          cardName = a.data.card.name;
        }
        const t = new Date(a.date).getTime();
        const wasWorking = currentListId === workingListId && !isClosed;

        if (a.type === 'createCard') {
          currentListId = a.data?.list?.id || null;
          isClosed = false;
        }
        if (a.data?.listAfter?.id) {
          currentListId = a.data.listAfter.id;
        }
        if (a.data?.card && typeof a.data.card.closed === 'boolean') {
          isClosed = a.data.card.closed;
        }

        const isWorking = currentListId === workingListId && !isClosed;

        // Transição: Saiu da coluna trabalhando ou foi arquivado
        if (wasWorking && !isWorking) {
          if (lastWorkingEnteredTime !== null) {
            const startWindow = Math.max(lastWorkingEnteredTime, since);
            const endWindow = Math.min(t, until);
            if (endWindow > startWindow) {
              const diffSec = (endWindow - startWindow) / 1000;
              accumulatedSeconds += diffSec;
              intervals.push({
                start: new Date(startWindow).toISOString(),
                end: new Date(endWindow).toISOString(),
                seconds: diffSec,
              });
            }
            lastWorkingEnteredTime = null;
          }
        } else if (!wasWorking && isWorking) {
          // Transição: Entrou em Trabalhando Agora ou foi desarquivado em Trabalhando Agora
          lastWorkingEnteredTime = t;
        }
      }

      // Se o card está ATUALMENTE na coluna de trabalho e aberto
      if (currentListId === workingListId && !isClosed && lastWorkingEnteredTime !== null) {
        const startWindow = Math.max(lastWorkingEnteredTime, since);
        const endWindow = Math.min(now, until);
        if (endWindow > startWindow) {
          const diffSec = (endWindow - startWindow) / 1000;
          accumulatedSeconds += diffSec;
          intervals.push({
            start: new Date(startWindow).toISOString(),
            end: 'NOW',
            seconds: diffSec,
          });
        }
      }

      return {
        cardId,
        cardName,
        seconds: accumulatedSeconds,
        formatted: TrelloTimeAuditor.formatSecondsToHMS(accumulatedSeconds),
        intervals,
      };
    } catch (err: any) {
      console.warn(`[TrelloTimeAuditor] Erro ao auditar card ${cardId}:`, err.message);
      return {
        cardId,
        cardName: 'Card',
        seconds: 0,
        formatted: '00h00min00seg',
        intervals: [],
      };
    }
  }

  /**
   * Calcula o tempo trabalhado HOJE em todo o quadro no Trello
   * Replay preciso de todas as movimentações ocorridas a partir de 00:00:00 de hoje.
   */
  public async calculateTodayBoardWorkingSeconds(
    boardId: string,
    workingListId: string,
    hourlyRate = 18.0
  ): Promise<DayWorkSummary> {
    const now = Date.now();
    if (this.cachedDaySummary && now - this.cachedDaySummary.timestamp < this.CACHE_TTL_MS) {
      return this.cachedDaySummary.data;
    }

    const client = TrelloClient.getInstance();
    const nowDate = new Date();
    const startOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 0, 0, 0, 0).getTime();
    const endOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 23, 59, 59, 999).getTime();

    try {
      const res = await client.getHttp().get(`/boards/${boardId}/actions`, {
        params: {
          ...client.getAuthParams(),
          filter: 'createCard,updateCard,copyCard',
          limit: 1000,
        },
      });

      const actions = (res.data || []).reverse(); // Cronológico
      const cardsMap = new Map<
        string,
        {
          id: string;
          name: string;
          currentListId: string | null;
          isClosed: boolean;
          lastWorkingEnteredTime: number | null;
          accumulatedSecondsToday: number;
          intervals: Array<{ start: string; end: string; seconds: number }>;
        }
      >();

      for (const a of actions) {
        const cardId = a.data?.card?.id;
        if (!cardId) continue;

        if (!cardsMap.has(cardId)) {
          cardsMap.set(cardId, {
            id: cardId,
            name: a.data.card.name || 'Sem título',
            currentListId: null,
            isClosed: false,
            lastWorkingEnteredTime: null,
            accumulatedSecondsToday: 0,
            intervals: [],
          });
        }

        const card = cardsMap.get(cardId)!;
        if (a.data.card.name) card.name = a.data.card.name;
        const t = new Date(a.date).getTime();

        const wasWorking = card.currentListId === workingListId && !card.isClosed;

        if (a.type === 'createCard') {
          card.currentListId = a.data.list?.id || null;
          card.isClosed = false;
        }
        if (a.data.listAfter?.id) {
          card.currentListId = a.data.listAfter.id;
        }
        if (a.data.card && typeof a.data.card.closed === 'boolean') {
          card.isClosed = a.data.card.closed;
        }

        const isWorking = card.currentListId === workingListId && !card.isClosed;

        if (wasWorking && !isWorking) {
          if (card.lastWorkingEnteredTime !== null) {
            const startWindow = Math.max(card.lastWorkingEnteredTime, startOfDay);
            const endWindow = Math.min(t, endOfDay);
            if (endWindow > startWindow) {
              const diffSec = (endWindow - startWindow) / 1000;
              card.accumulatedSecondsToday += diffSec;
              card.intervals.push({
                start: new Date(startWindow).toISOString(),
                end: new Date(endWindow).toISOString(),
                seconds: diffSec,
              });
            }
            card.lastWorkingEnteredTime = null;
          }
        } else if (!wasWorking && isWorking) {
          card.lastWorkingEnteredTime = t;
        }
      }

      // Finaliza cards que estão atualmente na coluna
      let totalBoardSeconds = 0;
      const cardsList: CardWorkSummary[] = [];

      for (const card of cardsMap.values()) {
        if (card.currentListId === workingListId && !card.isClosed && card.lastWorkingEnteredTime !== null) {
          const startWindow = Math.max(card.lastWorkingEnteredTime, startOfDay);
          const endWindow = Math.min(now, endOfDay);
          if (endWindow > startWindow) {
            const diffSec = (endWindow - startWindow) / 1000;
            card.accumulatedSecondsToday += diffSec;
            card.intervals.push({
              start: new Date(startWindow).toISOString(),
              end: 'NOW',
              seconds: diffSec,
            });
          }
        }

        if (card.accumulatedSecondsToday > 0) {
          totalBoardSeconds += card.accumulatedSecondsToday;
          cardsList.push({
            cardId: card.id,
            cardName: card.name,
            seconds: card.accumulatedSecondsToday,
            formatted: TrelloTimeAuditor.formatSecondsToHMS(card.accumulatedSecondsToday),
            intervals: card.intervals,
          });
        }
      }

      const totalEarnings = (totalBoardSeconds / 3600) * hourlyRate;
      const result: DayWorkSummary = {
        totalSeconds: totalBoardSeconds,
        formattedTime: TrelloTimeAuditor.formatSecondsToHMS(totalBoardSeconds),
        totalEarnings,
        cards: cardsList,
      };

      this.cachedDaySummary = { timestamp: now, data: result };
      return result;
    } catch (err: any) {
      console.error('[TrelloTimeAuditor] Erro ao calcular tempo do quadro:', err.message);
      return {
        totalSeconds: 0,
        formattedTime: '00h00min00seg',
        totalEarnings: 0,
        cards: [],
      };
    }
  }

  /**
   * Limpa cache para forçar recálculo imediato após ações de controle
   */
  public clearCache() {
    this.cachedDaySummary = null;
  }
}
