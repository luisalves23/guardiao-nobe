import axios from 'axios';
import { StorageService } from '../../services/storage.service.js';

export class TelegramAdapter {
  private static instance: TelegramAdapter;
  private isPolling = false;
  private lastUpdateId = 0;
  private isAwaitingAnswer = false;
  private pendingQuestionResolve: ((answer: string | null) => void) | null = null;
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
    return Boolean(this.getBotToken() && this.getChatId());
  }

  public hasBotToken(): boolean {
    return Boolean(this.getBotToken());
  }

  public async initialize(): Promise<void> {
    const token = this.getBotToken();
    if (!token) return;

    try {
      const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 8000 });
      if (res.data?.ok) {
        console.log(`[TelegramAdapter] Bot conectado com sucesso: @${res.data.result.username}`);
        StorageService.getInstance().addLog({
          type: 'MANUAL_SYNC',
          message: `Telegram Bot @${res.data.result.username} conectado com sucesso.`,
          source: 'TELEGRAM',
        });
        this.startPolling();
      }
    } catch (err: any) {
      console.error('[TelegramAdapter] Falha ao conectar ao bot:', err.message);
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
          timeout: 10,
        },
        timeout: 15000,
      });

      if (res.data?.ok && Array.isArray(res.data.result)) {
        for (const update of res.data.result) {
          this.lastUpdateId = update.update_id;

          // 1. Trata botões inline (callback_query)
          if (update.callback_query) {
            const cb = update.callback_query;
            const data = cb.data;
            const cbChatId = String(cb.message?.chat?.id || cb.from?.id);

            StorageService.getInstance().addLog({
              type: 'COMMAND_RECEIVED',
              message: `Botão interativo "${data}" clicado no Telegram.`,
              source: 'TELEGRAM',
              details: { callback_data: data },
            });

            if (this.commandHandler && data) {
              const reply = await this.commandHandler(data, []);
              if (reply && cbChatId) {
                await this.sendMessage(cbChatId, reply);
              }
            }

            try {
              await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                callback_query_id: cb.id,
              });
            } catch {}
            continue;
          }

          // 2. Trata mensagens de texto
          const message = update.message;
          if (!message || !message.text) continue;

          const chatId = String(message.chat.id);
          const text = message.text.trim();

          const currentChatId = this.getChatId();
          if (!currentChatId || currentChatId !== chatId) {
            const config = StorageService.getInstance().getConfig();
            config.telegram = config.telegram || {};
            config.telegram.chatId = chatId;
            config.telegram.botToken = token;
            config.telegram.enabled = true;
            StorageService.getInstance().saveConfig(config);
            console.log(`[TelegramAdapter] Chat ID sincronizado: ${chatId}`);
          }

          await this.handleIncomingMessage(chatId, text);
        }
      }
    } catch {
      // Ignora timeouts de long polling normais
    }

    if (this.isPolling) {
      setTimeout(() => this.pollLoop(), 500);
    }
  }

  public async handleIncomingMessage(chatId: string, text: string): Promise<string | void> {
    const cleanText = text.trim();
    if (!cleanText) return;

    const currentChatId = this.getChatId();
    if (!currentChatId || currentChatId !== chatId) {
      const config = StorageService.getInstance().getConfig();
      config.telegram = config.telegram || {};
      config.telegram.chatId = chatId;
      StorageService.getInstance().saveConfig(config);
    }

    StorageService.getInstance().addLog({
      type: 'COMMENT_SENT',
      message: `Mensagem recebida do Telegram: "${cleanText}" (Aguardando resposta: ${this.isAwaitingAnswer})`,
      source: 'TELEGRAM',
    });

    // 1. Se estiver aguardando a resposta da pergunta de atividade
    if (this.isAwaitingAnswer && this.pendingQuestionResolve) {
      const resolve = this.pendingQuestionResolve;
      this.clearPendingQuestion();

      // Remove prefixo /comentar ou !comentar se o usuário enviou com comando
      let commentText = cleanText;
      if (commentText.toLowerCase().startsWith('/comentar') || commentText.toLowerCase().startsWith('!comentar')) {
        commentText = commentText.replace(/^[/!]comentar\s*/i, '').trim();
      }

      StorageService.getInstance().addLog({
        type: 'QUESTION_ANSWERED',
        message: `Resposta de atividade recebida do usuário no Telegram: "${commentText}"`,
        source: 'TELEGRAM',
        details: { text: commentText },
      });

      resolve(commentText);

      const reply = `✅ - [COMENTÁRIO REGISTRADO] - Postado no Trello com sucesso:\n"${commentText}"`;
      await this.sendMessage(chatId, reply);
      return reply;
    }

    // 2. Comandos com barra / ou !
    if (cleanText.startsWith('/') || cleanText.startsWith('!')) {
      const parts = cleanText.substring(1).trim().split(/\s+/);
      const cmd = parts[0].toLowerCase().split('@')[0];
      const args = parts.slice(1);

      StorageService.getInstance().addLog({
        type: 'COMMAND_RECEIVED',
        message: `Comando "/${cmd}" recebido do Telegram.`,
        source: 'TELEGRAM',
        details: { command: cmd, args },
      });

      if (cmd === 'start' || cmd === 'ajuda' || cmd === 'menu') {
        const welcome =
          '🛡️ - [MENU DE CONTROLE] - Selecione ou envie um comando:\n\n' +
          '📌 *Comandos Rápidos:*\n' +
          '/status - Ver horas trabalhadas e card ativo\n' +
          '/iniciar - Iniciar novo card no Trello\n' +
          '/almoco - Pausa para almoço (move para a pasta do mês)\n' +
          '/pausar - Pausa rápida do expediente\n' +
          '/voltar - Retomar expediente\n' +
          '/encerrar - Finalizar o dia\n' +
          '/comentar <texto> - Adicionar comentário manual no card';
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

    // 3. Se for mensagem aleatória e NÃO estiver aguardando resposta da pergunta periódica
    const menuReply =
      '🤖 - [MENU PRINCIPAL] - Comandos disponíveis:\n\n' +
      'Para registrar comentário manual:\n`/comentar seu texto aqui`\n\n' +
      '📌 *Comandos:*\n' +
      '/status - Status ao vivo e horas\n' +
      '/iniciar - Iniciar card do dia\n' +
      '/almoco - Pausa para almoço\n' +
      '/pausar - Pausa temporária\n' +
      '/voltar - Retomar tarefas\n' +
      '/encerrar - Encerrar expediente';

    await this.sendMessage(chatId, menuReply);
    return menuReply;
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
      console.error(`[TelegramAdapter] Erro ao enviar mensagem para ${chatId}:`, err.message);
    }
  }

  public async sendAlert(text: string): Promise<void> {
    const chatId = this.getChatId();
    if (chatId) {
      await this.sendMessage(chatId, text);
    }
  }

  /**
   * Lembrete interativo de pausa a cada 5 minutos com Inline Keyboard
   */
  public async sendPauseReminder(minutesPaused: number): Promise<void> {
    const chatId = this.getChatId();
    const token = this.getBotToken();
    if (!chatId || !token) return;

    const text =
      `⏸️ - [LEMBRETE DE PAUSA] - Seu expediente está pausado há *${minutesPaused} minutos*.\n\n` +
      `Seu card vigente está protegido na pasta do mês.\n` +
      `Deseja retomar agora ou encerrar o dia?`;

    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '▶️ Retomar Agora', callback_data: 'voltar' },
                { text: '🏁 Encerrar Dia', callback_data: 'encerrar' },
              ],
            ],
          },
        },
        { timeout: 8000 }
      );
    } catch (err: any) {
      console.error(`[TelegramAdapter] Erro ao enviar lembrete de pausa:`, err.message);
    }
  }

  /**
   * Pergunta interativa com janela completa de 2 minutos (120s)
   */
  public async askActivityQuestion(
    timeoutMs = 120000,
    onTimeout?: () => void
  ): Promise<string | null> {
    const chatId = this.getChatId();
    if (!chatId || !this.getBotToken()) {
      return null;
    }

    this.clearPendingQuestion();
    this.isAwaitingAnswer = true;

    const windowMinutes = Math.max(1, Math.round(timeoutMs / 60000));
    const windowText = timeoutMs >= 60000 ? `${windowMinutes} minutos` : `${Math.round(timeoutMs / 1000)} segundos`;

    StorageService.getInstance().addLog({
      type: 'QUESTION_ASKED',
      message: `Pergunta de checagem de atividade enviada para o Telegram (janela de ${windowText}).`,
      source: 'TELEGRAM',
    });

    const questionMessage =
      '⏰ - [CHECAGEM DE ATIVIDADE] - Olá Luís! O que você está executando agora no seu expediente?\n\n' +
      `_(Responda em até ${windowText} para registrar seu comentário no Trello)_`;

    return new Promise<string | null>((resolve) => {
      this.pendingQuestionResolve = (answer) => {
        this.clearPendingQuestion();
        resolve(answer);
      };

      this.pendingQuestionTimer = setTimeout(async () => {
        if (this.isAwaitingAnswer) {
          this.clearPendingQuestion();

          StorageService.getInstance().addLog({
            type: 'QUESTION_TIMEOUT',
            message: `Limite de ${windowText} expirado no Telegram sem resposta do usuário.`,
            source: 'TELEGRAM',
          });

          await this.sendMessage(
            chatId,
            '⏱️ - [TEMPO ESGOTADO] - Limite de tempo expirado. Ativando comentário automático de proteção...'
          );
          if (onTimeout) onTimeout();
          resolve(null);
        }
      }, timeoutMs);

      this.sendAlert(questionMessage).catch((err) =>
        console.error('[TelegramAdapter] Falha ao enviar pergunta:', err)
      );
    });
  }

  public clearPendingQuestion() {
    if (this.pendingQuestionTimer) {
      clearTimeout(this.pendingQuestionTimer);
      this.pendingQuestionTimer = null;
    }
    this.isAwaitingAnswer = false;
    this.pendingQuestionResolve = null;
  }
}
