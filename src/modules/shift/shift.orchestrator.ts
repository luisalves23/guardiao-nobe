import { StorageService } from '../../services/storage.service.js';
import { DatabaseService } from '../../services/database.service.js';
import { TrelloCardsManager, TrelloListsManager, TrelloTimeAuditor } from '../trello/index.js';
import { MessageDispatcher, TelegramAdapter } from '../messaging/index.js';
import { AgendaManager, formatTodayDate, formatHMS, getCommentJitterMs, getRotationJitterMs } from '../scheduler/index.js';
import { ActiveCardTracker } from './active-card.tracker.js';
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
  private lastCommentSource: string | null = null;
  private lastCommentText: string | null = null;

  private constructor() {
    this.restorePersistentState();
    MessageDispatcher.getInstance().setOnQuestionStatusChanged(() => this.broadcastStatus());
  }

  public static getInstance(): ShiftOrchestrator {
    if (!ShiftOrchestrator.instance) {
      ShiftOrchestrator.instance = new ShiftOrchestrator();
    }
    return ShiftOrchestrator.instance;
  }

  private restorePersistentState() {
    const saved = StorageService.getInstance().getShiftState();
    const db = DatabaseService.getInstance();
    const today = formatTodayDate(new Date());

    const activeSession = db.getActiveWorkSession();
    if (activeSession) {
      this.state = (activeSession.state as ShiftState) || 'WORKING';
      this.activeCardId = activeSession.card_id;
      this.activeCardName = activeSession.card_name;
      this.cardDate = today;
    }

    const dbSeconds = db.getTodayWorkedSeconds();
    if (dbSeconds > 0) {
      this.todayWorkedSeconds = dbSeconds;
      this.todayWorkedMinutes = dbSeconds / 60;
    }

    if (saved && saved.cardId && saved.cardDate === today) {
      this.activeCardId = this.activeCardId || saved.cardId;
      this.activeCardName = this.activeCardName || saved.cardName;
      this.cardDate = saved.cardDate;
      this.cardStartTime = saved.cardCreatedAt;
      this.cardAccumulatedMinutes = saved.accumulatedMinutes || 0;
      if (this.todayWorkedSeconds === 0) {
        this.todayWorkedMinutes = saved.accumulatedMinutes || 0;
        this.todayWorkedSeconds = (saved.accumulatedMinutes || 0) * 60;
      }
      ActiveCardTracker.getInstance().setActiveCard(this.activeCardId!, this.activeCardName!, this.cardStartTime || Date.now());
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

  /**
   * Sincroniza o tempo trabalhado milimetricamente através das Actions oficiais do Trello
   */
  public async syncTimeFromTrelloAudit(): Promise<void> {
    const storage = StorageService.getInstance();
    const config = storage.getConfig();
    if (!config.trello.boardId || !config.trello.workingListId) return;

    try {
      const auditor = TrelloTimeAuditor.getInstance();
      const daySummary = await auditor.calculateDailyWorkingTimeFromCards(
        config.trello.boardId,
        config.trello.workingListId,
        config.hourlyRate || 18.0,
        config.trello.userName || 'Luis Alves'
      );

      if (daySummary.totalSeconds > 0) {
        this.todayWorkedSeconds = Math.max(this.todayWorkedSeconds, daySummary.totalSeconds);
        this.todayWorkedMinutes = this.todayWorkedSeconds / 60;
      }

      // Sincroniza o rastreador global do card ativo
      const cardTracker = ActiveCardTracker.getInstance();
      const cardState = await cardTracker.syncWithTrello();

      if (this.activeCardId) {
        this.cardAccumulatedMinutes = cardState.workingMinutes;

        // Atualiza dinamicamente o tempo restante de rotação e busca o último comentário
        if (this.state === 'WORKING') {
          const rotationLimit = config.rotationLimitMinutes || 230;
          const remainingMinutes = Math.max(0.5, rotationLimit - this.cardAccumulatedMinutes);
          this.nextRotationTargetTime = Date.now() + (remainingMinutes * 60 * 1000);

          if (!this.lastCommentTime && cardState.lastCommentTimestamp) {
            this.lastCommentTime = cardState.lastCommentTimestamp;
            const elapsedSinceComment = Date.now() - this.lastCommentTime;
            const jitterMs = getCommentJitterMs();
            if (elapsedSinceComment >= jitterMs) {
              this.nextCommentTargetTime = Date.now() + 30000;
            } else {
              this.nextCommentTargetTime = this.lastCommentTime + jitterMs;
            }
          }
        }
      }
      this.saveCurrentState();
    } catch (err: any) {
      console.warn('[ShiftOrchestrator] Falha ao sincronizar auditoria Trello:', err.message);
    }
  }

  public getStatus(): LiveStatus {
    const config = StorageService.getInstance().getConfig();
    const telegram = TelegramAdapter.getInstance();
    const db = DatabaseService.getInstance();

    const dbWorkedSeconds = db.getTodayWorkedSeconds();
    const activeWorkedSeconds = Math.max(dbWorkedSeconds, this.todayWorkedSeconds);

    const dispatcher = MessageDispatcher.getInstance();
    return {
      state: this.state,
      activeCardId: this.activeCardId,
      activeCardName: this.activeCardName,
      cardStartTime: this.cardStartTime ? new Date(this.cardStartTime).toISOString() : null,
      lastCommentTime: this.lastCommentTime ? new Date(this.lastCommentTime).toISOString() : null,
      nextCommentTargetTime: this.state === 'WORKING' && this.nextCommentTargetTime ? new Date(this.nextCommentTargetTime).toISOString() : null,
      nextRotationTargetTime: this.state === 'WORKING' && this.nextRotationTargetTime ? new Date(this.nextRotationTargetTime).toISOString() : null,
      isWhatsAppConnected: telegram.isConfigured() || !!config.notificationPhone,
      isTrelloConnected: !!config.trello.apiKey && !!config.trello.token,
      todayMinutesWorked: Math.round((activeWorkedSeconds / 60) * 10) / 10,
      todaySecondsWorked: Math.floor(activeWorkedSeconds),
      todayFormattedTime: TrelloTimeAuditor.formatSecondsToHMS(activeWorkedSeconds),
      todayEarnings: Math.round((activeWorkedSeconds / 3600) * config.hourlyRate * 100) / 100,
      lastSyncTime: new Date().toISOString(),
      isQuestionPending: dispatcher.isQuestionPending(),
      questionDeadline: dispatcher.getQuestionDeadline(),
      lastCommentSource: this.lastCommentSource,
      lastCommentText: this.lastCommentText,
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

  public async scheduleNextJitters(): Promise<void> {
    const config = StorageService.getInstance().getConfig();
    const now = Date.now();
    const commentJitterMs = getCommentJitterMs();
    const rotationLimitMinutes = config.rotationLimitMinutes || 230;

    // 1. Rotação: Restante real a partir dos minutos acumulados no card
    const remainingRotationMinutes = Math.max(0.5, rotationLimitMinutes - this.cardAccumulatedMinutes);
    this.nextRotationTargetTime = now + (remainingRotationMinutes * 60 * 1000);

    // 2. Comentário: Restante real a partir do último comentário feito no card
    if (this.activeCardId && !this.lastCommentTime) {
      try {
        const lastComment = await TrelloCardsManager.getInstance().getLastComment(this.activeCardId);
        if (lastComment) {
          this.lastCommentTime = new Date(lastComment.date).getTime();
        }
      } catch (e) {
        // Ignora
      }
    }

    const baseCommentTime = this.lastCommentTime || this.cardStartTime || now;
    const elapsedSinceLastComment = now - baseCommentTime;

    if (elapsedSinceLastComment >= commentJitterMs && this.state === 'WORKING' && this.activeCardId) {
      // Limite estourado: posta comentário da lista imediatamente e reinicia o timer global
      const agenda = AgendaManager.getInstance();
      const rescueComment = agenda.getRescueComment();
      const dispatcher = MessageDispatcher.getInstance();

      try {
        console.log(`[ShiftOrchestrator] ⚡ Limite de tempo de comentário estourado (${(elapsedSinceLastComment / 60000).toFixed(1)}m > ${(commentJitterMs / 60000).toFixed(1)}m). Postando comentário da lista imediatamente...`);
        await TrelloCardsManager.getInstance().addComment(this.activeCardId, rescueComment);

        this.lastCommentTime = Date.now();
        ActiveCardTracker.getInstance().recordComment(this.lastCommentTime);

        StorageService.getInstance().addLog({
          type: 'COMMENT_SENT',
          message: `Limite de tempo de comentário excedido. Comentário padrão inserido no Trello: "${rescueComment}".`,
          source: 'FALLBACK_TEMPLATE',
          details: { cardId: this.activeCardId, commentText: rescueComment },
        });

        await dispatcher.broadcastAlert(
          `💬 - [COMENTÁRIO AUTOMÁTICO] - Limite de tempo excedido. Comentário da lista postado no Trello: "${rescueComment}".`
        );
      } catch (postErr: any) {
        console.error('[ShiftOrchestrator] Falha ao postar comentário imediato de fallback:', postErr.message);
      }

      // Reinicia o timer de comentários global a partir de agora
      const newJitterMs = getCommentJitterMs();
      this.nextCommentTargetTime = Date.now() + newJitterMs;
    } else {
      this.nextCommentTargetTime = baseCommentTime + commentJitterMs;
    }

    StorageService.getInstance().addLog({
      type: 'JITTER_CALCULATED',
      message: `Próximo comentário previsto para ${new Date(this.nextCommentTargetTime).toLocaleTimeString('pt-BR')} (restam ${((this.nextCommentTargetTime - now) / 60000).toFixed(1)}m). Rotação em ${new Date(this.nextRotationTargetTime).toLocaleTimeString('pt-BR')} (restam ${remainingRotationMinutes.toFixed(1)}m no card).`,
      source: 'SYSTEM',
      details: {
        nextCommentTime: new Date(this.nextCommentTargetTime).toISOString(),
        nextRotationTime: new Date(this.nextRotationTargetTime).toISOString(),
        cardAccumulatedMinutes: this.cardAccumulatedMinutes,
        remainingRotationMinutes,
      },
    });
  }

  public setAdoptedCard(cardId: string, cardName: string) {
    this.activeCardId = cardId;
    this.activeCardName = cardName;
    this.cardDate = formatTodayDate(new Date());
    if (!this.cardStartTime) this.cardStartTime = Date.now();
    this.state = 'WORKING';
    this.scheduleNextJitters().catch(err => console.error('[ShiftOrchestrator] Erro ao agendar jitter:', err.message));
    this.saveCurrentState();
    this.broadcastStatus();
  }

  public setRotatedCard(cardId: string, cardName: string) {
    this.activeCardId = cardId;
    this.activeCardName = cardName;
    this.cardDate = formatTodayDate(new Date());
    this.cardStartTime = Date.now();
    this.cardAccumulatedMinutes = 0;
    this.lastCommentTime = null;
    this.scheduleNextJitters().catch(err => console.error('[ShiftOrchestrator] Erro ao agendar jitter:', err.message));
    this.saveCurrentState();
    this.broadcastStatus();
  }

  public setRescued() {
    this.scheduleNextJitters().catch(err => console.error('[ShiftOrchestrator] Erro ao agendar jitter:', err.message));
    this.saveCurrentState();
    this.broadcastStatus();
  }

  /**
   * Reconexão e Descoberta Inteligente no Startup:
   * 1. Consulta cards na lista "Trabalhando Agora" no Trello.
   * 2. Filtra estritamente por Cards de Trabalho (ignora cards de melhoria/múltiplos membros).
   * 3. Audita o tempo real de permanência do card em "Trabalhando Agora" via Trello Actions.
   * 4. Se < 230m, adota o card, define state = 'WORKING', sincroniza tempo acumulado e agenda comentários baseado no último comentário real.
   * 5. Se >= 230m, move para o mês e cria novo card para continuar o trabalho restante do dia.
   * 6. Move quaisquer cards de trabalho duplicados excedentes para o mês.
   */
  public async autoDiscoverActiveCardOnStartup(): Promise<void> {
    const storage = StorageService.getInstance();
    const config = storage.getConfig();
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const auditor = TrelloTimeAuditor.getInstance();
    const today = formatTodayDate(new Date());

    if (!config.trello.boardId || !config.trello.workingListId) {
      return;
    }

    try {
      console.log('[ShiftOrchestrator] 🔍 Executando descoberta automática de cards no Trello...');
      const cardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);

      // Filtra estritamente apenas Cards de Trabalho do usuário (ignora cards de melhoria)
      const workCards = (cardsInWorking || []).filter((c) =>
        trelloCards.isWorkCard(c, config.trello.userName, config.trello.memberId)
      );

      if (workCards.length > 0) {
        const primaryCard = workCards[0];
        console.log(`[ShiftOrchestrator] ✅ Card de trabalho identificado em "Trabalhando Agora": "${primaryCard.name}" (ID: ${primaryCard.id})`);

        // Audita tempo gasto nas ações do Trello
        let cardSeconds = 0;
        try {
          const summary = await auditor.calculateCardWorkingSeconds(primaryCard.id, config.trello.workingListId);
          cardSeconds = summary.seconds;
        } catch {
          cardSeconds = this.cardAccumulatedMinutes * 60;
        }

        const cardMinutes = cardSeconds / 60;
        const rotationLimit = config.rotationLimitMinutes || 230;

        // Se houver cards de trabalho duplicados excedentes, move para a pasta do mês
        if (workCards.length > 1 && config.trello.boardId) {
          const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
          for (let i = 1; i < workCards.length; i++) {
            console.log(`[ShiftOrchestrator] 🧹 Movendo card de trabalho duplicado excedente "${workCards[i].name}" para a pasta do mês...`);
            await trelloCards.moveCard(workCards[i].id, monthlyList.id);
          }
        }

        if (cardMinutes < rotationLimit) {
          // Caso 1: Card ainda tem tempo de uso (< 230m) ➜ Reconecta e continua
          this.activeCardId = primaryCard.id;
          this.activeCardName = primaryCard.name;
          this.cardDate = today;
          this.cardStartTime = Date.now() - cardSeconds * 1000;
          this.cardAccumulatedMinutes = cardMinutes;
          this.state = 'WORKING';

          ActiveCardTracker.getInstance().setActiveCard(primaryCard.id, primaryCard.name, this.cardStartTime);
          ActiveCardTracker.getInstance().updateTime(cardSeconds);

          // Busca o último comentário real
          try {
            const lastComment = await trelloCards.getLastComment(primaryCard.id);
            if (lastComment) {
              this.lastCommentTime = new Date(lastComment.date).getTime();
              ActiveCardTracker.getInstance().recordComment(this.lastCommentTime);
            }
          } catch {
            // Ignora erro de rede eventual
          }

          await this.scheduleNextJitters();
          this.saveCurrentState();
          await this.syncTimeFromTrelloAudit();
          this.broadcastStatus();

          console.log(`[ShiftOrchestrator] 🚀 Reconexão concluída com sucesso no card "${primaryCard.name}" (${cardMinutes.toFixed(1)}m acumulados). Estado: WORKING`);
        } else {
          // Caso 2: Card já atingiu/passou de 230m ➜ Move para o mês e rotaciona para novo card
          console.log(`[ShiftOrchestrator] 🔄 Card "${primaryCard.name}" atingiu ${cardMinutes.toFixed(1)}m (>= ${rotationLimit}m). Rotacionando para novo card...`);
          const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
          await trelloCards.moveCard(primaryCard.id, monthlyList.id);

          const cardTitle = `Trabalho do Dia - ${today} - ${config.trello.userName || 'Luis Alves'}`;
          const newCard = await trelloCards.createCard(config.trello.workingListId, cardTitle, config.trello.memberId);

          this.activeCardId = newCard.id;
          this.activeCardName = cardTitle;
          this.cardDate = today;
          this.cardStartTime = Date.now();
          this.cardAccumulatedMinutes = 0;
          this.state = 'WORKING';

          ActiveCardTracker.getInstance().setActiveCard(newCard.id, cardTitle, Date.now());
          await this.scheduleNextJitters();
          this.saveCurrentState();
          await this.syncTimeFromTrelloAudit();
          this.broadcastStatus();
        }
      } else {
        console.log('[ShiftOrchestrator] Nenhum card de trabalho ativo encontrado em "Trabalhando Agora".');
      }
    } catch (err: any) {
      console.warn('[ShiftOrchestrator] Falha na descoberta automática de cards no Trello:', err.message);
    }
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
        // 2. Verifica se há algum card de trabalho já em "Trabalhando Agora" no Trello
        const allCardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);
        const workCards = (allCardsInWorking || []).filter((c) =>
          trelloCards.isWorkCard(c, config.trello.userName, config.trello.memberId)
        );

        if (workCards && workCards.length > 0) {
          const first = workCards[0];
          this.activeCardId = first.id;
          this.activeCardName = first.name;
          this.cardDate = today;
          this.cardStartTime = Date.now();
          this.cardAccumulatedMinutes = 0;

          // Limpa duplicatas de trabalho excedentes para a pasta do mês (não toca em cards de melhoria)
          if (workCards.length > 1 && config.trello.boardId) {
            const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
            for (let i = 1; i < workCards.length; i++) {
              await trelloCards.moveCard(workCards[i].id, monthlyList.id);
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
      DatabaseService.getInstance().startWorkSession(this.activeCardId, this.activeCardName, 'WORKING');
      DatabaseService.getInstance().logActivity('CONTROL', 'SHIFT_STARTED', `Expediente iniciado no card "${this.activeCardName}".`);

      // Comentário customizado de Início de Expediente
      const isStartCommentEnabled = config.actionMessages?.start?.enabled !== false;
      const startCommentText = config.actionMessages?.start?.text?.trim();
      if (isStartCommentEnabled && startCommentText && this.activeCardId) {
        try {
          await trelloCards.addComment(this.activeCardId, startCommentText);
          this.lastCommentTime = Date.now();
        } catch (cErr: any) {
          console.warn('[ShiftOrchestrator] Falha ao postar comentário de início:', cErr.message);
        }
      }

      await this.scheduleNextJitters();
      this.saveCurrentState();

      storage.addLog({
        type: 'SHIFT_STARTED',
        message: `Expediente iniciado e ativo no card "${this.activeCardName}".`,
        source: 'SYSTEM',
        details: { cardId: this.activeCardId, cardTitle: this.activeCardName },
      });

      await dispatcher.broadcastAlert(
        `🚀 - [EXPEDIENTE INICIADO] - Card: "${this.activeCardName}" ativo em "Trabalhando Agora". Rotação prevista em ~${config.rotationLimitMinutes || 230}min.`
      );

      TrelloTimeAuditor.getInstance().clearCache();
      await this.syncTimeFromTrelloAudit();
      this.broadcastStatus();
      return `Expediente iniciado no card: "${this.activeCardName}"`;
    } catch (err: any) {
      DatabaseService.getInstance().logError('SHIFT_ORCHESTRATOR', `Falha ao iniciar expediente: ${err.message}`, err.stack, { cardId: this.activeCardId });
      storage.addLog({
        type: 'ERROR',
        message: `Falha ao iniciar expediente: ${err.message}`,
        source: 'SYSTEM',
      });
      throw err;
    }
  }

  private pauseReminderInterval: NodeJS.Timeout | null = null;
  private pauseStartTime: number | null = null;

  private startPauseReminderTimer() {
    this.stopPauseReminderTimer();
    this.pauseStartTime = Date.now();
    this.pauseReminderInterval = setInterval(async () => {
      if (this.state === 'PAUSED' || this.state === 'LUNCH') {
        const minutes = Math.floor((Date.now() - (this.pauseStartTime || Date.now())) / 60000);
        if (minutes >= 5) {
          await TelegramAdapter.getInstance().sendPauseReminder(minutes);
        }
      } else {
        this.stopPauseReminderTimer();
      }
    }, 5 * 60 * 1000);
  }

  private stopPauseReminderTimer() {
    if (this.pauseReminderInterval) {
      clearInterval(this.pauseReminderInterval);
      this.pauseReminderInterval = null;
    }
    this.pauseStartTime = null;
  }

  /**
   * PAUSAR EXPEDIENTE
   */
  public async pauseShift(): Promise<string> {
    if (this.state !== 'WORKING') {
      return 'Expediente não está em andamento.';
    }

    this.state = 'PAUSED';
    this.nextCommentTargetTime = null;
    this.nextRotationTargetTime = null;
    DatabaseService.getInstance().endActiveWorkSession('USER_PAUSE');
    DatabaseService.getInstance().startWorkSession(this.activeCardId, this.activeCardName, 'PAUSED');
    DatabaseService.getInstance().logActivity('CONTROL', 'SHIFT_PAUSED', 'Expediente pausado pelo usuário.');

    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const storage = StorageService.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();
    const cardTracker = ActiveCardTracker.getInstance();

    if (this.activeCardId && this.activeCardName) {
      cardTracker.setPausedCard(
        this.activeCardId,
        this.activeCardName,
        this.cardStartTime || Date.now(),
        this.cardAccumulatedMinutes * 60
      );
    }

    if (config.trello.boardId && config.trello.workingListId) {
      try {
        // Comentário customizado de Pausa
        const isPauseCommentEnabled = config.actionMessages?.pause?.enabled === true;
        const pauseCommentText = config.actionMessages?.pause?.text?.trim();
        if (isPauseCommentEnabled && pauseCommentText && this.activeCardId) {
          try {
            await trelloCards.addComment(this.activeCardId, pauseCommentText);
          } catch (cErr: any) {
            console.warn('[ShiftOrchestrator] Falha ao postar comentário de pausa:', cErr.message);
          }
        }

        const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
        const cardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);

        for (const card of cardsInWorking) {
          await trelloCards.moveCard(card.id, monthlyList.id);
        }
      } catch (err: any) {
        DatabaseService.getInstance().logError('TRELLO', `Erro ao mover card no pause: ${err.message}`, err.stack);
        console.error('[ShiftOrchestrator] Erro ao mover card no pause:', err.message);
      }
    }

    this.startPauseReminderTimer();
    this.saveCurrentState();

    storage.addLog({
      type: 'PAUSED',
      message: 'Expediente pausado temporariamente. Card movido para a coluna mensal.',
      source: 'SYSTEM',
    });

    await dispatcher.broadcastAlert(
      '⏸️ - [EXPEDIENTE PAUSADO] - Card movido para a pasta do mês para pausar a contagem da Nobe.'
    );

    TrelloTimeAuditor.getInstance().clearCache();
    await this.syncTimeFromTrelloAudit();
    this.broadcastStatus();
    return 'Expediente pausado e card movido para a coluna do mês.';
  }

  /**
   * RETOMAR EXPEDIENTE: Resgata o card vigente do mês se tiver tempo útil (< limite)
   */
  public async resumeShift(): Promise<string> {
    if (this.state !== 'PAUSED' && this.state !== 'LUNCH') {
      return 'Expediente não estava pausado.';
    }

    this.stopPauseReminderTimer();
    this.state = 'WORKING';
    const trelloCards = TrelloCardsManager.getInstance();
    const storage = StorageService.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();
    const cardTracker = ActiveCardTracker.getInstance();

    const today = formatTodayDate(new Date());
    const rotationLimit = config.rotationLimitMinutes || 230;

    // 1. Tenta resgatar o card que estava em pausa se ainda tem tempo restante
    if (cardTracker.canRescuePausedCard(rotationLimit)) {
      const restored = cardTracker.restorePausedCard();
      if (restored) {
        this.activeCardId = restored.cardId;
        this.activeCardName = restored.cardName;
        this.cardDate = today;
        this.cardStartTime = restored.createdAt;
        this.cardAccumulatedMinutes = restored.workingSeconds / 60;

        try {
          const card = await trelloCards.getCard(this.activeCardId);
          if (card.closed) {
            await trelloCards.unarchiveCard(this.activeCardId, config.trello.workingListId);
          } else {
            await trelloCards.moveCard(this.activeCardId, config.trello.workingListId);
          }
        } catch (err: any) {
          console.warn(`[ShiftOrchestrator] Falha ao resgatar card (${err.message}). Criando novo card...`);
          const cardTitle = `Trabalho do Dia - ${today} - ${config.trello.userName || 'Luís Alves'}`;
          const newCard = await trelloCards.createCard(config.trello.workingListId, cardTitle, config.trello.memberId);
          this.activeCardId = newCard.id;
          this.activeCardName = cardTitle;
          this.cardDate = today;
          this.cardStartTime = Date.now();
          this.cardAccumulatedMinutes = 0;
          cardTracker.setActiveCard(newCard.id, cardTitle, this.cardStartTime);
        }

        storage.addLog({
          type: 'RESUMED',
          message: `Expediente retomado. Card vigente "${this.activeCardName}" (${this.cardAccumulatedMinutes.toFixed(1)}m) resgatado da coluna do mês para Trabalhando Agora.`,
          source: 'SYSTEM',
        });
      }
    } else {
      // 2. Se não há card pausado válido, cria um novo card
      const cardTitle = `Trabalho do Dia - ${today} - ${config.trello.userName || 'Luís Alves'}`;
      const newCard = await trelloCards.createCard(config.trello.workingListId, cardTitle, config.trello.memberId);

      this.activeCardId = newCard.id;
      this.activeCardName = cardTitle;
      this.cardDate = today;
      this.cardStartTime = Date.now();
      this.cardAccumulatedMinutes = 0;
      cardTracker.setActiveCard(newCard.id, cardTitle, this.cardStartTime);

      storage.addLog({
        type: 'RESUMED',
        message: `Expediente retomado com novo card "${cardTitle}".`,
        source: 'SYSTEM',
      });
    }

    await this.scheduleNextJitters();
    DatabaseService.getInstance().startWorkSession(this.activeCardId, this.activeCardName, 'WORKING');
    DatabaseService.getInstance().logActivity('CONTROL', 'SHIFT_RESUMED', `Expediente retomado no card "${this.activeCardName}".`);

    // Comentário customizado de Retomada de Expediente
    const isResumeCommentEnabled = config.actionMessages?.resume?.enabled !== false;
    const resumeCommentText = config.actionMessages?.resume?.text?.trim();
    if (isResumeCommentEnabled && resumeCommentText && this.activeCardId) {
      try {
        await trelloCards.addComment(this.activeCardId, resumeCommentText);
        this.lastCommentTime = Date.now();
      } catch (cErr: any) {
        console.warn('[ShiftOrchestrator] Falha ao postar comentário de retomada:', cErr.message);
      }
    }

    this.saveCurrentState();

    await dispatcher.broadcastAlert(
      `▶️ - [EXPEDIENTE RETOMADO] - Card "${this.activeCardName}" ativo em "Trabalhando Agora". Contagem de horas reativada.`
    );

    TrelloTimeAuditor.getInstance().clearCache();
    await this.syncTimeFromTrelloAudit();
    this.broadcastStatus();
    return 'Expediente retomado com sucesso.';
  }

  /**
   * INICIAR ALMOÇO
   */
  public async startLunch(): Promise<string> {
    this.state = 'LUNCH';
    this.nextCommentTargetTime = null;
    this.nextRotationTargetTime = null;
    DatabaseService.getInstance().endActiveWorkSession('USER_LUNCH');
    DatabaseService.getInstance().startWorkSession(this.activeCardId, this.activeCardName, 'LUNCH');
    DatabaseService.getInstance().logActivity('CONTROL', 'SHIFT_LUNCH', 'Pausa para almoço iniciada.');

    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const storage = StorageService.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();
    const cardTracker = ActiveCardTracker.getInstance();

    if (this.activeCardId && this.activeCardName) {
      cardTracker.setPausedCard(
        this.activeCardId,
        this.activeCardName,
        this.cardStartTime || Date.now(),
        this.cardAccumulatedMinutes * 60
      );
    }

    if (config.trello.boardId && config.trello.workingListId) {
      try {
        // Comentário customizado de Almoço
        const isLunchCommentEnabled = config.actionMessages?.lunch?.enabled !== false;
        const lunchCommentText = config.actionMessages?.lunch?.text?.trim();
        if (isLunchCommentEnabled && lunchCommentText && this.activeCardId) {
          try {
            await trelloCards.addComment(this.activeCardId, lunchCommentText);
          } catch (cErr: any) {
            console.warn('[ShiftOrchestrator] Falha ao postar comentário de almoço:', cErr.message);
          }
        }

        const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
        const cardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);

        for (const card of cardsInWorking) {
          await trelloCards.moveCard(card.id, monthlyList.id);
        }
      } catch (err: any) {
        DatabaseService.getInstance().logError('TRELLO', `Erro ao mover card no almoço: ${err.message}`, err.stack);
        console.error('[ShiftOrchestrator] Erro ao mover card no almoço:', err.message);
      }
    }

    this.startPauseReminderTimer();
    this.saveCurrentState();

    storage.addLog({
      type: 'LUNCH_STARTED',
      message: 'Pausa para almoço iniciada. Card movido para a coluna mensal.',
      source: 'SYSTEM',
    });

    await dispatcher.broadcastAlert(
      '🍽️ - [PAUSA PARA ALMOÇO] - Card movido para a pasta do mês. Contagem congelada durante o almoço.'
    );

    TrelloTimeAuditor.getInstance().clearCache();
    await this.syncTimeFromTrelloAudit();
    this.broadcastStatus();
    return 'Almoço iniciado e card movido para a coluna do mês.';
  }

  /**
   * ENCERRAR EXPEDIENTE
   */
  public async endShift(): Promise<string> {
    this.stopPauseReminderTimer();
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const storage = StorageService.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const config = storage.getConfig();

    if (config.trello.boardId && config.trello.workingListId) {
      try {
        // Comentário customizado de Encerramento
        const isEndCommentEnabled = config.actionMessages?.end?.enabled === true;
        const endCommentText = config.actionMessages?.end?.text?.trim();
        if (isEndCommentEnabled && endCommentText && this.activeCardId) {
          try {
            await trelloCards.addComment(this.activeCardId, endCommentText);
          } catch (cErr: any) {
            console.warn('[ShiftOrchestrator] Falha ao postar comentário de encerramento:', cErr.message);
          }
        }

        let targetListId = config.trello.waitListId;
        try {
          const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
          targetListId = monthlyList.id;
        } catch (mErr: any) {
          console.warn('[ShiftOrchestrator] Falha ao obter lista mensal, usando lista de espera como fallback:', mErr.message);
        }

        const cardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);
        for (const card of cardsInWorking) {
          await trelloCards.moveCard(card.id, targetListId);
        }

        // Verificação de segurança: garante que a lista de trabalho esteja 100% limpa
        const remainingInWorking = await trelloCards.getCardsInList(config.trello.workingListId);
        if (remainingInWorking.length > 0 && config.trello.waitListId) {
          for (const card of remainingInWorking) {
            await trelloCards.moveCard(card.id, config.trello.waitListId);
          }
        }
      } catch (err: any) {
        DatabaseService.getInstance().logError('TRELLO', `Erro ao mover card no encerramento: ${err.message}`, err.stack);
        console.error('[ShiftOrchestrator] Erro ao mover card no encerramento:', err.message);
      }
    }

    ActiveCardTracker.getInstance().clearCard();
    DatabaseService.getInstance().endActiveWorkSession('USER_END');
    DatabaseService.getInstance().logActivity('CONTROL', 'SHIFT_ENDED', 'Expediente finalizado pelo usuário.');

    TrelloTimeAuditor.getInstance().clearCache();
    await this.syncTimeFromTrelloAudit();

    storage.addLog({
      type: 'SHIFT_ENDED',
      message: `Expediente encerrado. Total de hoje: ${TrelloTimeAuditor.formatSecondsToHMS(this.todayWorkedSeconds)}.`,
      source: 'SYSTEM',
    });

    await dispatcher.broadcastAlert(
      `🏁 - [EXPEDIENTE ENCERRADO] - Dia finalizado! Total trabalhado: ${TrelloTimeAuditor.formatSecondsToHMS(this.todayWorkedSeconds)} | Ganhos de hoje: R$ ${((this.todayWorkedSeconds / 3600) * config.hourlyRate).toFixed(2)}`
    );

    this.state = 'IDLE';
    this.activeCardId = null;
    this.activeCardName = null;
    this.nextCommentTargetTime = null;
    this.nextRotationTargetTime = null;
    this.saveCurrentState();

    this.broadcastStatus();
    return 'Expediente encerrado com sucesso.';
  }

  /**
   * ROTAÇÃO DE CARD: Só posta comentário se estiver ativado nas configurações
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
      // 1. Posta comentário de rotação APENAS se estiver explicitamente habilitado nas configurações
      const isRotateCommentEnabled = config.actionMessages?.rotate?.enabled === true;
      const rotateCommentText = config.actionMessages?.rotate?.text?.trim();

      if (isRotateCommentEnabled && rotateCommentText && this.activeCardId) {
        try {
          await trelloCards.addComment(this.activeCardId, rotateCommentText);
        } catch (cErr: any) {
          console.warn('[ShiftOrchestrator] Falha ao postar comentário opcional de rotação:', cErr.message);
        }
      }

      // 2. Move o card anterior para a lista do mês
      const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
      await trelloCards.moveCard(this.activeCardId, monthlyList.id);

      // 3. Cria o novo card
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
      this.lastCommentTime = null;

      ActiveCardTracker.getInstance().setActiveCard(newCard.id, cardTitle, this.cardStartTime);
      await this.scheduleNextJitters();

      DatabaseService.getInstance().endActiveWorkSession('ROTATION');
      DatabaseService.getInstance().startWorkSession(newCard.id, cardTitle, 'WORKING');
      DatabaseService.getInstance().logActivity('TRELLO', 'CARD_ROTATED', `Card rotacionado para "${cardTitle}".`);

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
      DatabaseService.getInstance().logError('TRELLO', `Falha na rotação do card: ${err.message}`, err.stack);
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
        this.lastCommentTime = null;

        if (newCardId && newCardName) {
          ActiveCardTracker.getInstance().setActiveCard(newCardId, newCardName, this.cardStartTime);
        } else {
          ActiveCardTracker.getInstance().clearCard();
        }

        await this.scheduleNextJitters();
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

      this.lastCommentSource = source;
      this.lastCommentText = commentText;

      await trelloCards.addComment(this.activeCardId, commentText);
      this.lastCommentTime = Date.now();
      await this.scheduleNextJitters();
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
