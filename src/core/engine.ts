import { StorageService } from '../services/storage.service.js';
import { TrelloService } from '../services/trello.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { TelegramService } from '../services/telegram.service.js';
import { getCommentJitterMs, getRotationJitterMs, formatTodayDate } from './jitter.js';
import { ShiftState, LiveStatus, CommentSource } from '../types/index.js';

export class Engine {
  private static instance: Engine;
  private state: ShiftState = 'IDLE';
  private activeCardId: string | null = null;
  private activeCardName: string | null = null;
  private cardStartTime: number | null = null;
  private lastCommentTime: number | null = null;
  private nextCommentTargetTime: number | null = null;
  private nextRotationTargetTime: number | null = null;
  private isProcessingComment = false;
  private isProcessingRotation = false;
  private todayWorkedMinutes = 0;
  private lastTickTime: number = Date.now();
  private wsBroadcastCallback: ((status: LiveStatus) => void) | null = null;

  private constructor() {}

  public static getInstance(): Engine {
    if (!Engine.instance) {
      Engine.instance = new Engine();
    }
    return Engine.instance;
  }

  public setBroadcastCallback(cb: (status: LiveStatus) => void) {
    this.wsBroadcastCallback = cb;
  }

  public async initialize(): Promise<void> {
    console.log('[Engine] Inicializando motor de controle do Guardião Nobe (Polling: 3 segundos)...');
    const whatsapp = WhatsAppService.getInstance();
    const telegram = TelegramService.getInstance();

    const commandHandler = async (cmd: string, args: string[]) => {
      return this.handleWhatsAppCommand(cmd, args);
    };

    whatsapp.setCommandHandler(commandHandler);
    telegram.setCommandHandler(commandHandler);
    await telegram.initialize();

    // Loop ultra-rápido de monitoramento a cada 3 segundos
    const timer = setInterval(() => {
      this.tick().catch((err) => console.error('[Engine] Erro no tick:', err.message));
    }, 3000);
    timer.unref();
  }

  private async broadcastAlert(text: string) {
    await WhatsAppService.getInstance().sendAlert(text);
    await TelegramService.getInstance().sendAlert(text);
  }

  public getStatus(): LiveStatus {
    const config = StorageService.getInstance().getConfig();
    const whatsapp = WhatsAppService.getInstance();
    const wsStatus = whatsapp.getStatus();

    return {
      state: this.state,
      activeCardId: this.activeCardId,
      activeCardName: this.activeCardName,
      cardStartTime: this.cardStartTime ? new Date(this.cardStartTime).toISOString() : null,
      lastCommentTime: this.lastCommentTime ? new Date(this.lastCommentTime).toISOString() : null,
      nextCommentTargetTime: this.nextCommentTargetTime
        ? new Date(this.nextCommentTargetTime).toISOString()
        : null,
      nextRotationTargetTime: this.nextRotationTargetTime
        ? new Date(this.nextRotationTargetTime).toISOString()
        : null,
      isWhatsAppConnected: wsStatus.connected,
      isTrelloConnected: !!(config.trello.apiKey && config.trello.token && config.trello.boardId),
      todayMinutesWorked: Number(this.todayWorkedMinutes.toFixed(1)),
      todayEarnings: Number(((this.todayWorkedMinutes / 60) * config.hourlyRate).toFixed(2)),
      lastSyncTime: new Date().toISOString(),
    };
  }

  public broadcastStatus() {
    if (this.wsBroadcastCallback) {
      this.wsBroadcastCallback(this.getStatus());
    }
  }

