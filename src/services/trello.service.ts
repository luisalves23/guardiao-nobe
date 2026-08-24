import axios, { AxiosInstance } from 'axios';
import { StorageService } from './storage.service.js';

export interface TrelloBoard {
  id: string;
  name: string;
}

export interface TrelloList {
  id: string;
  name: string;
  idBoard: string;
}

export interface TrelloMember {
  id: string;
  fullName: string;
  username: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  idList: string;
  idMembers: string[];
  dateLastActivity: string;
}

export class TrelloService {
  private static instance: TrelloService;
  private http: AxiosInstance;

  private constructor() {
    this.http = axios.create({
      baseURL: 'https://api.trello.com/1',
      timeout: 10000,
    });
  }

  public static getInstance(): TrelloService {
    if (!TrelloService.instance) {
      TrelloService.instance = new TrelloService();
    }
    return TrelloService.instance;
  }

  private getAuthParams() {
    const config = StorageService.getInstance().getConfig();
    return {
      key: config.trello.apiKey,
      token: config.trello.token,
    };
  }

  public async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    try {
      const res = await this.http.get('/members/me', {
        params: this.getAuthParams(),
      });
      return { ok: true, user: res.data.fullName || res.data.username };
    } catch (e: any) {
      return { ok: false, error: e.response?.data?.message || e.message };
    }
  }

  public async getBoards(): Promise<TrelloBoard[]> {
    const res = await this.http.get('/members/me/boards', {
      params: { ...this.getAuthParams(), fields: 'name,id' },
    });
    return res.data;
  }

  public async getLists(boardId: string): Promise<TrelloList[]> {
    const res = await this.http.get(`/boards/${boardId}/lists`, {
      params: { ...this.getAuthParams(), fields: 'name,id,idBoard' },
    });
    return res.data;
  }

  public async getBoardMembers(boardId: string): Promise<TrelloMember[]> {
    const res = await this.http.get(`/boards/${boardId}/members`, {
      params: { ...this.getAuthParams(), fields: 'fullName,username,id' },
    });
    return res.data;
  }

  public async getCardsInList(listId: string): Promise<TrelloCard[]> {
    const res = await this.http.get(`/lists/${listId}/cards`, {
      params: {
        ...this.getAuthParams(),
        fields: 'name,idList,idMembers,dateLastActivity',
      },
    });
    return res.data;
  }

  public async createCard(listId: string, name: string, memberId?: string, desc?: string): Promise<TrelloCard> {
    const params: Record<string, any> = {
      ...this.getAuthParams(),
      idList: listId,
      name,
      desc: desc || 'Card de contagem de horas - Guardião Nobe',
    };
    if (memberId) {
      params.idMembers = memberId;
    }
    const res = await this.http.post('/cards', null, { params });
    return res.data;
  }

  public async moveCard(cardId: string, targetListId: string): Promise<void> {
    await this.http.put(`/cards/${cardId}`, null, {
      params: {
        ...this.getAuthParams(),
        idList: targetListId,
      },
    });
  }

  public async addComment(cardId: string, text: string): Promise<any> {
    const res = await this.http.post(`/cards/${cardId}/actions/comments`, null, {
      params: {
        ...this.getAuthParams(),
        text,
      },
    });
    return res.data;
  }

  public async getCard(cardId: string): Promise<TrelloCard> {
    const res = await this.http.get(`/cards/${cardId}`, {
      params: {
        ...this.getAuthParams(),
        fields: 'name,idList,idMembers,dateLastActivity',
      },
    });
    return res.data;
  }

  public async getCardLastComment(cardId: string): Promise<{ text: string; date: string } | null> {
    try {
      const res = await this.http.get(`/cards/${cardId}/actions`, {
        params: {
          ...this.getAuthParams(),
          filter: 'commentCard',
          limit: 1,
        },
      });
      if (res.data && res.data.length > 0) {
        return {
          text: res.data[0].data?.text || '',
          date: res.data[0].date,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  public async createList(boardId: string, name: string): Promise<TrelloList> {
    const res = await this.http.post('/lists', null, {
      params: {
        ...this.getAuthParams(),
        name,
        idBoard: boardId,
        pos: 'bottom',
      },
    });
    return res.data;
  }

  /**
   * Localiza a coluna do mês ou cria automaticamente uma nova se for o dia 01 / início do mês
   */
  public async findOrCreateMonthlyList(boardId: string, date = new Date()): Promise<TrelloList> {
    const config = StorageService.getInstance().getConfig();
    const monthsPt = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const monthName = monthsPt[date.getMonth()];
    const userName = config.trello.userName || 'Luís Alves';
    
    const expectedName = `${monthName} - ${userName}`;
    const lists = await this.getLists(boardId);

    const normalize = (str: string) =>
      str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const normalizedMonth = normalize(monthName);
    const normalizedUser = normalize(userName);

    const found = lists.find((l) => {
      const normalizedListName = normalize(l.name);
      return normalizedListName.includes(normalizedMonth) && normalizedListName.includes(normalizedUser);
    });

    if (found) {
      return found;
    }

    console.log(`[Trello] Coluna do mês "${expectedName}" não encontrada. Criando nova coluna...`);
    const created = await this.createList(boardId, expectedName);
    return created;
  }
}
