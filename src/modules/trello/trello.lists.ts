import { TrelloClient } from './trello.client.js';

export interface TrelloList {
  id: string;
  name: string;
  idBoard: string;
  closed: boolean;
}

export class TrelloListsManager {
  private static instance: TrelloListsManager;

  private constructor() {}

  public static getInstance(): TrelloListsManager {
    if (!TrelloListsManager.instance) {
      TrelloListsManager.instance = new TrelloListsManager();
    }
    return TrelloListsManager.instance;
  }

  public async getBoardLists(boardId: string): Promise<TrelloList[]> {
    const client = TrelloClient.getInstance();
    const res = await client.getHttp().get(`/boards/${boardId}/lists`, {
      params: client.getAuthParams(),
    });
    return res.data;
  }

  public async createList(boardId: string, name: string): Promise<TrelloList> {
    const client = TrelloClient.getInstance();
    const res = await client.getHttp().post('/lists', null, {
      params: {
        ...client.getAuthParams(),
        name,
        idBoard: boardId,
        pos: 'bottom',
      },
    });
    return res.data;
  }

  public async findOrCreateMonthlyList(boardId: string, userName = 'Luis Alves'): Promise<TrelloList> {
    const monthsPt = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const now = new Date();
    const currentMonthName = monthsPt[now.getMonth()];
    const currentYear = now.getFullYear();

    const lists = await this.getBoardLists(boardId);
    
    // Procura por variações como "Agosto de 2026 - Luis Alves", "Agosto 2026", "Agosto - Luis Alves"
    const found = lists.find((l) => {
      const name = l.name.toLowerCase();
      const mName = currentMonthName.toLowerCase();
      return name.includes(mName) && (name.includes(String(currentYear)) || name.includes(userName.toLowerCase()));
    });

    if (found) {
      return found;
    }

    // Cria caso não exista
    const targetName = `${currentMonthName} de ${currentYear} - ${userName}`;
    return await this.createList(boardId, targetName);
  }
}