  /**
   * INICIAR EXPEDIENTE / CRIAR CARD
   */
  public async startShift(): Promise<string> {
    if (this.state === 'WORKING' && this.activeCardId) {
      return `O expediente já está ativo com o card: "${this.activeCardName}"`;
    }

    const storage = StorageService.getInstance();
    const trello = TrelloService.getInstance();
    const whatsapp = WhatsAppService.getInstance();
    const config = storage.getConfig();

    if (!config.trello.workingListId || !config.trello.boardId) {
      throw new Error('Configurações do Trello incompletas (Working List ID ou Board ID ausentes).');
    }

    const dateFormatted = formatTodayDate(new Date());
    const cardTitle = `Trabalho do Dia - ${dateFormatted} - ${config.trello.userName || 'Luís Alves'}`;

    try {
      console.log(`[Engine] Criando card para início de expediente: "${cardTitle}"`);
      const card = await trello.createCard(
        config.trello.workingListId,
        cardTitle,
        config.trello.memberId
      );

      this.activeCardId = card.id;
      this.activeCardName = cardTitle;
      this.cardStartTime = Date.now();
      this.lastCommentTime = Date.now();

      // Jitter 20-25m para comentários e 3h50-3h58 para rotação
      this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
      this.nextRotationTargetTime = Date.now() + getRotationJitterMs();
      this.state = 'WORKING';

      // Comentário inicial obrigatório no Trello
      await trello.addComment(card.id, 'Início do expediente - Tarefas do dia em andamento.');

      storage.addLog({
        type: 'SHIFT_STARTED',
        message: `Card "${cardTitle}" criado na coluna Trabalhando Agora. Monitoramento 24/7 ativado.`,
        source: 'SYSTEM',
        details: { cardId: card.id, cardTitle },
      });

      await this.broadcastAlert(
        `🚀 *[Guardião Nobe]* Expediente ativo no Trello!\n\n📋 *Card:* ${cardTitle}\n⏳ *Próximo comentário:* em ~20-25min\n🔄 *Rotação prevista:* em ~3h50min`
      );

      this.broadcastStatus();
      return `Expediente iniciado com sucesso! Card: "${cardTitle}"`;
    } catch (err: any) {
      storage.addLog({
        type: 'ERROR',
        message: `Falha ao iniciar expediente no Trello: ${err.message}`,
        source: 'SYSTEM',
      });
      throw err;
    }
  }

  /**
   * PAUSAR EXPEDIENTE
   */
  public async pauseShift(): Promise<string> {
    if (this.state !== 'WORKING') {
      return 'Expediente não está em andamento.';
    }

    this.state = 'PAUSED';
    StorageService.getInstance().addLog({
      type: 'PAUSED',
      message: 'Expediente pausado temporariamente.',
      source: 'SYSTEM',
    });

    await this.broadcastAlert(
      '⏸️ *[Guardião Nobe]* Expediente pausado.'
    );

    this.broadcastStatus();
    return 'Expediente pausado.';
  }

  /**
   * RETOMAR EXPEDIENTE
   */
  public async resumeShift(): Promise<string> {
    if (this.state !== 'PAUSED' && this.state !== 'LUNCH') {
      return 'Expediente não estava pausado.';
    }

    this.state = 'WORKING';
    this.lastCommentTime = Date.now();
    this.nextCommentTargetTime = Date.now() + getCommentJitterMs();

    if (this.activeCardId) {
      const templates = StorageService.getInstance().getConfig().fallbackTemplates || [];
      const comment = templates.length > 0 ? templates[0] : 'Retomando atividades após pausa.';
      await TrelloService.getInstance().addComment(this.activeCardId, comment);
    }

    StorageService.getInstance().addLog({
      type: 'RESUMED',
      message: 'Expediente retomado.',
      source: 'SYSTEM',
    });

    await this.broadcastAlert(
      '▶️ *[Guardião Nobe]* Expediente retomado com sucesso!'
    );

    this.broadcastStatus();
    return 'Expediente retomado.';
  }

  /**
   * INICIAR ALMOÇO
   */
  public async startLunch(): Promise<string> {
    this.state = 'LUNCH';
    StorageService.getInstance().addLog({
      type: 'LUNCH_STARTED',
      message: 'Pausa para almoço iniciada.',
      source: 'SYSTEM',
    });

    await this.broadcastAlert(
      '🍽️ *[Guardião Nobe]* Pausa para almoço iniciada.'
    );

    this.broadcastStatus();
    return 'Almoço iniciado.';
  }

