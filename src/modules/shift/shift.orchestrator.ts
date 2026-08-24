import { StorageService } from '../../services/storage.service.js';
import { TrelloCardsManager, TrelloListsManager } from '../trello/index.js';
import { MessageDispatcher, TelegramAdapter } from '../messaging/index.js';
import { AgendaManager, formatTodayDate, getCommentJitterMs, getRotationJitterMs } from '../scheduler/index.js';
import { ShiftState, LiveStatus, CommentSource } from '../../types/index.js';

export class ShiftOrchestrator {
  private static instance: ShiftOrchestrator;
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

  public static getInstance(): ShiftOrchestrator {
    if (!ShiftOrchestrator.instance) {
      ShiftOrchestrator.instance = new ShiftOrchestrator();
    }
    return ShiftOrchestrator.instance;
  }

  public setBroadcastCallback(cb: (status: LiveStatus) => void) {
    this.wsBroadcastCallback = cb;
  }

  public getStatus(): LiveStatus {
    const config = StorageService.getInstance().getConfig();
    const telegram = TelegramAdapter.getInstance();

    return {
      state: this.state,
      activeCardId: this.activeCardId,
      activeCardName: this.activeCardName,
      cardStartTime: this.cardStartTime ? new Date(this.cardStartTime).toISOString() : null,
      lastCommentTime: this.lastCommentTime ? new Date(this.lastCommentTime).toISOString() : null,
      nextCommentTargetTime: this.nextCommentTargetTime ? new Date(this.nextCommentTargetTime).toISOString() : null,
      nextRotationTargetTime: this.nextRotationTargetTime ? new Date(this.nextRotationTargetTime).toISOString() : null,
      isWhatsAppConnected: telegram.isConfigured() || !!config.notificationPhone,
      isTrelloConnected: !!config.trello.apiKey && !!config.trello.token,
      todayMinutesWorked: Math.round(this.todayWorkedMinutes * 10) / 10,
      todayEarnings: Math.round((this.todayWorkedMinutes / 60) * config.hourlyRate * 100) / 100,
      lastSyncTime: new Date().toISOString(),
    };
  }

  public broadcastStatus(): void {
    if (this.wsBroadcastCallback) {
      this.wsBroadcastCallback(this.getStatus());
    }
  }

  public updateTime(elapsedMinutes: number) {
    if (this.state === 'WORKING' && this.activeCardId) {
      this.todayWorkedMinutes += elapsedMinutes;
    }
  }

  public getActiveCardId() { return this.activeCardId; }
  public getActiveCardName() { return this.activeCardName; }
  public getCardStartTime() { return this.cardStartTime; }
  public getState() { return this.state; }
  public getNextRotationTargetTime() { return this.nextRotationTargetTime; }
  public getNextCommentTargetTime() { return this.nextCommentTargetTime; }
  public isCommentInProgress() { return this.isProcessingComment; }

  public setAdoptedCard(cardId: string, cardName: string) {
    this.activeCardId = cardId;
    this.activeCardName = cardName;
    this.cardStartTime = Date.now();
    this.lastCommentTime = Date.now();
    this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
    this.nextRotationTargetTime = Date.now() + getRotationJitterMs();
    this.state = 'WORKING';
    this.broadcastStatus();
  }

  public setRotatedCard(cardId: string, cardName: string) {
    this.activeCardId = cardId;
    this.activeCardName = cardName;
    this.cardStartTime = Date.now();
    this.lastCommentTime = Date.now();
    this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
    this.nextRotationTargetTime = Date.now() + getRotationJitterMs();
    this.broadcastStatus();
  }

  public setRescued() {
    this.lastCommentTime = Date.now();
    this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
    this.broadcastStatus();
  }

