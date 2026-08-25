import { TelegramAdapter } from './telegram.adapter.js';
import { WhatsAppService } from '../../services/whatsapp.service.js';

export class MessageDispatcher {
  private static instance: MessageDispatcher;
  private isWaitingAnswer = false;
  private activeQuestionDeadline: number | null = null;
  private activeQuestionResolver: ((answer: string | null) => void) | null = null;
  private onQuestionStatusChanged: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): MessageDispatcher {
    if (!MessageDispatcher.instance) {
      MessageDispatcher.instance = new MessageDispatcher();
    }
    return MessageDispatcher.instance;
  }

  public setOnQuestionStatusChanged(cb: () => void) {
    this.onQuestionStatusChanged = cb;
  }

  public isQuestionPending(): boolean {
    return this.isWaitingAnswer;
  }

  public getQuestionDeadline(): number | null {
    return this.activeQuestionDeadline;
  }

  public async broadcastAlert(text: string): Promise<void> {
    await WhatsAppService.getInstance().sendAlert(text);
    await TelegramAdapter.getInstance().sendAlert(text);
  }

  public async askActivityQuestion(timeoutMs = 120000, onTimeout?: () => void): Promise<string | null> {
    const telegram = TelegramAdapter.getInstance();
    const whatsapp = WhatsAppService.getInstance();

    this.isWaitingAnswer = true;
    this.activeQuestionDeadline = Date.now() + timeoutMs;
    if (this.onQuestionStatusChanged) this.onQuestionStatusChanged();

    return new Promise<string | null>(async (resolve) => {
      let resolved = false;

      const finish = (answer: string | null) => {
        if (resolved) return;
        resolved = true;
        this.isWaitingAnswer = false;
        this.activeQuestionDeadline = null;
        this.activeQuestionResolver = null;
        if (this.onQuestionStatusChanged) this.onQuestionStatusChanged();
        resolve(answer);
      };

      this.activeQuestionResolver = finish;

      let channelPromise: Promise<string | null>;
      if (telegram.hasBotToken()) {
        channelPromise = telegram.askActivityQuestion(timeoutMs, () => {
          if (!resolved) {
            if (onTimeout) onTimeout();
            finish(null);
          }
        });
      } else {
        channelPromise = whatsapp.askActivityQuestion(timeoutMs, () => {
          if (!resolved) {
            if (onTimeout) onTimeout();
            finish(null);
          }
        });
      }

      channelPromise.then((answer) => {
        if (!resolved && answer !== null) {
          finish(answer);
        }
      }).catch((err) => {
        console.error('[MessageDispatcher] Erro no canal de pergunta:', err.message);
      });
    });
  }

  public async submitActivityAnswer(text: string, source: 'WEB' | 'TELEGRAM' | 'WHATSAPP' = 'WEB'): Promise<boolean> {
    const clean = text.trim();
    if (!clean) return false;

    if (this.isWaitingAnswer && this.activeQuestionResolver) {
      const resolver = this.activeQuestionResolver;
      this.isWaitingAnswer = false;
      this.activeQuestionDeadline = null;
      this.activeQuestionResolver = null;

      // Cancela espera nos adaptadores
      TelegramAdapter.getInstance().clearPendingQuestion();
      WhatsAppService.getInstance().clearPendingQuestion();

      if (source === 'WEB') {
        const telegram = TelegramAdapter.getInstance();
        if (telegram.isConfigured()) {
          telegram.sendAlert(`✅ - [RESPOSTA REGISTRADA VIA PAINEL WEB] -\n"${clean}"\n\nComentário postado no Trello e timer reiniciado!`).catch(() => {});
        }
      }

      resolver(clean);
      if (this.onQuestionStatusChanged) this.onQuestionStatusChanged();
      return true;
    }

    return false;
  }
}
