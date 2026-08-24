import { StorageService } from '../../services/storage.service.js';
import { TrelloCardsManager, TrelloListsManager } from '../trello/index.js';
import { MessageDispatcher, TelegramAdapter } from '../messaging/index.js';
import { AgendaManager, formatTodayDate, formatHMS, getCommentJitterMs, getRotationJitterMs } from '../scheduler/index.js';
import { ShiftState, LiveStatus, CommentSource } from '../../types/index.js';

export class ShiftOrchestrator {
  private static instance: ShiftOrchestrator;
  private state: ShiftState = 'IDLE';
  private activeCardId: string | null = null;
  private activeCardName: string | null = null;
  private cardDate: string | null = null;
  private cardStartTime: number | null = null;
  private cardAccumulatedMinutes: number = 0;
  private lastCommentTime: number | null = null;
  private nextCommentTargetTime: number | null = null;
  private nextRotationTargetTime: number | null = null;
  private isProcessingComment = false;
  private isProcessingRotation = false;
  private todayWorkedMinutes = 0;
  private todayWorkedSeconds = 0;
  private wsBroadcastCallback: ((status: LiveStatus) => void) | null = null;

  private constructor() {
    this.restorePersistentState();
  }

  public static getInstance(): ShiftOrchestrator {
    if (!ShiftOrchestrator.instance) {
      ShiftOrchestrator.instance = new ShiftOrchestrator();
    }
    return ShiftOrchestrator.instance;
  }

  private restorePersistentState() {
    const saved = StorageService.getInstance().getShiftState();
    const today = formatTodayDate(new Date());

    if (saved && saved.cardId && saved.cardDate === today) {
      this.activeCardId = saved.cardId;
      this.activeCardName = saved.cardName;
      this.cardDate = saved.cardDate;
      this.cardStartTime = saved.cardCreatedAt;
      this.cardAccumulatedMinutes = saved.accumulatedMinutes || 0;
      this.todayWorkedMinutes = saved.accumulatedMinutes || 0;
      this.todayWorkedSeconds = (saved.accumulatedMinutes || 0) * 60;
      console.log(`[ShiftOrchestrator] Card vigente restaurado da persistência: "${this.activeCardName}" (${this.cardAccumulatedMinutes.toFixed(1)}m trabalhados hoje).`);
    }
  }

