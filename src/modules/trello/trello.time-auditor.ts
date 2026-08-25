import { TrelloClient } from './trello.client.js';
import { TrelloListsManager } from './trello.lists.js';
import { TrelloCardsManager } from './trello.cards.js';

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
   * Processa uma lista de actions em memória e calcula os segundos trabalhados
   */
  public calculateCardWorkingSecondsFromActions(
    actionsList: any[],
    workingListId: string,
    options?: { since?: number; until?: number }
  ): number {
    const now = Date.now();
    const since = options?.since || 0;
    const until = options?.until || now;
    const actions = [...actionsList];

    let currentListId: string | null = null;
    let isClosed = false;
    let lastWorkingEnteredTime: number | null = null;
    let accumulatedSeconds = 0;

    for (const a of actions) {
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

      if (wasWorking && !isWorking) {
        if (lastWorkingEnteredTime !== null) {
          const startWindow = Math.max(lastWorkingEnteredTime, since);
          const endWindow = Math.min(t, until);
          if (endWindow > startWindow) {
            accumulatedSeconds += (endWindow - startWindow) / 1000;
          }
          lastWorkingEnteredTime = null;
        }
      } else if (!wasWorking && isWorking) {
        lastWorkingEnteredTime = t;
      }
    }

    if (currentListId === workingListId && !isClosed && lastWorkingEnteredTime !== null) {
      const startWindow = Math.max(lastWorkingEnteredTime, since);
      const endWindow = Math.min(now, until);
      if (endWindow > startWindow) {
        accumulatedSeconds += (endWindow - startWindow) / 1000;
      }
    }

    return Math.floor(accumulatedSeconds);
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
   * Calcula o tempo trabalhado HOJE consolidando cards da lista do mês + lista de trabalho
   */
  public async calculateDailyWorkingTimeFromCards(
    boardId: string,
    workingListId: string,
    hourlyRate = 18.0,
    userName = 'Luis Alves'
  ): Promise<DayWorkSummary> {
    const listsManager = TrelloListsManager.getInstance();
    const cardsManager = TrelloCardsManager.getInstance();
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const today = `${day}/${month}/${year}`;
    const normalizedUser = userName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    try {
      const monthlyList = await listsManager.findOrCreateMonthlyList(boardId, userName);
      const [monthlyCards, workingCards] = await Promise.all([
        cardsManager.getCardsInList(monthlyList.id).catch(() => []),
        cardsManager.getCardsInList(workingListId).catch(() => []),
      ]);

      const allRelevantCards = [...monthlyCards, ...workingCards];
      let totalSeconds = 0;
      const cardsList: CardWorkSummary[] = [];
      const seenCardIds = new Set<string>();

      for (const card of allRelevantCards) {
        if (!card.name || seenCardIds.has(card.id)) continue;
        seenCardIds.add(card.id);

        const normalizedCardName = card.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isUserCard = normalizedCardName.includes(normalizedUser) || normalizedCardName.includes('trabalho do dia');
        const isTodayCard = card.name.includes(today);

        if (!isUserCard || !isTodayCard) continue;

        // Audita tempo do card
        const cardSummary = await this.calculateCardWorkingSeconds(card.id, workingListId);
        if (cardSummary.seconds > 0) {
          totalSeconds += cardSummary.seconds;
          cardsList.push(cardSummary);
        }
      }

      if (totalSeconds > 0) {
        const totalEarnings = Math.round((totalSeconds / 3600) * hourlyRate * 100) / 100;
        return {
          totalSeconds,
          formattedTime: TrelloTimeAuditor.formatSecondsToHMS(totalSeconds),
          totalEarnings,
          cards: cardsList,
        };
      }
    } catch (err: any) {
      console.warn('[TrelloTimeAuditor] Erro na consulta de cards do mês:', err.message);
    }

    // Fallback para calculateTodayBoardWorkingSeconds
    return await this.calculateTodayBoardWorkingSeconds(boardId, workingListId, hourlyRate, userName);
  }

  /**
   * Calcula o tempo trabalhado HOJE em todo o quadro no Trello
   * Replay preciso de todas as movimentações ocorridas a partir do início real do expediente de hoje.
   */
  public async calculateTodayBoardWorkingSeconds(
    boardId: string,
    workingListId: string,
    hourlyRate = 18.0,
    userName = 'Luis Alves'
  ): Promise<DayWorkSummary> {
    const now = Date.now();
    if (this.cachedDaySummary && now - this.cachedDaySummary.timestamp < this.CACHE_TTL_MS) {
      return this.cachedDaySummary.data;
    }

    const client = TrelloClient.getInstance();
    const nowDate = new Date();
    const startOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 0, 0, 0, 0).getTime();
    const endOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 23, 59, 59, 999).getTime();

    // Formatações aceitas para nome de card do usuário: "Luis Alves" ou "Luís Alves"
    const normalizedUser = userName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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
          createdAt: number;
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

        const cardName = a.data?.card?.name || '';
        const t = new Date(a.date).getTime();

        if (!cardsMap.has(cardId)) {
          cardsMap.set(cardId, {
            id: cardId,
            name: cardName || 'Sem título',
            createdAt: t,
            currentListId: null,
            isClosed: false,
            lastWorkingEnteredTime: null,
            accumulatedSecondsToday: 0,
            intervals: [],
          });
        }

        const card = cardsMap.get(cardId)!;
        if (cardName) card.name = cardName;

        const wasWorking = card.currentListId === workingListId && !card.isClosed;

        if (a.type === 'createCard') {
          card.currentListId = a.data.list?.id || null;
          card.isClosed = false;
          card.createdAt = t;
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
            // O início nunca pode ser antes da criação do próprio card ou de 00:00 de hoje
            const effectiveStart = Math.max(card.lastWorkingEnteredTime, card.createdAt, startOfDay);
            const endWindow = Math.min(t, endOfDay);
            if (endWindow > effectiveStart) {
              const diffSec = (endWindow - effectiveStart) / 1000;
              card.accumulatedSecondsToday += diffSec;
              card.intervals.push({
                start: new Date(effectiveStart).toISOString(),
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
        // Filtra apenas cards pertencentes ao usuário (ex: Luis Alves)
        const normalizedCardName = card.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isUserCard = normalizedCardName.includes(normalizedUser) || normalizedCardName.includes('trabalho do dia');

        if (!isUserCard) {
          continue;
        }

        if (card.currentListId === workingListId && !card.isClosed && card.lastWorkingEnteredTime !== null) {
          const effectiveStart = Math.max(card.lastWorkingEnteredTime, card.createdAt, startOfDay);
          const endWindow = Math.min(now, endOfDay);
          if (endWindow > effectiveStart) {
            const diffSec = (endWindow - effectiveStart) / 1000;
            card.accumulatedSecondsToday += diffSec;
            card.intervals.push({
              start: new Date(effectiveStart).toISOString(),
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