  /**
   * Inicia o expediente garantindo card único (sem duplicatas) e comentário natural
   */
  public async startShift(): Promise<string> {
    const storage = StorageService.getInstance();
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();

    if (!config.trello.workingListId) {
      throw new Error('ID da lista "Trabalhando Agora" não configurado.');
    }

    try {
      // 1. Verifica se já existem cards em "Trabalhando Agora"
      const existing = await trelloCards.getCardsInList(config.trello.workingListId);
      
      let cardToUse: any = null;

      if (existing && existing.length > 0) {
        cardToUse = existing[0];
        console.log(`[ShiftOrchestrator] Card existente "${cardToUse.name}" já está em Trabalhando Agora. Reutilizando sem criar duplicata.`);

        // Se houver cards duplicados extras, move os excedentes para a pasta do mês
        if (existing.length > 1 && config.trello.boardId) {
          const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
          for (let i = 1; i < existing.length; i++) {
            await trelloCards.moveCard(existing[i].id, monthlyList.id);
          }
        }
      } else {
        // 2. Se não houver nenhum card, cria exatamente 1 card
        const dateFormatted = formatTodayDate(new Date());
        const cardTitle = `Trabalho do Dia - ${dateFormatted} - ${config.trello.userName || 'Luís Alves'}`;

        cardToUse = await trelloCards.createCard(
          config.trello.workingListId,
          cardTitle,
          config.trello.memberId
        );
      }

      this.activeCardId = cardToUse.id;
      this.activeCardName = cardToUse.name;
      this.cardStartTime = Date.now();
      this.lastCommentTime = Date.now();
      this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
      this.nextRotationTargetTime = Date.now() + getRotationJitterMs();
      this.state = 'WORKING';

      // Comentário 100% natural e discreto
      await trelloCards.addComment(cardToUse.id, 'Iniciando as atividades do dia.');

      storage.addLog({
        type: 'SHIFT_STARTED',
        message: `Expediente ativo no card "${cardToUse.name}".`,
        source: 'SYSTEM',
        details: { cardId: cardToUse.id, cardTitle: cardToUse.name },
      });

      await dispatcher.broadcastAlert(
        `🚀 *[Guardião Nobe]* Expediente ativo no Trello!\n\n📋 *Card:* ${cardToUse.name}\n⏳ *Próximo comentário:* em ~20-25min\n🔄 *Rotação prevista:* em ~3h50min`
      );

      this.broadcastStatus();
      return `Expediente iniciado com sucesso! Card: "${cardToUse.name}"`;
    } catch (err: any) {
      storage.addLog({
        type: 'ERROR',
        message: `Falha ao iniciar expediente: ${err.message}`,
        source: 'SYSTEM',
      });
      throw err;
    }
  }

  /**
   * Pausa o expediente: move todos os cards de Trabalhando Agora para a pasta do mês
   */
  public async pauseShift(): Promise<string> {
    if (this.state !== 'WORKING') {
      return 'Expediente não está em andamento.';
    }

    this.state = 'PAUSED';
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const storage = StorageService.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();

    if (config.trello.boardId && config.trello.workingListId) {
      try {
        const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
        const cardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);
        
        for (const card of cardsInWorking) {
          await trelloCards.addComment(card.id, 'Pausa rápida.');
          await trelloCards.moveCard(card.id, monthlyList.id);
        }
      } catch (err: any) {
        console.error('[ShiftOrchestrator] Erro ao mover card no pause:', err.message);
      }
    }

    storage.addLog({
      type: 'PAUSED',
      message: 'Expediente pausado temporariamente. Card movido para a coluna mensal.',
      source: 'SYSTEM',
    });

    await dispatcher.broadcastAlert(
      '⏸️ *[Guardião Nobe]* Expediente pausado. Card movido para a pasta do mês para pausar a contagem.'
    );