  private saveCurrentState() {
    StorageService.getInstance().saveShiftState({
      cardId: this.activeCardId,
      cardName: this.activeCardName,
      cardDate: this.cardDate,
      cardCreatedAt: this.cardStartTime,
      accumulatedMinutes: this.cardAccumulatedMinutes,
    });
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
      todaySecondsWorked: Math.floor(this.todayWorkedSeconds),
      todayFormattedTime: formatHMS(this.todayWorkedSeconds),
      todayEarnings: Math.round((this.todayWorkedSeconds / 3600) * config.hourlyRate * 100) / 100,
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
      const elapsedSeconds = elapsedMinutes * 60;
      this.todayWorkedSeconds += elapsedSeconds;
      this.todayWorkedMinutes = this.todayWorkedSeconds / 60;
      this.cardAccumulatedMinutes += elapsedMinutes;
      this.saveCurrentState();
    }
  }

  public getActiveCardId() { return this.activeCardId; }
  public getActiveCardName() { return this.activeCardName; }
  public getCardStartTime() { return this.cardStartTime; }
  public getCardAccumulatedMinutes() { return this.cardAccumulatedMinutes; }
  public getState() { return this.state; }
  public getNextRotationTargetTime() { return this.nextRotationTargetTime; }
  public getNextCommentTargetTime() { return this.nextCommentTargetTime; }
  public isCommentInProgress() { return this.isProcessingComment; }

  private scheduleNextJitters() {
    const commentJitterMs = getCommentJitterMs();
    const rotationJitterMs = getRotationJitterMs();
    this.lastCommentTime = Date.now();
    this.nextCommentTargetTime = Date.now() + commentJitterMs;
    this.nextRotationTargetTime = Date.now() + rotationJitterMs;

    StorageService.getInstance().addLog({
      type: 'JITTER_CALCULATED',
      message: `Próximo comentário sorteado para daqui a ${(commentJitterMs / 60000).toFixed(1)}m. Rotação prevista para daqui a ${(rotationJitterMs / 60000).toFixed(1)}m.`,
      source: 'SYSTEM',
      details: {
        nextCommentInMinutes: Math.round(commentJitterMs / 60000),
        nextRotationInMinutes: Math.round(rotationJitterMs / 60000),
        nextCommentTime: new Date(this.nextCommentTargetTime).toISOString(),
        nextRotationTime: new Date(this.nextRotationTargetTime).toISOString(),
      },
    });
  }

  public setAdoptedCard(cardId: string, cardName: string) {
    this.activeCardId = cardId;
    this.activeCardName = cardName;
    this.cardDate = formatTodayDate(new Date());
    if (!this.cardStartTime) this.cardStartTime = Date.now();
    this.state = 'WORKING';
    this.scheduleNextJitters();
    this.saveCurrentState();
    this.broadcastStatus();
  }

  public setRotatedCard(cardId: string, cardName: string) {
    this.activeCardId = cardId;
    this.activeCardName = cardName;
    this.cardDate = formatTodayDate(new Date());
    this.cardStartTime = Date.now();
    this.cardAccumulatedMinutes = 0;
    this.scheduleNextJitters();
    this.saveCurrentState();
    this.broadcastStatus();
  }

  public setRescued() {
    this.scheduleNextJitters();
    this.saveCurrentState();
    this.broadcastStatus();
  }

  /**
   * INICIAR EXPEDIENTE: Garante rastreamento do card vigente sem duplicatas
   */
  public async startShift(): Promise<string> {
    const storage = StorageService.getInstance();
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();
    const today = formatTodayDate(new Date());

    if (!config.trello.workingListId) {
      throw new Error('ID da lista "Trabalhando Agora" não configurado.');
    }

    try {
      const rotationLimit = config.rotationLimitMinutes || 230;

      // 1. Verifica se já temos um card vigente para hoje com tempo disponível
      if (this.activeCardId && this.cardDate === today && this.cardAccumulatedMinutes < rotationLimit) {
        try {
          const card = await trelloCards.getCard(this.activeCardId);
          if (card.closed) {
            console.log(`[ShiftOrchestrator] Card vigente "${this.activeCardName}" estava arquivado. Desarquivando em Trabalhando Agora...`);
            await trelloCards.unarchiveCard(this.activeCardId, config.trello.workingListId);
          } else {
            console.log(`[ShiftOrchestrator] Reutilizando card vigente "${this.activeCardName}" para o expediente.`);
            await trelloCards.moveCard(this.activeCardId, config.trello.workingListId);
          }
        } catch (cardErr: any) {
          console.warn(`[ShiftOrchestrator] Falha ao reutilizar card (${cardErr.message}). Criando novo card...`);
          const cardTitle = `Trabalho do Dia - ${today} - ${config.trello.userName || 'Luís Alves'}`;
          const newCard = await trelloCards.createCard(config.trello.workingListId, cardTitle, config.trello.memberId);
          this.activeCardId = newCard.id;
          this.activeCardName = cardTitle;
          this.cardDate = today;
          this.cardStartTime = Date.now();
          this.cardAccumulatedMinutes = 0;
        }
      } else {
        // 2. Verifica se há algum card já em "Trabalhando Agora" no Trello
        const existingInWorking = await trelloCards.getCardsInList(config.trello.workingListId);
        
        if (existingInWorking && existingInWorking.length > 0) {
          const first = existingInWorking[0];
          this.activeCardId = first.id;
          this.activeCardName = first.name;
          this.cardDate = today;
          this.cardStartTime = Date.now();
          this.cardAccumulatedMinutes = 0;

          // Limpa duplicatas concorrentes para a pasta do mês
          if (existingInWorking.length > 1 && config.trello.boardId) {
            const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
            for (let i = 1; i < existingInWorking.length; i++) {
              await trelloCards.moveCard(existingInWorking[i].id, monthlyList.id);
            }
          }
        } else {
          // 3. Cria o primeiro card do dia
          const cardTitle = `Trabalho do Dia - ${today} - ${config.trello.userName || 'Luís Alves'}`;
          const newCard = await trelloCards.createCard(
            config.trello.workingListId,
            cardTitle,
            config.trello.memberId
          );

          this.activeCardId = newCard.id;
          this.activeCardName = cardTitle;
          this.cardDate = today;
          this.cardStartTime = Date.now();
          this.cardAccumulatedMinutes = 0;
        }
      }

      this.state = 'WORKING';
      this.scheduleNextJitters();
      this.saveCurrentState();

      // Comentário configurável de início
      const startCfg = config.actionMessages?.start;
      if (startCfg?.enabled && startCfg.text && this.activeCardId) {
        await trelloCards.addComment(this.activeCardId, startCfg.text);
      }

      storage.addLog({
        type: 'SHIFT_STARTED',
        message: `Expediente iniciado e ativo no card "${this.activeCardName}".`,
        source: 'SYSTEM',
        details: { cardId: this.activeCardId, cardTitle: this.activeCardName },
      });

      await dispatcher.broadcastAlert(
        `🚀 - [EXPEDIENTE INICIADO] - Card: "${this.activeCardName}" ativo em "Trabalhando Agora". Rotação prevista em ~${config.rotationLimitMinutes || 230}min.`
      );

      this.broadcastStatus();
      return `Expediente iniciado no card: "${this.activeCardName}"`;
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
   * PAUSAR EXPEDIENTE
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

        const pauseCfg = config.actionMessages?.pause;
        for (const card of cardsInWorking) {
          if (pauseCfg?.enabled && pauseCfg.text) {
            await trelloCards.addComment(card.id, pauseCfg.text);
          }
          await trelloCards.moveCard(card.id, monthlyList.id);
        }
      } catch (err: any) {
        console.error('[ShiftOrchestrator] Erro ao mover card no pause:', err.message);
      }
    }

    this.saveCurrentState();

    storage.addLog({
      type: 'PAUSED',
      message: 'Expediente pausado temporariamente. Card movido para a coluna mensal.',
      source: 'SYSTEM',
    });

    await dispatcher.broadcastAlert(
      '⏸️ - [EXPEDIENTE PAUSADO] - Card movido para a pasta do mês para pausar a contagem da Nobe.'
    );

    this.broadcastStatus();
    return 'Expediente pausado e card movido para a coluna do mês.';
  }

  /**
   * RETOMAR EXPEDIENTE: Reutiliza o card vigente até ele expirar
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

    const today = formatTodayDate(new Date());
    const rotationLimit = config.rotationLimitMinutes || 230;

    // Se o card vigente expirou ou virou a data
    if (!this.activeCardId || this.cardDate !== today || this.cardAccumulatedMinutes >= rotationLimit) {
      const cardTitle = `Trabalho do Dia - ${today} - ${config.trello.userName || 'Luís Alves'}`;
      const newCard = await trelloCards.createCard(config.trello.workingListId, cardTitle, config.trello.memberId);

      this.activeCardId = newCard.id;
      this.activeCardName = cardTitle;
      this.cardDate = today;
      this.cardStartTime = Date.now();
      this.cardAccumulatedMinutes = 0;

      const resumeCfg = config.actionMessages?.resume;
      if (resumeCfg?.enabled && resumeCfg.text) {
        await trelloCards.addComment(newCard.id, resumeCfg.text);
      }

      storage.addLog({
        type: 'RESUMED',
        message: `Expediente retomado com novo card "${cardTitle}".`,
        source: 'SYSTEM',
      });
    } else {
      // Reutiliza o card vigente existente
      try {
        const card = await trelloCards.getCard(this.activeCardId);
        if (card.closed) {
          await trelloCards.unarchiveCard(this.activeCardId, config.trello.workingListId);
        } else {
          await trelloCards.moveCard(this.activeCardId, config.trello.workingListId);
        }
      } catch (err: any) {
        console.warn(`[ShiftOrchestrator] Falha ao mover card no resume (${err.message}). Criando novo card...`);
        const cardTitle = `Trabalho do Dia - ${today} - ${config.trello.userName || 'Luís Alves'}`;
        const newCard = await trelloCards.createCard(config.trello.workingListId, cardTitle, config.trello.memberId);
        this.activeCardId = newCard.id;
        this.activeCardName = cardTitle;
        this.cardDate = today;
        this.cardStartTime = Date.now();
        this.cardAccumulatedMinutes = 0;
      }

      const resumeCfg = config.actionMessages?.resume;
      if (resumeCfg?.enabled && resumeCfg.text && this.activeCardId) {
        await trelloCards.addComment(this.activeCardId, resumeCfg.text);
      }

      storage.addLog({
        type: 'RESUMED',
        message: `Expediente retomado. Card vigente "${this.activeCardName}" restaurado para Trabalhando Agora.`,
        source: 'SYSTEM',
      });
    }

    this.scheduleNextJitters();
    this.saveCurrentState();

    await dispatcher.broadcastAlert(
      `▶️ - [EXPEDIENTE RETOMADO] - Card "${this.activeCardName}" ativo em "Trabalhando Agora". Contagem de horas reativada.`
    );

    this.broadcastStatus();
    return 'Expediente retomado com sucesso.';
  }

  /**
   * INICIAR ALMOÇO
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

        const lunchCfg = config.actionMessages?.lunch;
        for (const card of cardsInWorking) {
          if (lunchCfg?.enabled && lunchCfg.text) {
            await trelloCards.addComment(card.id, lunchCfg.text);
          }
          await trelloCards.moveCard(card.id, monthlyList.id);
        }
      } catch (err: any) {
        console.error('[ShiftOrchestrator] Erro ao mover card no almoço:', err.message);
      }
    }

    this.saveCurrentState();

    storage.addLog({
      type: 'LUNCH_STARTED',
      message: 'Pausa para almoço iniciada. Card movido para a coluna mensal.',
      source: 'SYSTEM',
    });

    await dispatcher.broadcastAlert(
      '🍽️ - [PAUSA PARA ALMOÇO] - Card movido para a pasta do mês. Contagem congelada durante o almoço.'
    );

    this.broadcastStatus();
    return 'Almoço iniciado e card movido para a coluna do mês.';
  }

  /**
   * ENCERRAR EXPEDIENTE
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

        const endCfg = config.actionMessages?.end;
        for (const card of cardsInWorking) {
          if (endCfg?.enabled && endCfg.text) {
            await trelloCards.addComment(card.id, endCfg.text);
          }
          await trelloCards.moveCard(card.id, monthlyList.id);
        }
      } catch (err: any) {
        console.error('[ShiftOrchestrator] Erro ao mover card no encerramento:', err.message);
      }
    }

    storage.addLog({
      type: 'SHIFT_ENDED',
      message: `Expediente encerrado. Total de hoje: ${formatHMS(this.todayWorkedSeconds)}.`,
      source: 'SYSTEM',
    });

    await dispatcher.broadcastAlert(
      `🏁 - [EXPEDIENTE ENCERRADO] - Dia finalizado! Total trabalhado: ${formatHMS(this.todayWorkedSeconds)} | Ganhos de hoje: R$ ${((this.todayWorkedSeconds / 3600) * config.hourlyRate).toFixed(2)}`
    );

    this.state = 'IDLE';
    this.nextCommentTargetTime = null;
    this.nextRotationTargetTime = null;
    this.saveCurrentState();

    this.broadcastStatus();
    return 'Expediente encerrado com sucesso.';
  }

  /**
   * ROTAÇÃO DE CARD
   */
  public async rotateCard(): Promise<void> {
    if (this.isProcessingRotation || !this.activeCardId) return;
    this.isProcessingRotation = true;

    const storage = StorageService.getInstance();
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();
    const today = formatTodayDate(new Date());

    try {
      const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);

      const rotateCfg = config.actionMessages?.rotate;
      if (rotateCfg?.enabled && rotateCfg.text) {
        await trelloCards.addComment(this.activeCardId, rotateCfg.text);
      }
      await trelloCards.moveCard(this.activeCardId, monthlyList.id);

      const cardTitle = `Trabalho do Dia - ${today} - ${config.trello.userName || 'Luís Alves'}`;
      const newCard = await trelloCards.createCard(
        config.trello.workingListId,
        cardTitle,
        config.trello.memberId
      );

      this.activeCardId = newCard.id;
      this.activeCardName = cardTitle;
      this.cardDate = today;
      this.cardStartTime = Date.now();
      this.cardAccumulatedMinutes = 0;
      this.scheduleNextJitters();

      this.saveCurrentState();

      storage.addLog({
        type: 'CARD_ROTATED',
        message: `Card rotacionado. Card anterior movido para "${monthlyList.name}" e novo card aberto.`,
        source: 'SYSTEM',
        details: { newCardId: newCard.id, cardTitle },
      });

      await dispatcher.broadcastAlert(
        `🔄 - [ROTAÇÃO DE CARD] - Card anterior arquivado em "${monthlyList.name}". Novo card (*${cardTitle}*) aberto em "Trabalhando Agora".`
      );
    } catch (err: any) {
      console.error('[ShiftOrchestrator] Falha na rotação do card:', err.message);
      storage.addLog({
        type: 'ERROR',
        message: `Erro na rotação do card: ${err.message}`,
        source: 'SYSTEM',
      });
      await dispatcher.broadcastAlert(`🚨 - [ERRO NA ROTAÇÃO] - Falha ao rotacionar card no Trello: ${err.message}`);
    } finally {
      this.isProcessingRotation = false;
      this.broadcastStatus();
    }
  }

  /**
   * VIRADA DA MEIA-NOITE: Fecha o card de ontem e abre um com a data de hoje
   */
  public async handleMidnightDateShift(): Promise<void> {
    const today = formatTodayDate(new Date());
    if (this.cardDate && this.cardDate !== today && this.activeCardId) {
      console.log(`[ShiftOrchestrator] 🌙 Virada de dia detectada (Ontem: ${this.cardDate} -> Hoje: ${today}). Rotacionando card para a nova data...`);
      
      const storage = StorageService.getInstance();
      const trelloCards = TrelloCardsManager.getInstance();
      const trelloLists = TrelloListsManager.getInstance();
      const dispatcher = MessageDispatcher.getInstance();
      const config = storage.getConfig();

      try {
        const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
        await trelloCards.moveCard(this.activeCardId, monthlyList.id);

        let newCardName: string | null = null;
        let newCardId: string | null = null;

        if (this.state === 'WORKING') {
          const cardTitle = `Trabalho do Dia - ${today} - ${config.trello.userName || 'Luís Alves'}`;
          const newCard = await trelloCards.createCard(config.trello.workingListId, cardTitle, config.trello.memberId);
          newCardId = newCard.id;
          newCardName = cardTitle;
        }

        this.activeCardId = newCardId;
        this.activeCardName = newCardName;
        this.cardDate = today;
        this.cardStartTime = Date.now();
        this.cardAccumulatedMinutes = 0;
        this.todayWorkedMinutes = 0; // Novo dia, novo contador diário
        this.scheduleNextJitters();
        this.saveCurrentState();

        storage.addLog({
          type: 'MIDNIGHT_ROTATION',
          message: `Virada da meia-noite processada. Card anterior movido para "${monthlyList.name}" e novo dia ${today} iniciado.`,
          source: 'SYSTEM',
        });

        await dispatcher.broadcastAlert(
          `🌙 - [VIRADA DE DIA] - Data virada para ${today}! Card anterior arquivado e novo dia iniciado.`
        );
      } catch (err: any) {
        console.error('[ShiftOrchestrator] Erro na virada da meia-noite:', err.message);
      }
    }
  }

  /**
   * ENVIO DE COMENTÁRIO PERIÓDICO
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
      let source: CommentSource = 'TELEGRAM';

      const userReply = await dispatcher.askActivityQuestion(120000, () => {
        console.log('[ShiftOrchestrator] Timeout de 2 min atingido. Ativando fallback...');
      });

      if (userReply && userReply.trim()) {
        commentText = userReply.trim();
        source = 'TELEGRAM';
      } else {
        const resolved = agenda.resolveFallbackComment();
        commentText = resolved.text;
        source = resolved.source;

        const fallbackMsg = `⏱️ - [TEMPO ESGOTADO] - Limite de 2 min expirado. Para manter suas horas ativas na Nobe, comentei: "${commentText}"`;
        await dispatcher.broadcastAlert(fallbackMsg);
      }

      await trelloCards.addComment(this.activeCardId, commentText);
      this.scheduleNextJitters();
      this.saveCurrentState();

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
