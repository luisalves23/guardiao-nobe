import axios, { AxiosInstance } from 'axios';
import { StorageService } from '../../services/storage.service.js';

export class TrelloClient {
  private static instance: TrelloClient;
  private http: AxiosInstance;

  private constructor() {
    this.http = axios.create({
      baseURL: 'https://api.trello.com/1',
      timeout: 10000,
    });
  }

  public static getInstance(): TrelloClient {
    if (!TrelloClient.instance) {
      TrelloClient.instance = new TrelloClient();
    }
    return TrelloClient.instance;
  }

  public getAuthParams() {
    const config = StorageService.getInstance().getConfig();
    return {
      key: config.trello.apiKey,
      token: config.trello.token,
    };
  }

  public getHttp(): AxiosInstance {
    return this.http;
  }
}
