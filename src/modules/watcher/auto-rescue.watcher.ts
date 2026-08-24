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

    try {
      // 1. Busca os cards abertos em "Trabalhando Agora" no Trello
      const cardsInWorking = await trelloCards.getCardsInList(config.trello.workingListId);

      // CENÁRIO 1: Existe pelo menos 1 card aberto na coluna "Trabalhando Agora"
      if (cardsInWorking && cardsInWorking.length > 0) {
        const topCard = cardsInWorking[0];

        // Se o sistema estava em IDLE ou PAUSED, sincroniza e ativa o expediente imediatamente
        if (ctx.state === 'IDLE') {
          console.log(`[AutoRescueWatcher] ⚡ Card aberto "${topCard.name}" detectado em Trabalhando Agora. Ativando expediente...`);
          ctx.onCardAdopted(topCard.id, topCard.name);
          storage.addLog({
            type: 'SHIFT_STARTED',
            message: `Card aberto "${topCard.name}" detectado em Trabalhando Agora. Expediente sincronizado e ativado.`,
            source: 'SYSTEM',
            details: { cardId: topCard.id, cardTitle: topCard.name },
          });

          await dispatcher.broadcastAlert(
            `🚀 - [SINCRONIZAÇÃO AUTOMÁTICA] - Card "${topCard.name}" detectado aberto no Trello. Expediente ativado e contagem iniciada!`
          );
        } else if (ctx.activeCardId !== topCard.id) {
          // Adota o ID do card atual se mudou
          ctx.onCardAdopted(topCard.id, topCard.name);
        }

        // Remove eventuais cards duplicados adicionais para a pasta do mês
        if (cardsInWorking.length > 1 && config.trello.boardId) {
          const monthlyList = await trelloLists.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
          for (let i = 1; i < cardsInWorking.length; i++) {
            await trelloCards.moveCard(cardsInWorking[i].id, monthlyList.id);
          }
        }
        return;
      }

      // CENÁRIO 2: A coluna "Trabalhando Agora" está vazia, mas o sistema está no estado WORKING
      if (ctx.state === 'WORKING') {
        if (ctx.activeCardId) {
          try {
            const card = await trelloCards.getCard(ctx.activeCardId);

            // Caso 2.1: O card foi arquivado
            if (card.closed) {
              console.warn('[AutoRescueWatcher] 🚨 Card arquivado detectado! Desarquivando em 3s...');
              await trelloCards.unarchiveCard(ctx.activeCardId, config.trello.workingListId);

              const resumeComment = 'Retomando as tarefas.';
              await trelloCards.addComment(ctx.activeCardId, resumeComment);
              ctx.onCardRescued(resumeComment);

              storage.addLog({
                type: 'AUTO_RESCUED',
                message: `Card "${card.name}" estava arquivado. Desarquivado e restaurado em Trabalhando Agora.`,
                source: 'SYSTEM',
              });

              await dispatcher.broadcastAlert(
                `🚨 - [CARD DESARQUIVADO] - O card havia sido arquivado! O Guardião desarquivou e restaurou para "Trabalhando Agora" em 3s.`
              );
              return;
            }

            // Caso 2.2: O card foi movido para "EM ESPERA" ("A Presidência")
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
                `🚨 - [AUTO-RESGATE ATIVADO] - O robô "A Presidência" moveu seu card para "EM ESPERA". Restaurado para "Trabalhando Agora" em 3s e comentário postado.`
              );
              return;
            }

            // Caso 2.3: O card foi movido para a Pasta do Mês ou outra coluna
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
                await trelloCards.addComment(newCard.id, 'Iniciando novo bloco de atividades.');

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
                  `⚠️ - [CARD RESTAURADO] - Card detectado fora da coluna de trabalho durante o expediente. Restaurado para "Trabalhando Agora"!`
                );
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
      }
    } catch (err: any) {
      console.error('[AutoRescueWatcher] Erro no ciclo de checagem:', err.message);
    }
  }
}
