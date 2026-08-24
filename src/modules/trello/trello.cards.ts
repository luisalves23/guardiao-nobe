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
}
