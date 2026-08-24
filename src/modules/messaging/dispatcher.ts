import { TelegramAdapter } from './telegram.adapter.js';
import { WhatsAppService } from '../../services/whatsapp.service.js';

export class MessageDispatcher {
  private static instance: MessageDispatcher;

  private constructor() {}

  public static getInstance(): MessageDispatcher {
    if (!MessageDispatcher.instance) {
      MessageDispatcher.instance = new MessageDispatcher();
    }
    return MessageDispatcher.instance;
  }

  public async broadcastAlert(text: string): Promise<void> {
    await WhatsAppService.getInstance().sendAlert(text);
    await TelegramAdapter.getInstance().sendAlert(text);
  }

  public async askActivityQuestion(timeoutMs = 120000, onTimeout?: () => void): Promise<string | null> {
    const telegram = TelegramAdapter.getInstance();
    const whatsapp = WhatsAppService.getInstance();

    if (telegram.isConfigured()) {
      return await telegram.askActivityQuestion(timeoutMs, onTimeout);
    } else {
      return await whatsapp.askActivityQuestion(timeoutMs, onTimeout);
    }
  }
}
