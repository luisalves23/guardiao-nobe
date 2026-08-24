import { TrelloCardsManager } from '../trello/trello.cards.js';
import { TrelloListsManager } from '../trello/trello.lists.js';
import { StorageService } from '../../services/storage.service.js';
import { MessageDispatcher } from '../messaging/dispatcher.js';
import { AgendaManager } from '../scheduler/agenda.manager.js';
import { formatTodayDate } from '../scheduler/jitter.js';

export interface WatcherContext {
  state: string;
  activeCardId: string | null;
  activeCardName: string | null;
  cardStartTime: number | null;
  onCardAdopted: (cardId: string, cardName: string) => void;
  onCardRotated: (newCardId: string, newCardTitle: string) => void;
  onCardRescued: (comment: string) => void;
}

export class AutoRescueWatcher {
  private static instance: AutoRescueWatcher;
  private lastRescueCommentTime: number = 0;

  private constructor() {}

  public static getInstance(): AutoRescueWatcher {
    if (!AutoRescueWatcher.instance) {
      AutoRescueWatcher.instance = new AutoRescueWatcher();
    }
    return AutoRescueWatcher.instance;
  }

  public async check(ctx: WatcherContext): Promise<void> {
    const storage = StorageService.getInstance();
    const config = storage.getConfig();
    const trelloCards = TrelloCardsManager.getInstance();
    const trelloLists = TrelloListsManager.getInstance();
    const dispatcher = MessageDispatcher.getInstance();
    const agenda = AgendaManager.getInstance();

    if (!config.trello.boardId || !config.trello.workingListId) {
      return;
    }

    // Regra Fundamental: Se o usuário estiver em PAUSED, LUNCH ou IDLE, o Watcher NÃO deve forçar trabalho nem mover cards
    if (ctx.state !== 'WORKING') {
      return;
    }

    try {
      // 1. Busca os cards abertos em "Trabalhando Agora" no Trello
      const cardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);

      // CENÁRIO 1: Existe pelo menos 1 card aberto na coluna "Trabalhando Agora"
      if (cardsInWorking && cardsInWorking.length > 0) {
        const topCard = cardsInWorking[0];

        // Sincroniza o ID do card ativo caso seja diferente
        if (ctx.activeCardId !== topCard.id) {
          ctx.onCardAdopted(topCard.id, topCard.name);
        }

        // Se houver mais de 1 card concorrente em "Trabalhando Agora", move os excedentes para a pasta do mês
        if (cardsInWorking.length > 1 && config.trello.boardId) {
          const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
          for (let i = 1; i < cardsInWorking.length; i++) {
            console.log(`[AutoRescueWatcher] Movendo card concorrente excedente "${cardsInWorking[i].name}" para a pasta do mês...`);
            await trelloCards.moveCard(cardsInWorking[i].id, monthlyList.id);
          }
        }
        return;
      }

      // CENÁRIO 2: O sistema está no estado WORKING, mas não há cards na coluna "Trabalhando Agora"
      if (ctx.activeCardId) {
        try {
          const card = await trelloCards.getCard(ctx.activeCardId);

          // Caso 2.1: Card foi arquivado
          if (card.closed) {
            console.warn('[AutoRescueWatcher] 🚨 Card arquivado detectado! Desarquivando em 3s...');
            await trelloCards.unarchiveCard(ctx.activeCardId, config.trello.workingListId);

            storage.addLog({
              type: 'AUTO_RESCUED',
              message: `Card "${card.name}" estava arquivado. Desarquivado e restaurado em Trabalhando Agora.`,
              source: 'SYSTEM',
            });

            await dispatcher.broadcastAlert(
              `🚨 - [CARD DESARQUIVADO] - O card havia sido arquivado. O Guardião desarquivou e restaurou para "Trabalhando Agora" para manter suas horas seguras!`
            );
            return;
          }

          // Caso 2.2: Card movido para "EM ESPERA" ("A Presidência")
          if (config.trello.waitListId && card.idList === config.trello.waitListId) {
            console.warn('[AutoRescueWatcher] 🚨 Card em "EM ESPERA". Executando Auto-Resgate em 3s...');
            await trelloCards.moveCard(ctx.activeCardId, config.trello.workingListId);

            // Comentário com cooldown de 5 minutos para evitar flood
            const now = Date.now();
            if (now - this.lastRescueCommentTime > 5 * 60 * 1000) {
              this.lastRescueCommentTime = now;
              const rescueComment = agenda.getRescueComment();
              await trelloCards.addComment(ctx.activeCardId, rescueComment);
              ctx.onCardRescued(rescueComment);
            }

            storage.addLog({
              type: 'AUTO_RESCUED',
              message: `Card resgatado de "EM ESPERA" e reativado em "Trabalhando Agora".`,
              source: 'FALLBACK_TEMPLATE',
            });

            await dispatcher.broadcastAlert(
              `🚨 - [AUTO-RESGATE ATIVADO] - O robô "A Presidência" moveu seu card para "EM ESPERA". Restaurado para "Trabalhando Agora" em 3s.`
            );
            return;
          }

          // Caso 2.3: Card movido para outra pasta (ex: Pasta do Mês) durante o expediente WORKING
          if (card.idList !== config.trello.workingListId) {
            const now = Date.now();
            const cardAgeMinutes = ctx.cardStartTime ? (now - ctx.cardStartTime) / (1000 * 60) : 0;
            const rotationLimitMinutes = config.rotationLimitMinutes || 230;

            if (cardAgeMinutes >= rotationLimitMinutes) {
              console.log('[AutoRescueWatcher] Card completou tempo de rotação. Criando novo card em Trabalhando Agora...');
              const dateFormatted = formatTodayDate(new Date());
              const cardTitle = `Trabalho do Dia - ${dateFormatted} - ${config.trello.userName || 'Luís Alves'}`;

              const newCard = await trelloCards.createCard(
                config.trello.workingListId,
                cardTitle,
                config.trello.memberId
              );

              ctx.onCardRotated(newCard.id, cardTitle);

              storage.addLog({
                type: 'CARD_ROTATED',
                message: `Card anterior completou limite de tempo. Novo card "${cardTitle}" aberto.`,
                source: 'SYSTEM',
                details: { newCardId: newCard.id, cardTitle },
              });

              await dispatcher.broadcastAlert(
                `🔄 - [ROTAÇÃO DE CARD] - Card anterior arquivado. Novo card (*${cardTitle}*) aberto em "Trabalhando Agora"!`
              );
            } else {
              console.log('[AutoRescueWatcher] Card com tempo restante. Restaurando para Trabalhando Agora sem spam...');
              await trelloCards.moveCard(ctx.activeCardId, config.trello.workingListId);

              storage.addLog({
                type: 'RESUMED',
                message: 'Card restaurado para Trabalhando Agora (tempo restante disponível).',
                source: 'SYSTEM',
              });
            }
            return;
          }
        } catch {
          // Se o getCard falhou (ex: card deletado permanentemente)
          const dateFormatted = formatTodayDate(new Date());
          const cardTitle = `Trabalho do Dia - ${dateFormatted} - ${config.trello.userName || 'Luís Alves'}`;
          const newCard = await trelloCards.createCard(
            config.trello.workingListId,
            cardTitle,
            config.trello.memberId
          );
          ctx.onCardRotated(newCard.id, cardTitle);
        }
      }
    } catch (err: any) {
      console.error('[AutoRescueWatcher] Erro no ciclo de checagem:', err.message);
    }
  }
}
