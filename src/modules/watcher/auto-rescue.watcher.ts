import { TrelloCardsManager } from '../trello/trello.cards.js';
import { StorageService } from '../../services/storage.service.js';
import { MessageDispatcher } from '../messaging/dispatcher.js';
import { AgendaManager } from '../scheduler/agenda.manager.js';
import { formatTodayDate, getCommentJitterMs, getRotationJitterMs } from '../scheduler/jitter.js';

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
    const dispatcher = MessageDispatcher.getInstance();
    const agenda = AgendaManager.getInstance();

    if (!config.trello.boardId || !config.trello.workingListId) {
      return;
    }

    // 1. Adoção automática de card existente na coluna "Trabalhando Agora"
    if (!ctx.activeCardId) {
      try {
        const cards = await trelloCards.getCardsInList(config.trello.workingListId);
        if (cards && cards.length > 0) {
          const found = cards[0];
          ctx.onCardAdopted(found.id, found.name);
          storage.addLog({
            type: 'SHIFT_STARTED',
            message: `Card existente "${found.name}" detectado e adotado automaticamente em Trabalhando Agora.`,
            source: 'SYSTEM',
            details: { cardId: found.id },
          });
        }
      } catch {
        // Silêncio
      }
      return;
    }

    // 2. Se o expediente estiver em andamento, monitora o card ativo
    if (ctx.state === 'WORKING' && ctx.activeCardId) {
      try {
        const card = await trelloCards.getCard(ctx.activeCardId);

        // Caso A: Card movido para a coluna "EM ESPERA" ("A Presidência")
        if (config.trello.waitListId && card.idList === config.trello.waitListId) {
          console.warn('[AutoRescueWatcher] 🚨 Card em "EM ESPERA". Executando Auto-Resgate em 3s...');
          await trelloCards.moveCard(ctx.activeCardId, config.trello.workingListId);

          const rescueComment = agenda.getRescueComment();
          await trelloCards.addComment(ctx.activeCardId, rescueComment);

          ctx.onCardRescued(rescueComment);

          storage.addLog({
            type: 'AUTO_RESCUED',
            message: `Card resgatado de "EM ESPERA" e reativado em "Trabalhando Agora" com: "${rescueComment}"`,
            source: 'FALLBACK_TEMPLATE',
          });

          await dispatcher.broadcastAlert(
            `🚨 - [AUTO-RESGATE ATIVADO] - O robô "A Presidência" moveu seu card para "EM ESPERA". Restaurado para "Trabalhando Agora" em 3s e comentário postado: "${rescueComment}".`
          );
        }
        // Caso B: Card movido para outra pasta (ex: Pasta do Mês) durante o expediente
        else if (card.idList !== config.trello.workingListId) {
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

            await trelloCards.addComment(
              newCard.id,
              'Iniciando novo bloco de atividades.'
            );

            storage.addLog({
              type: 'CARD_ROTATED',
              message: `Card anterior completou limite de tempo. Novo card "${cardTitle}" aberto.`,
              source: 'SYSTEM',
              details: { newCardId: newCard.id, cardTitle },
            });

            await dispatcher.broadcastAlert(
              `🔄 - [ROTAÇÃO DE CARD] - Card anterior arquivado. Novo card (*${cardTitle}*) aberto em "Trabalhando Agora" para manter suas horas ativas!`
            );
          } else {
            console.log('[AutoRescueWatcher] Card com tempo restante. Restaurando para Trabalhando Agora...');
            await trelloCards.moveCard(ctx.activeCardId, config.trello.workingListId);

            const resumeComment = 'Retomando as tarefas.';
            await trelloCards.addComment(ctx.activeCardId, resumeComment);

            ctx.onCardRescued(resumeComment);

            storage.addLog({
              type: 'RESUMED',
              message: 'Card restaurado para Trabalhando Agora (tempo restante disponível).',
              source: 'SYSTEM',
            });

            await dispatcher.broadcastAlert(
              `⚠️ - [CARD RESTAURADO] - Card detectado fora da coluna de trabalho durante o expediente. Restaurado para "Trabalhando Agora" com tempo restante ativo!`
            );
          }
        }
      } catch {
        // Tratamento de erro suave
      }
    }
  }
}