  /**
   * ENCERRAR EXPEDIENTE
   */
  public async endShift(): Promise<string> {
    const storage = StorageService.getInstance();
    const trello = TrelloService.getInstance();
    const config = storage.getConfig();

    if (this.activeCardId && config.trello.boardId) {
      try {
        const monthlyList = await trello.findOrCreateMonthlyList(config.trello.boardId);
        await trello.addComment(
          this.activeCardId,
          'Expediente finalizado com sucesso. Encerrando contagem de horas do dia.'
        );
        await trello.moveCard(this.activeCardId, monthlyList.id);
        console.log(`[Engine] Card movido para a coluna mensal "${monthlyList.name}"`);
      } catch (err: any) {
        console.error('[Engine] Erro ao mover card no encerramento:', err.message);
      }
    }

    storage.addLog({
      type: 'SHIFT_ENDED',
      message: `Expediente encerrado. Total de hoje: ${Math.floor(this.todayWorkedMinutes / 60)}h ${Math.round(this.todayWorkedMinutes % 60)}m.`,
      source: 'SYSTEM',
    });

    await this.broadcastAlert(
      `🏁 *[Guardião Nobe]* Expediente encerrado!\n\n⏱️ *Total de horas trabalhadas:* ${(this.todayWorkedMinutes / 60).toFixed(1)}h\n💰 *Ganhos de hoje:* R$ ${((this.todayWorkedMinutes / 60) * config.hourlyRate).toFixed(2)}`
    );

    this.state = 'IDLE';
    this.activeCardId = null;
    this.activeCardName = null;
    this.cardStartTime = null;
    this.nextCommentTargetTime = null;
    this.nextRotationTargetTime = null;

    this.broadcastStatus();
    return 'Expediente encerrado com sucesso.';
  }

  /**
   * ROTAÇÃO DO CARD DE 4 HORAS (3h50 - 3h58)
   */
  public async rotateCard(): Promise<void> {
    if (this.isProcessingRotation || !this.activeCardId) return;
    this.isProcessingRotation = true;

    const storage = StorageService.getInstance();
    const trello = TrelloService.getInstance();
    const whatsapp = WhatsAppService.getInstance();
    const config = storage.getConfig();

    try {
      console.log('[Engine] Executando rotação de 4h (3h50-3h58) para zero perda de horas...');
      const monthlyList = await trello.findOrCreateMonthlyList(config.trello.boardId);

      // Finaliza o card atual e move para o mês
      await trello.addComment(
        this.activeCardId,
        'Limite de 4 horas atingido. Finalizando este bloco e abrindo novo card para continuidade ininterrupta.'
      );
      await trello.moveCard(this.activeCardId, monthlyList.id);

      // Cria novo card na coluna "Trabalhando Agora"
      const dateFormatted = formatTodayDate(new Date());
      const cardTitle = `Trabalho do Dia - ${dateFormatted} - ${config.trello.userName || 'Luís Alves'}`;

      const newCard = await trello.createCard(
        config.trello.workingListId,
        cardTitle,
        config.trello.memberId
      );

      this.activeCardId = newCard.id;
      this.activeCardName = cardTitle;
      this.cardStartTime = Date.now();
      this.lastCommentTime = Date.now();

      // Novos alvos com jitter
      this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
      this.nextRotationTargetTime = Date.now() + getRotationJitterMs();

      await trello.addComment(
        newCard.id,
        'Continuidade do expediente - Novo card ativo para contagem de horas.'
      );

      storage.addLog({
        type: 'CARD_ROTATED',
        message: `Card rotacionado aos ~3h55. Card anterior movido para "${monthlyList.name}" e novo card aberto.`,
        source: 'SYSTEM',
        details: { newCardId: newCard.id, cardTitle },
      });

      await this.broadcastAlert(
        `🔄 *[Guardião Nobe]* ROTAÇÃO DE CARD REALIZADA!\n\nSeu card anterior atingiu ~3h55 e foi movido para a coluna "${monthlyList.name}".\nUm novo card (*${cardTitle}*) já está aberto em "Trabalhando Agora" com contagem contínua!`
      );
    } catch (err: any) {
      console.error('[Engine] Falha na rotação do card:', err.message);
      storage.addLog({
        type: 'ERROR',
        message: `Erro na rotação do card: ${err.message}`,
        source: 'SYSTEM',
      });
      await this.broadcastAlert(`🚨 *[Guardião Nobe]* Falha ao rotacionar card no Trello: ${err.message}`);
    } finally {
      this.isProcessingRotation = false;
      this.broadcastStatus();
    }
  }

