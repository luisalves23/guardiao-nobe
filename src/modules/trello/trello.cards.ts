import { TrelloClient } from './trello.client.js';

export interface TrelloCard {
  id: string;
  name: string;
  idList: string;
  idBoard: string;
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
    return res.data;
  }

  public async moveCard(cardId: string, targetListId: string): Promise<TrelloCard> {
    const client = TrelloClient.getInstance();
    const res = await client.getHttp().put(`/cards/${cardId}`, null, {
      params: {
        ...client.getAuthParams(),
        idList: targetListId,
      },
    });
    return res.data;
  }

  public async addComment(cardId: string, text: string): Promise<any> {
    const client = TrelloClient.getInstance();
    const res = await client.getHttp().post(`/cards/${cardId}/actions/comments`, null, {
      params: {
        ...client.getAuthParams(),
        text,
      },
    });
    return res.data;
  }
}
