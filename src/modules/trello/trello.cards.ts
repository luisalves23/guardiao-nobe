import { TrelloClient } from './trello.client.js';
import { StorageService } from '../../services/storage.service.js';

export interface TrelloCard {
  id: string;
  name: string;
  idList: string;
  idBoard: string;
  closed?: boolean;
  idMembers?: string[];
  url?: string;
}

export class TrelloCardsManager {
  private static instance: TrelloCardsManager;

  private constructor() {}

  public static getInstance(): TrelloCardsManager {
    if (!TrelloCardsManager.instance) {
      TrelloCardsManager.instance = new TrelloCardsManager();
    }
    return TrelloCardsManager.instance;
  }

  /**
   * Identifica se um card é um "Card de Trabalho" gerenciado pelo Guardião
   * (Cards de melhoria/compartilhados possuem múltiplos membros ou outros termos)
   */
  public isWorkCard(card: TrelloCard, currentUserName?: string, currentMemberId?: string): boolean {
    if (!card) return false;

    // Se o card possui mais de 1 membro atribuído, é um card de equipe/melhoria/projeto
    if (card.idMembers && card.idMembers.length > 1) {
      return false;
    }

    const name = (card.name || '').toLowerCase();

    // Se contiver termos explícitos de melhoria ou bugfix
    if (name.startsWith('melhoria:') || name.startsWith('[melhoria]') || name.includes('bugfix:') || name.includes('sprint:')) {
      return false;
    }

    // Padrão primário: "Trabalho do Dia" ou "Trabalho de Hoje"
    if (name.includes('trabalho do dia') || name.includes('trabalho de hoje')) {
      return true;
    }

    // Se possui exatamente o membro único configurado do usuário
    if (currentMemberId && card.idMembers && card.idMembers.length === 1 && card.idMembers[0] === currentMemberId) {
      return true;
    }

    // Se o título contém o nome do usuário (ex: "Luis Alves")
    if (currentUserName && name.includes(currentUserName.toLowerCase())) {
      return true;
    }

    return false;
  }

  public async getCard(cardId: string): Promise<TrelloCard> {
    const client = TrelloClient.getInstance();
    const res = await client.getHttp().get(`/cards/${cardId}`, {
      params: client.getAuthParams(),
    });
    return res.data;
  }

  public async getCardsInList(listId: string): Promise<TrelloCard[]> {
    const client = TrelloClient.getInstance();
    const res = await client.getHttp().get(`/lists/${listId}/cards`, {
      params: client.getAuthParams(),
    });
    return res.data;
  }

  public async createCard(listId: string, name: string, memberId?: string): Promise<TrelloCard> {
    const client = TrelloClient.getInstance();
    const params: any = {
      ...client.getAuthParams(),
      idList: listId,
      name,
      pos: 'top',
    };
    if (memberId) {
      params.idMembers = memberId;
    }
    const res = await client.getHttp().post('/cards', null, { params });
    const card = res.data;

    StorageService.getInstance().addLog({
      type: 'CARD_CREATED',
      message: `Card "${name}" criado com sucesso no Trello (ID: ${card.id}).`,
      source: 'SYSTEM',
      details: { cardId: card.id, cardName: name, targetListId: listId },
    });

    return card;
  }

  public async moveCard(cardId: string, targetListId: string): Promise<TrelloCard> {
    const client = TrelloClient.getInstance();
    const res = await client.getHttp().put(`/cards/${cardId}`, null, {
      params: {
        ...client.getAuthParams(),
        idList: targetListId,
      },
    });
    const card = res.data;

    StorageService.getInstance().addLog({
      type: 'CARD_MOVED',
      message: `Card "${card.name || cardId}" movido para a lista ${targetListId}.`,
      source: 'SYSTEM',
      details: { cardId, cardName: card.name, targetListId },
    });

    return card;
  }

  public async unarchiveCard(cardId: string, targetListId?: string): Promise<TrelloCard> {
    const client = TrelloClient.getInstance();
    const params: any = {
      ...client.getAuthParams(),
      closed: false,
    };
    if (targetListId) {
      params.idList = targetListId;
    }
    const res = await client.getHttp().put(`/cards/${cardId}`, null, { params });
    const card = res.data;

    StorageService.getInstance().addLog({
      type: 'CARD_UNARCHIVED',
      message: `Card "${card.name || cardId}" desarquivado com sucesso e retornado à lista ${targetListId || 'original'}.`,
      source: 'SYSTEM',
      details: { cardId, cardName: card.name, targetListId },
    });

    return card;
  }

  public async addComment(cardId: string, text: string): Promise<any> {
    const client = TrelloClient.getInstance();
    const res = await client.getHttp().post(`/cards/${cardId}/actions/comments`, null, {
      params: {
        ...client.getAuthParams(),
        text,
      },
    });

    StorageService.getInstance().addLog({
      type: 'COMMENT_SENT',
      message: `Comentário registrado no card (${cardId}): "${text}"`,
      source: 'SYSTEM',
      details: { cardId, commentText: text },
    });

    return res.data;
  }

  public async getLastComment(cardId: string): Promise<{ date: string; text: string } | null> {
    const client = TrelloClient.getInstance();
    try {
      const res = await client.getHttp().get(`/cards/${cardId}/actions`, {
        params: {
          ...client.getAuthParams(),
          filter: 'commentCard',
          limit: 1,
        },
      });
      if (res.data && res.data.length > 0) {
        return {
          date: res.data[0].date,
          text: res.data[0].data?.text || '',
        };
      }
      return null;
    } catch (err: any) {
      console.warn(`[TrelloCardsManager] Falha ao obter último comentário do card ${cardId}:`, err.message);
      return null;
    }
  }
}