    this.broadcastStatus();
    return 'Expediente pausado e card movido para a coluna do mês.';
  }

  /**
   * Retoma o expediente trazendo o card de volta ou abrindo novo se expirou
   */
  public async resumeShift(): Promise<string> {
    if (this.state !== 'PAUSED' && this.state !== 'LUNCH') {
      return 'Expediente não estava pausado.';
    }

    this.state = 'WORKING';
    const trelloCards = TrelloCardsManager.getInstance();
    const storage = StorageService.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();

    const now = Date.now();
    const rotationLimitMinutes = config.rotationLimitMinutes || 230;
    const cardAgeMinutes = this.cardStartTime ? (now - this.cardStartTime) / (1000 * 60) : 999;

    if (!this.activeCardId || cardAgeMinutes >= rotationLimitMinutes) {
      const dateFormatted = formatTodayDate(new Date());
      const cardTitle = `Trabalho do Dia - ${dateFormatted} - ${config.trello.userName || 'Luís Alves'}`;
      const newCard = await trelloCards.createCard(config.trello.workingListId, cardTitle, config.trello.memberId);

      this.activeCardId = newCard.id;
      this.activeCardName = cardTitle;
      this.cardStartTime = Date.now();
      this.lastCommentTime = Date.now();
      this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
      this.nextRotationTargetTime = Date.now() + getRotationJitterMs();

      await trelloCards.addComment(newCard.id, 'Iniciando novo bloco de atividades.');

      storage.addLog({
        type: 'RESUMED',
        message: `Expediente retomado com novo card "${cardTitle}".`,
        source: 'SYSTEM',
      });
    } else {
      await trelloCards.moveCard(this.activeCardId, config.trello.workingListId);
      this.lastCommentTime = Date.now();
      this.nextCommentTargetTime = Date.now() + getCommentJitterMs();

      await trelloCards.addComment(this.activeCardId, 'Retomando as tarefas.');

      storage.addLog({
        type: 'RESUMED',
        message: 'Expediente retomado. Card restaurado para Trabalhando Agora.',
        source: 'SYSTEM',
      });
    }

    await dispatcher.broadcastAlert(
      '▶️ *[Guardião Nobe]* Expediente retomado com sucesso! Card ativo em Trabalhando Agora.'
    );

    this.broadcastStatus();
    return 'Expediente retomado com sucesso.';
  }

  /**
   * Almoço: move todos os cards de Trabalhando Agora para a pasta do mês
   */
  public async startLunch(): Promise<string> {
    this.state = 'LUNCH';
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const storage = StorageService.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();

    if (config.trello.boardId && config.trello.workingListId) {
      try {
        const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
        const cardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);
        
        for (const card of cardsInWorking) {
          await trelloCards.addComment(card.id, 'Pausa para almoço.');
          await trelloCards.moveCard(card.id, monthlyList.id);
        }
      } catch (err: any) {
        console.error('[ShiftOrchestrator] Erro ao mover card no almoço:', err.message);
      }
    }

    storage.addLog({
      type: 'LUNCH_STARTED',
      message: 'Pausa para almoço iniciada. Card movido para a coluna mensal.',
      source: 'SYSTEM',
    });

    await dispatcher.broadcastAlert(
      '🍽️ *[Guardião Nobe]* Pausa para almoço iniciada! Card movido para a pasta do mês para não contar horas durante a refeição.'
    );

    this.broadcastStatus();
    return 'Almoço iniciado e card movido para a coluna do mês.';
  }

  /**
   * Encerramento do dia: move todos os cards e encerra contagem
   */
  public async endShift(): Promise<string> {
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const storage = StorageService.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();

    if (config.trello.boardId && config.trello.workingListId) {
      try {
        const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
        const cardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);

        for (const card of cardsInWorking) {
          await trelloCards.addComment(card.id, 'Finalizando o expediente por hoje.');
          await trelloCards.moveCard(card.id, monthlyList.id);
        }
      } catch (err: any) {
        console.error('[ShiftOrchestrator] Erro ao mover card no encerramento:', err.message);
      }
    }

    storage.addLog({
      type: 'SHIFT_ENDED',
      message: `Expediente encerrado. Total de hoje: ${Math.floor(this.todayWorkedMinutes / 60)}h ${Math.round(this.todayWorkedMinutes % 60)}m.`,
      source: 'SYSTEM',
    });

    await dispatcher.broadcastAlert(
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
   * Rotação do card de 4 horas
   */
  public async rotateCard(): Promise<void> {
    if (this.isProcessingRotation || !this.activeCardId) return;
    this.isProcessingRotation = true;

    const storage = StorageService.getInstance();
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();

    try {
      const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);

      await trelloCards.addComment(
        this.activeCardId,
        'Atualizando card para continuidade das tarefas.'
      );
      await trelloCards.moveCard(this.activeCardId, monthlyList.id);

      const dateFormatted = formatTodayDate(new Date());
      const cardTitle = `Trabalho do Dia - ${dateFormatted} - ${config.trello.userName || 'Luís Alves'}`;

      const newCard = await trelloCards.createCard(
        config.trello.workingListId,
        cardTitle,
        config.trello.memberId
      );

      this.activeCardId = newCard.id;
      this.activeCardName = cardTitle;
      this.cardStartTime = Date.now();
      this.lastCommentTime = Date.now();
      this.nextCommentTargetTime = Date.now() + getCommentJitterMs();
      this.nextRotationTargetTime = Date.now() + getRotationJitterMs();

      await trelloCards.addComment(
        newCard.id,
        'Iniciando novo bloco de atividades.'
      );

      storage.addLog({
        type: 'CARD_ROTATED',
        message: `Card rotacionado aos ~3h55. Card anterior movido para "${monthlyList.name}" e novo card aberto.`,
        source: 'SYSTEM',
        details: { newCardId: newCard.id, cardTitle },
      });

      await dispatcher.broadcastAlert(
        `🔄 *[Guardião Nobe]* ROTAÇÃO DE CARD REALIZADA!\n\nSeu card anterior atingiu ~3h55 e foi movido para a coluna "${monthlyList.name}".\nUm novo card (*${cardTitle}*) já está aberto em "Trabalhando Agora" com contagem contínua!`
      );
    } catch (err: any) {
      console.error('[ShiftOrchestrator] Falha na rotação do card:', err.message);
      storage.addLog({
        type: 'ERROR',
        message: `Erro na rotação do card: ${err.message}`,
        source: 'SYSTEM',
      });
      await dispatcher.broadcastAlert(`🚨 *[Guardião Nobe]* Falha ao rotacionar card no Trello: ${err.message}`);
    } finally {
      this.isProcessingRotation = false;
      this.broadcastStatus();
    }
  }

  /**
   * Envio de comentário periódico
   */
  public async sendPeriodicComment(): Promise<void> {
    if (this.isProcessingComment || !this.activeCardId) return;
    this.isProcessingComment = true;

    const storage = StorageService.getInstance();
    const trelloCards = TrelloCardsManager.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const agenda = AgendaManager.getInstance();

    try {
      let commentText: string | null = null;
      let source: CommentSource = 'WHATSAPP';

      const userReply = await dispatcher.askActivityQuestion(120000, () => {
        console.log('[ShiftOrchestrator] Timeout de 2 min atingido. Ativando fallback...');
      });

      if (userReply && userReply.trim()) {
        commentText = userReply.trim();
        source = 'WHATSAPP';
      } else {
        const resolved = agenda.resolveFallbackComment();
        commentText = resolved.text;
        source = resolved.source;

        const fallbackMsg = `⏱️ *[Guardião Nobe]* Limite de 2 min expirado.\nPara manter suas horas ativas na Nobe, comentei no Trello:\n\n💬 _"${commentText}"_`;
        await dispatcher.broadcastAlert(fallbackMsg);
      }

      await trelloCards.addComment(this.activeCardId, commentText);
      this.lastCommentTime = Date.now();
      this.nextCommentTargetTime = Date.now() + getCommentJitterMs();

      storage.addLog({
        type: 'COMMENT_SENT',
        message: `Comentário postado no Trello: "${commentText}"`,
        source,
        details: { text: commentText },
      });
    } catch (err: any) {
      console.error('[ShiftOrchestrator] Erro ao enviar comentário:', err.message);
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
}
