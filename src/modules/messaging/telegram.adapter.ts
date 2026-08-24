import axios from 'axios';
import { StorageService } from '../../services/storage.service.js';

export class TelegramAdapter {
  private static instance: TelegramAdapter;
  private isPolling = false;
  private lastUpdateId = 0;
  private pendingQuestionResolve: ((answer: string) => void) | null = null;
  private pendingQuestionTimer: NodeJS.Timeout | null = null;
  private commandHandler: ((command: string, args: string[]) => Promise<string | void>) | null = null;

  private constructor() {}

  public static getInstance(): TelegramAdapter {
    if (!TelegramAdapter.instance) {
      TelegramAdapter.instance = new TelegramAdapter();
    }
    return TelegramAdapter.instance;
  }

  public setCommandHandler(handler: (command: string, args: string[]) => Promise<string | void>) {
    this.commandHandler = handler;
  }

  private getBotToken(): string {
    const config = StorageService.getInstance().getConfig();
    return process.env.TELEGRAM_BOT_TOKEN || (config as any).telegram?.botToken || '';
  }

  private getChatId(): string {
    const config = StorageService.getInstance().getConfig();
    return process.env.TELEGRAM_CHAT_ID || (config as any).telegram?.chatId || '';
  }

  public isConfigured(): boolean {
    return !!this.getBotToken();
  }

  public async initialize(): Promise<void> {
    const token = this.getBotToken();
    if (!token) return;

    try {
      const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 8000 });
      if (res.data?.ok) {
        console.log(`[Telegram] Bot conectado com sucesso: @${res.data.result.username}`);
        this.startPolling();
      }
    } catch (err: any) {
      console.error('[Telegram] Falha ao conectar ao bot:', err.message);
    }
  }

  public startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.pollLoop();
  }

  private async pollLoop() {
    const token = this.getBotToken();
    if (!token || !this.isPolling) return;

    try {
      const res = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
        params: {
          offset: this.lastUpdateId + 1,
          timeout: 25,
        },
        timeout: 30000,
      });

      if (res.data?.ok && Array.isArray(res.data.result)) {
        for (const update of res.data.result) {
          this.lastUpdateId = update.update_id;
          const message = update.message;
          if (!message || !message.text) continue;

          const chatId = String(message.chat.id);
          const text = message.text.trim();

          const currentChatId = this.getChatId();
          if (!currentChatId) {
            StorageService.getInstance().saveConfig({
              telegram: { botToken: token, chatId, enabled: true },
            } as any);
            console.log(`[Telegram] Chat ID salvo automaticamente: ${chatId}`);
          }

          await this.handleIncomingMessage(chatId, text);
        }
      }
    } catch {
      // Ignora timeouts de polling
    }

    if (this.isPolling) {
      setTimeout(() => this.pollLoop(), 1000);
    }
  }

  public async handleIncomingMessage(chatId: string, text: string): Promise<string | void> {
    const cleanText = text.trim();
    if (!cleanText) return;

    if (cleanText.startsWith('/') || cleanText.startsWith('!')) {
      const parts = cleanText.substring(1).trim().split(/\s+/);
      const cmd = parts[0].toLowerCase().split('@')[0];
      const args = parts.slice(1);

      if (cmd === 'start') {
        const welcome =
          '🛡️ *Olá Luís! Bem-vindo ao Guardião Nobe no Telegram!*\n\n' +
          'Seu Telegram foi conectado com sucesso ao sistema.\n' +
          'Você receberá notificações e perguntas aqui automaticamente.\n\n' +
          '📌 *Comandos disponíveis:*\n' +
          '/status - Exibe o status do card e horas\n' +
          '/iniciar - Inicia novo card no Trello\n' +
          '/almoco - Pausa para almoço (move para o mês)\n' +
          '/pausar - Pausa o expediente\n' +
          '/voltar - Retoma o expediente\n' +
          '/encerrar - Encerra o dia e move o card\n' +
          '/comentar <texto> - Comenta no card ativo';
        await this.sendMessage(chatId, welcome);
        return welcome;
      }

      if (this.commandHandler) {
        const reply = await this.commandHandler(cmd, args);
        if (reply) {
          await this.sendMessage(chatId, reply);
          return reply;
        }
      }
      return;
    }

    if (this.pendingQuestionResolve) {
      const resolve = this.pendingQuestionResolve;
      this.clearPendingQuestion();
      resolve(cleanText);
      const reply = `✅ *Entendido! Comentário registrado no Trello:*\n"${cleanText}"`;
      await this.sendMessage(chatId, reply);
      return reply;
    }

    // Se o usuário enviar qualquer texto livre, trata como comentário no card ativo
    if (this.commandHandler) {
      const reply = await this.commandHandler('comentar', [cleanText]);
      if (reply) {
        await this.sendMessage(chatId, reply);
        return reply;
      }
    }

    const defaultReply = '🤖 Olá Luís! Sou o Guardião Nobe. Use /status ou envie uma mensagem para comentar no card ativo.';
    await this.sendMessage(chatId, defaultReply);
    return defaultReply;
  }

  public async sendMessage(chatId: string, text: string): Promise<void> {
    const token = this.getBotToken();
    if (!token) return;

    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        },
        { timeout: 8000 }
      );
    } catch (err: any) {
      console.error(`[Telegram] Erro ao enviar mensagem para ${chatId}:`, err.message);
    }
  }

  public async sendAlert(text: string): Promise<void> {
    const chatId = this.getChatId();
    if (chatId) {
      await this.sendMessage(chatId, text);
    }
  }

  public async askActivityQuestion(
    timeoutMs = 120000,
    onTimeout?: () => void
  ): Promise<string | null> {
    const chatId = this.getChatId();
    if (!chatId || !this.getBotToken()) {
      if (onTimeout) onTimeout();
      return null;
    }

    this.clearPendingQuestion();

    const questionMessage =
      '⏰ *[Guardião Nobe]* Olá Luís!\n\n' +
      'O que você está executando agora no seu expediente?\n' +
      '_(Responda a esta mensagem em até 2 minutos para registrar no Trello)_';

    return new Promise<string | null>((resolve) => {
      this.pendingQuestionResolve = (answer) => {
        resolve(answer);
      };

      this.pendingQuestionTimer = setTimeout(() => {
        this.clearPendingQuestion();
        if (onTimeout) onTimeout();
        resolve(null);
      }, timeoutMs);

      this.sendAlert(questionMessage).catch((err) =>
        console.error('[Telegram] Falha ao enviar pergunta:', err)
      );
    });
  }

  public clearPendingQuestion() {
    if (this.pendingQuestionTimer) {
      clearTimeout(this.pendingQuestionTimer);
      this.pendingQuestionTimer = null;
    }
    this.pendingQuestionResolve = null;
  }
}
