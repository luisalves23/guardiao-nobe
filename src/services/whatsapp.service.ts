import axios from 'axios';
import QRCode from 'qrcode';
import { StorageService } from './storage.service.js';

export interface WhatsAppMessageEvent {
  from: string;
  text: string;
  timestamp: string;
}

export class WhatsAppService {
  private static instance: WhatsAppService;
  private isConnected = true;
  private qrCodeBase64: string | null = null;
  private pendingQuestionResolve: ((answer: string) => void) | null = null;
  private pendingQuestionTimer: NodeJS.Timeout | null = null;
  private commandHandler: ((command: string, args: string[]) => Promise<string | void>) | null = null;
  private recentMessages: { type: 'IN' | 'OUT'; text: string; time: string }[] = [];

  private constructor() {
    this.generateDummyQrIfUnconnected();
  }

  public static getInstance(): WhatsAppService {
    if (!WhatsAppService.instance) {
      WhatsAppService.instance = new WhatsAppService();
    }
    return WhatsAppService.instance;
  }

  private async generateDummyQrIfUnconnected() {
    try {
      this.qrCodeBase64 = await QRCode.toDataURL('GUARDIAO_NOBE_WHATSAPP_SESSION_READY');
    } catch {
      this.qrCodeBase64 = null;
    }
  }

  public setCommandHandler(handler: (command: string, args: string[]) => Promise<string | void>) {
    this.commandHandler = handler;
  }

  public async initialize(): Promise<void> {
    console.log('[WhatsApp] Serviço de mensagens e alertas inicializado.');
  }

  public getStatus() {
    return {
      connected: this.isConnected,
      qrCode: this.qrCodeBase64,
      pendingQuestion: !!this.pendingQuestionResolve,
      recentMessages: this.recentMessages.slice(-20).reverse(),
    };
  }

  public getRecentMessages() {
    return this.recentMessages.slice(-20).reverse();
  }

  /**
   * Processa mensagem recebida
   */
  public async handleIncomingMessage(sender: string, text: string): Promise<string | void> {
    const cleanText = text.trim();
    if (!cleanText) return;

    this.recentMessages.push({
      type: 'IN',
      text: cleanText,
      time: new Date().toLocaleTimeString('pt-BR'),
    });

    console.log(`[WhatsApp] Mensagem recebida de ${sender}: "${cleanText}"`);

    // 1. Se for comando com prefixo '!'
    if (cleanText.startsWith('!')) {
      const parts = cleanText.substring(1).trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      if (this.commandHandler) {
        const reply = await this.commandHandler(cmd, args);
        if (reply) {
          await this.sendMessage(sender, reply);
          return reply;
        }
      }
      return;
    }

    // 2. Se houver pergunta pendente aguardando resposta
    if (this.pendingQuestionResolve) {
      const resolve = this.pendingQuestionResolve;
      this.clearPendingQuestion();
      resolve(cleanText);
      const reply = `✅ Entendido! Comentário registrado no Trello:\n"${cleanText}"`;
      await this.sendMessage(sender, reply);
      return reply;
    }

    // Resposta padrão
    const defaultReply =
      '🤖 Olá Luís! Sou o Guardião Nobe. Estou monitorando seu Trello 24/7. Digite *!status* para ver o estado atual ou responda minhas checagens periódicas.';
    await this.sendMessage(sender, defaultReply);
    return defaultReply;
  }

  public async sendMessage(recipient: string, text: string): Promise<void> {
    this.recentMessages.push({
      type: 'OUT',
      text,
      time: new Date().toLocaleTimeString('pt-BR'),
    });

    console.log(`[WhatsApp -> ${recipient}]:\n${text}\n-------------------`);

    const webhookUrl = process.env.WHATSAPP_GATEWAY_URL;
    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, { recipient, text }, { timeout: 4000 });
      } catch (err: any) {
        console.warn(`[WhatsApp] Gateway HTTP externo falhou ao entregar: ${err.message}`);
      }
    }
  }

  public async sendAlert(text: string): Promise<void> {
    const config = StorageService.getInstance().getConfig();
    const phone = config.notificationPhone || 'Usuário Luís';
    await this.sendMessage(phone, text);
  }

  /**
   * Pergunta interativa com limite rigoroso de 2 minutos (120.000ms)
   */
  public async askActivityQuestion(
    timeoutMs = 120000,
    onTimeout?: () => void
  ): Promise<string | null> {
    this.clearPendingQuestion();

    const questionMessage =
      '⏰ *[Guardião Nobe]* Olá Luís!\n\nO que você está executando agora no seu expediente?\n_(Responda a esta mensagem em até 2 minutos para registrar no Trello)_';

    return new Promise<string | null>((resolve) => {
      this.pendingQuestionResolve = (answer) => {
        resolve(answer);
      };

      this.pendingQuestionTimer = setTimeout(() => {
        this.clearPendingQuestion();
        if (onTimeout) onTimeout();
        resolve(null);
      }, timeoutMs);

      // Dispara envio do alerta em background
      this.sendAlert(questionMessage).catch((err) =>
        console.error('[WhatsApp] Falha ao enviar alerta de pergunta:', err)
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