  /**
   * ENVIO DE COMENTÁRIO PERIÓDICO (Tripla camada: WhatsApp [2m timeout] -> Agenda -> Templates)
   */
  public async sendPeriodicComment(): Promise<void> {
    if (this.isProcessingComment || !this.activeCardId) return;
    this.isProcessingComment = true;

    const storage = StorageService.getInstance();
    const trello = TrelloService.getInstance();
    const whatsapp = WhatsAppService.getInstance();
    const config = storage.getConfig();

    try {
      console.log('[Engine] Checagem de comentário periódico (Timeout: 2 min)...');
      let commentText: string | null = null;
      let source: CommentSource = 'WHATSAPP';

      // 1. Tenta perguntar via Telegram ou WhatsApp com timeout estrito de 2 minutos (120.000 ms)
      const telegram = TelegramService.getInstance();
      let userReply: string | null = null;

      if (telegram.isConfigured()) {
        userReply = await telegram.askActivityQuestion(120000, () => {
          console.log('[Engine] Timeout de 2 min do Telegram atingido. Ativando fallback...');
        });
        if (userReply) source = 'WHATSAPP'; // Interativo
      } else {
        userReply = await whatsapp.askActivityQuestion(120000, () => {
          console.log('[Engine] Timeout de 2 min do WhatsApp atingido. Ativando fallback...');
        });
        if (userReply) source = 'WHATSAPP';
      }

      if (userReply && userReply.trim()) {
        commentText = userReply.trim();
      } else {
        // 2. Fallback: Agenda
        const agenda = storage.getAgenda();
        const pendingAgenda = agenda.find((a) => !a.completed);

        if (pendingAgenda && pendingAgenda.topic) {
          commentText = `Atividade em andamento: ${pendingAgenda.topic}`;
          source = 'AGENDA';
        } else {
          // 3. Fallback: Templates pré-configurados pelo usuário
          const templates = config.fallbackTemplates || [];
          if (templates.length > 0) {
            const randomIndex = Math.floor(Math.random() * templates.length);
            commentText = templates[randomIndex];
          } else {
            commentText = 'Desenvolvimento e execução das atividades em andamento.';
          }
          source = 'FALLBACK_TEMPLATE';
        }

        // Notifica nos canais que o fallback foi usado
        const fallbackMsg = `⏱️ *[Guardião Nobe]* Limite de 2 min expirado.\nPara não perder tempo na Nobe, comentei automaticamente no Trello:\n\n💬 _"${commentText}"_`;
        await whatsapp.sendAlert(fallbackMsg);
        await telegram.sendAlert(fallbackMsg);
      }

      // Publica no Trello
      await trello.addComment(this.activeCardId, commentText);
      this.lastCommentTime = Date.now();
      this.nextCommentTargetTime = Date.now() + getCommentJitterMs();

      storage.addLog({
        type: 'COMMENT_SENT',
        message: `Comentário postado no Trello: "${commentText}"`,
        source,
        details: { text: commentText },
      });
    } catch (err: any) {
      console.error('[Engine] Erro ao enviar comentário:', err.message);
      storage.addLog({
        type: 'ERROR',
        message: `Erro ao enviar comentário periódico: ${err.message}`,
        source: 'SYSTEM',
      });
    } finally {
      this.isProcessingComment = false;
      this.broadcastStatus();
    }
  }

  /**
   * AUTO-RESGATE E MONITORAMENTO CONTÍNUO (Loop a cada 3 segundos)
   */
  private async tick(): Promise<void> {
    const now = Date.now();
    const elapsedMinutes = (now - this.lastTickTime) / (1000 * 60);
    this.lastTickTime = now;

    const storage = StorageService.getInstance();
    const trello = TrelloService.getInstance();
    const config = storage.getConfig();

    if (!config.trello.boardId || !config.trello.workingListId) {
      return;
    }

    // 1. Detecção automática de card em "Trabalhando Agora" (Adoção contínua 24/7)
    if (!this.activeCardId) {
      try {
        const cards = await trello.getCardsInList(config.trello.workingListId);
        if (cards && cards.length > 0) {
          // Se houver um card no Trabalhando Agora, adota o primeiro
          const found = cards[0];
          this.activeCardId = found.id;
          this.activeCardName = found.name;
          this.cardStartTime = Date.now();
          this.lastCommentTime = Date.now();
          this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
          this.nextRotationTargetTime = Date.now() + getRotationJitterMs();
          this.state = 'WORKING';

          storage.addLog({
            type: 'SHIFT_STARTED',
            message: `Card existente "${found.name}" detectado e adotado automaticamente em Trabalhando Agora.`,
            source: 'SYSTEM',
            details: { cardId: found.id },
          });
        }
      } catch {
        // Silêncio se não conseguir consultar
      }
    }

    if (this.state === 'WORKING' && this.activeCardId) {
      this.todayWorkedMinutes += elapsedMinutes;

      // A. Rotação de 4 Horas (3h50 a 3h58)
      if (this.nextRotationTargetTime && now >= this.nextRotationTargetTime) {
        await this.rotateCard();
      }

      // B. Comentário periódico com Jitter (20 a 25 min)
      if (this.nextCommentTargetTime && now >= this.nextCommentTargetTime && !this.isProcessingComment) {
        this.sendPeriodicComment().catch((err) =>
          console.error('[Engine] Erro no sendPeriodicComment:', err.message)
        );
      }

      // C. AUTO-RESGATE A CADA 3 SEGUNDOS: Checa se "A Presidência" moveu o card para "EM ESPERA"
      try {
        const card = await trello.getCard(this.activeCardId);

        if (config.trello.waitListId && card.idList === config.trello.waitListId) {
          console.warn('[Engine] 🚨 AUTO-RESGATE ACIONADO (3s)! Card em "EM ESPERA". Restaurando...');
          
          // Move de volta para "Trabalhando Agora"
          await trello.moveCard(this.activeCardId, config.trello.workingListId);
          
          // Comentário selecionado a partir da lista de templates configurados pelo usuário
          const templates = config.fallbackTemplates || [];
          const rescueComment = templates.length > 0
            ? templates[Math.floor(Math.random() * templates.length)]
            : 'Reativando contagem de horas do card.';

          await trello.addComment(this.activeCardId, rescueComment);

          this.lastCommentTime = Date.now();
          this.nextCommentTargetTime = Date.now() + getCommentJitterMs();

          storage.addLog({
            type: 'AUTO_RESCUED',
            message: `Card resgatado de "EM ESPERA" e reativado em "Trabalhando Agora" com o comentário: "${rescueComment}"`,
            source: 'FALLBACK_TEMPLATE',
          });

          await this.broadcastAlert(
            `🚨 *[AUTO-RESGATE EXECUTADO EM 3s]*\n\nO robô "A Presidência" moveu seu card para *"EM ESPERA"*!\nO Guardião Nobe detectou instantaneamente, restaurou para *"Trabalhando Agora"* e postou:\n💬 _"${rescueComment}"_\n\nSuas horas continuam seguras sem desconto!`
          );
        }
      } catch (err: any) {
        // Tratamento de erro suave
      }
    }

    this.broadcastStatus();
  }

  /**
   * Processador de Comandos do WhatsApp
   */
  private async handleWhatsAppCommand(cmd: string, args: string[]): Promise<string> {
    switch (cmd) {
      case 'status': {
        const s = this.getStatus();
        return `📊 *Status Guardião Nobe 24/7*\n\n🔹 *Estado:* ${s.state}\n📋 *Card:* ${s.activeCardName || 'Nenhum'}\n⏱️ *Horas Hoje:* ${(s.todayMinutesWorked / 60).toFixed(1)}h\n💰 *Ganhos Hoje:* R$ ${s.todayEarnings.toFixed(2)}`;
      }
      case 'iniciar':
        return await this.startShift();
      case 'pausar':
        return await this.pauseShift();
      case 'voltar':
      case 'continuar':
        return await this.resumeShift();
      case 'almoco':
      case 'almoçar':
        return await this.startLunch();
      case 'encerrar':
        return await this.endShift();
      case 'comentar': {
        const text = args.join(' ');
        if (!text) return 'Envie o texto do comentário: !comentar Desenvolvendo tela de login';
        if (!this.activeCardId) return 'Nenhum card ativo no momento.';
        await TrelloService.getInstance().addComment(this.activeCardId, text);
        this.lastCommentTime = Date.now();
        this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
        StorageService.getInstance().addLog({
          type: 'COMMENT_SENT',
          message: `Comentário manual enviado via WhatsApp: "${text}"`,
          source: 'WHATSAPP',
        });
        return `✅ Comentário registrado no card com sucesso:\n"${text}"`;
      }
      case 'ajuda':
      default:
        return `🤖 *Comandos Guardião Nobe:*\n\n!status - Status ao vivo\n!comentar <texto> - Comenta no card ativo\n!iniciar - Abre novo card\n!encerrar - Move para a coluna mensal`;
    }
  }
}
