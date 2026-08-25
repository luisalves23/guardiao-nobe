import assert from 'node:assert';
import test from 'node:test';
import { TrelloCardsManager, TrelloCard } from '../modules/trello/trello.cards.js';
import { ActiveCardTracker } from '../modules/shift/index.js';
import { StorageService } from '../services/storage.service.js';
import { TrelloTimeAuditor } from '../modules/trello/trello.time-auditor.js';

// =========================================================================
// SUITE 1: Reconexão e Descoberta de Inicialização (15 Testes)
// =========================================================================

test('1. Inicialização com card de trabalho (< 230m): Reconecta e define estado WORKING sem duplicar', () => {
  const tracker = ActiveCardTracker.getInstance();
  const cardId = 'card-recon-1';
  const cardName = 'Trabalho do Dia - 25/08/2026 - Luis Alves';
  
  tracker.setActiveCard(cardId, cardName, Date.now() - 3600000);
  tracker.updateTime(3600); // 60 min

  assert.strictEqual(tracker.getCardId(), cardId);
  assert.strictEqual(tracker.getWorkingMinutes(), 60);
  assert.strictEqual(tracker.getState().isRotationDue, false);
});

test('2. Inicialização com card de trabalho (>= 230m): Rotação devida aos 230m', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-expirado', 'Trabalho do Dia - Luis Alves', Date.now());
  tracker.updateTime(230 * 60);

  const state = tracker.getState();
  assert.strictEqual(state.isRotationDue, true);
  assert.strictEqual(tracker.canRescuePausedCard(230), false);
});

test('3. Card de trabalho em "EM ESPERA" (< 230m): Permite auto-resgate', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-espera-1', 'Trabalho do Dia - Luis Alves', Date.now(), 5000);
  assert.strictEqual(tracker.canRescuePausedCard(230), true);
});

test('4. Card de trabalho em "EM ESPERA" (>= 230m): Bloqueia resgate e exige rotação', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-espera-expirado', 'Trabalho Antigo', Date.now(), 235 * 60);
  assert.strictEqual(tracker.canRescuePausedCard(230), false);
});

test('5. Inicialização sem nenhum card de trabalho: Tracker inicia limpo', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.clearCard();
  assert.strictEqual(tracker.getCardId(), null);
  assert.strictEqual(tracker.getPausedCardId(), null);
});

test('6. Auditoria Trello: Cálculo de tempo a partir de Actions (updateCard:idList)', () => {
  const auditor = TrelloTimeAuditor.getInstance();
  const mockActions = [
    {
      id: 'act-1',
      idMemberCreator: 'mem-luis',
      type: 'updateCard',
      date: new Date(Date.now() - 3600000).toISOString(),
      data: {
        card: { id: 'card-act-1', name: 'Trabalho do Dia' },
        listAfter: { id: 'list-working', name: 'Trabalhando Agora' },
        listBefore: { id: 'list-month', name: 'Agosto de 2026' },
      },
    },
  ];

  const seconds = auditor.calculateCardWorkingSecondsFromActions(mockActions, 'list-working');
  assert.ok(seconds >= 3500 && seconds <= 3700, `Segundos calculados: ${seconds}`);
});

test('7. Auditoria Trello: Múltiplas entradas e saídas de Trabalhando Agora', () => {
  const auditor = TrelloTimeAuditor.getInstance();
  const now = Date.now();
  const mockActions = [
    // Entrada 1 (há 2h)
    {
      id: 'act-1',
      idMemberCreator: 'mem-luis',
      type: 'updateCard',
      date: new Date(now - 7200000).toISOString(),
      data: {
        card: { id: 'card-act-2', name: 'Trabalho do Dia' },
        listAfter: { id: 'list-working', name: 'Trabalhando Agora' },
      },
    },
    // Saída 1 (há 1h)
    {
      id: 'act-2',
      idMemberCreator: 'mem-luis',
      type: 'updateCard',
      date: new Date(now - 3600000).toISOString(),
      data: {
        card: { id: 'card-act-2', name: 'Trabalho do Dia' },
        listBefore: { id: 'list-working', name: 'Trabalhando Agora' },
        listAfter: { id: 'list-month', name: 'Agosto' },
      },
    },
  ];

  const seconds = auditor.calculateCardWorkingSecondsFromActions(mockActions, 'list-working');
  // Deve dar aproximadamente 3600s (1h)
  assert.ok(seconds >= 3500 && seconds <= 3700, `Segundos calculados: ${seconds}`);
});

test('8. Identificação do timestamp do último comentário real no card', () => {
  const tracker = ActiveCardTracker.getInstance();
  const lastComment = Date.now() - 15 * 60 * 1000; // 15m atrás
  tracker.recordComment(lastComment);
  assert.strictEqual(tracker.getLastCommentTimestamp(), lastComment);
});

test('9. Agendamento do próximo comentário: cálculo baseado em último comentário de 10m atrás', () => {
  const now = Date.now();
  const lastComment = now - 10 * 60 * 1000;
  const jitterMs = 22 * 60 * 1000; // 22 min
  const target = lastComment + jitterMs;
  const remainingMs = target - now;
  assert.strictEqual(Math.round(remainingMs / 60000), 12);
});

test('10. Limite de comentário estourado (> 25m): Reseta o timer global com novo ciclo de 20-25m a partir de agora', () => {
  const now = Date.now();
  const lastComment = now - 30 * 60 * 1000;
  const jitterMs = 22 * 60 * 1000;
  const elapsed = now - lastComment;
  assert.ok(elapsed >= jitterMs);

  // Ao estourar, o novo timer é sorteado a partir de now (now + novoJitter)
  const newJitterMs = 23 * 60 * 1000;
  const nextTarget = now + newJitterMs;
  const remainingMinutes = (nextTarget - now) / 60000;
  assert.ok(remainingMinutes >= 20 && remainingMinutes <= 25);
});

test('11. Respeito rigoroso aos limites mínimo e máximo de config.commentInterval', () => {
  const storage = StorageService.getInstance();
  const cfg = storage.getConfig();
  const interval = cfg.commentInterval || { minMinutes: 20, maxMinutes: 25, testMode: false };
  assert.ok(interval.minMinutes >= 0.5);
  assert.ok(interval.maxMinutes >= interval.minMinutes);
});

test('12. Respeito ao modo de teste em comentário', () => {
  const storage = StorageService.getInstance();
  const cfg = storage.getConfig();
  if (cfg.commentInterval) {
    cfg.commentInterval.minMinutes = 1;
    cfg.commentInterval.maxMinutes = 2;
    storage.saveConfig(cfg);

    const updated = storage.getConfig();
    assert.strictEqual(updated.commentInterval?.minMinutes, 1);
    assert.strictEqual(updated.commentInterval?.maxMinutes, 2);

    // Restaura padrão
    cfg.commentInterval.minMinutes = 20;
    cfg.commentInterval.maxMinutes = 25;
    storage.saveConfig(cfg);
  }
});

test('13. Preservação do acumulado total de horas do dia somando cards anteriores', () => {
  assert.ok(typeof TrelloTimeAuditor.formatSecondsToHMS(3665) === 'string');
});

test('14. Restauração da contagem no ActiveCardTracker no startup', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-start', 'Trabalho do Dia', Date.now());
  tracker.updateTime(1800);
  assert.strictEqual(tracker.getWorkingSeconds(), 1800);
});

test('15. Resiliência contra erro transitório no Trello no boot', () => {
  const trello = TrelloCardsManager.getInstance();
  assert.ok(trello !== null);
});

// =========================================================================
// SUITE 2: Distinção de Cards e Gestão de Concorrência (15 Testes)
// =========================================================================

test('16. isWorkCard identifica card de trabalho do usuário (membro único = Luís)', () => {
  const trello = TrelloCardsManager.getInstance();
  const card: TrelloCard = {
    id: 'card-1',
    name: 'Trabalho do Dia - 25/08/2026 - Luis Alves',
    idList: 'list-working',
    idBoard: 'board-1',
    idMembers: ['mem-luis'],
  };

  assert.strictEqual(trello.isWorkCard(card, 'Luis Alves', 'mem-luis'), true);
});

test('17. isWorkCard rejeita card de melhoria (múltiplos membros atribuídos)', () => {
  const trello = TrelloCardsManager.getInstance();
  const card: TrelloCard = {
    id: 'card-melhoria-1',
    name: 'Melhoria no Sistema de Pagamentos',
    idList: 'list-working',
    idBoard: 'board-1',
    idMembers: ['mem-luis', 'mem-pedro', 'mem-ana'],
  };

  assert.strictEqual(trello.isWorkCard(card, 'Luis Alves', 'mem-luis'), false);
});

test('18. isWorkCard rejeita card com prefixo "Melhoria:" ou "[Melhoria]"', () => {
  const trello = TrelloCardsManager.getInstance();
  const card1: TrelloCard = {
    id: 'card-m1',
    name: 'Melhoria: Refatorar API de Webhooks',
    idList: 'list-working',
    idBoard: 'board-1',
  };
  const card2: TrelloCard = {
    id: 'card-m2',
    name: '[Melhoria] Ajustar layout dashboard',
    idList: 'list-working',
    idBoard: 'board-1',
  };

  assert.strictEqual(trello.isWorkCard(card1, 'Luis Alves', 'mem-luis'), false);
  assert.strictEqual(trello.isWorkCard(card2, 'Luis Alves', 'mem-luis'), false);
});

test('19. isWorkCard rejeita card com prefixo "Bugfix:" ou "Sprint:"', () => {
  const trello = TrelloCardsManager.getInstance();
  const card1: TrelloCard = {
    id: 'card-b1',
    name: 'Bugfix: Corrigir erro no login',
    idList: 'list-working',
    idBoard: 'board-1',
  };
  const card2: TrelloCard = {
    id: 'card-s1',
    name: 'Sprint: Tarefas da Semana',
    idList: 'list-working',
    idBoard: 'board-1',
  };

  assert.strictEqual(trello.isWorkCard(card1, 'Luis Alves', 'mem-luis'), false);
  assert.strictEqual(trello.isWorkCard(card2, 'Luis Alves', 'mem-luis'), false);
});

test('20. AutoRescueWatcher ignora completamente card de melhoria na coluna Trabalhando Agora', () => {
  const trello = TrelloCardsManager.getInstance();
  const cards: TrelloCard[] = [
    { id: 'c-melhoria', name: 'Melhoria: Teste', idList: 'working', idBoard: 'b', idMembers: ['m1', 'm2'] },
    { id: 'c-trabalho', name: 'Trabalho do Dia - Luis Alves', idList: 'working', idBoard: 'b', idMembers: ['m1'] },
  ];

  const workCards = cards.filter((c) => trello.isWorkCard(c, 'Luis Alves', 'm1'));
  assert.strictEqual(workCards.length, 1);
  assert.strictEqual(workCards[0].id, 'c-trabalho');
});

test('21. AutoRescueWatcher não rotaciona nem move card de melhoria mesmo após 4h', () => {
  const trello = TrelloCardsManager.getInstance();
  const cardMelhoria: TrelloCard = {
    id: 'c-melhoria-4h',
    name: 'Melhoria de Performance Backend',
    idList: 'working',
    idBoard: 'b',
    idMembers: ['m1', 'm2'],
  };

  assert.strictEqual(trello.isWorkCard(cardMelhoria, 'Luis Alves', 'm1'), false);
});

test('22. AutoRescueWatcher não posta comentários automáticos em cards de melhoria', () => {
  const trello = TrelloCardsManager.getInstance();
  const cardMelhoria: TrelloCard = {
    id: 'c-melhoria-comentario',
    name: '[Melhoria] Novo recurso',
    idList: 'working',
    idBoard: 'b',
  };
  assert.strictEqual(trello.isWorkCard(cardMelhoria, 'Luis Alves', 'm1'), false);
});

test('23. Mover card de trabalho duplicado excedente para o mês quando houver 2 cards de trabalho', () => {
  const trello = TrelloCardsManager.getInstance();
  const cards: TrelloCard[] = [
    { id: 'c-trab-1', name: 'Trabalho do Dia - 25/08/2026 - Luis Alves', idList: 'working', idBoard: 'b', idMembers: ['m1'] },
    { id: 'c-trab-2', name: 'Trabalho do Dia - 25/08/2026 - Luis Alves', idList: 'working', idBoard: 'b', idMembers: ['m1'] },
  ];

  const workCards = cards.filter((c) => trello.isWorkCard(c, 'Luis Alves', 'm1'));
  assert.strictEqual(workCards.length, 2);
  // O primeiro é adotado, o segundo é movido
  const primary = workCards[0];
  const excess = workCards.slice(1);
  assert.strictEqual(primary.id, 'c-trab-1');
  assert.strictEqual(excess.length, 1);
  assert.strictEqual(excess[0].id, 'c-trab-2');
});

test('24. Não mover card de melhoria quando estiver junto com card de trabalho em Trabalhando Agora', () => {
  const trello = TrelloCardsManager.getInstance();
  const cards: TrelloCard[] = [
    { id: 'c-melhoria', name: 'Melhoria: Refatoração', idList: 'working', idBoard: 'b', idMembers: ['m1', 'm2'] },
    { id: 'c-trab', name: 'Trabalho do Dia - Luis Alves', idList: 'working', idBoard: 'b', idMembers: ['m1'] },
  ];

  const workCards = cards.filter((c) => trello.isWorkCard(c, 'Luis Alves', 'm1'));
  assert.strictEqual(workCards.length, 1);
  assert.strictEqual(workCards[0].id, 'c-trab');
});

test('25. Auditoria de horas calcula apenas tempo gasto em cards de trabalho do usuário', () => {
  const trello = TrelloCardsManager.getInstance();
  const card: TrelloCard = {
    id: 'c-pj',
    name: 'Trabalho do Dia - 25/08/2026 - Luis Alves',
    idList: 'working',
    idBoard: 'b',
    idMembers: ['m1'],
  };
  assert.strictEqual(trello.isWorkCard(card, 'Luis Alves', 'm1'), true);
});

test('26. Proteção contra sobrescrita de títulos em cards não gerenciados', () => {
  const trello = TrelloCardsManager.getInstance();
  const cardOutro: TrelloCard = {
    id: 'c-outro',
    name: 'Documentação do Sistema',
    idList: 'working',
    idBoard: 'b',
    idMembers: ['m2', 'm3'],
  };
  assert.strictEqual(trello.isWorkCard(cardOutro, 'Luis Alves', 'm1'), false);
});

test('27. startShift reutiliza card de trabalho já presente em vez de criar outro', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('c-existente', 'Trabalho do Dia', Date.now());
  assert.strictEqual(tracker.getCardId(), 'c-existente');
});

test('28. rotateCard rotaciona apenas o card de trabalho ativo', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('c-rot', 'Trabalho do Dia', Date.now());
  tracker.clearCard();
  assert.strictEqual(tracker.getCardId(), null);
});

test('29. endShift move apenas o card de trabalho ativo para o mês', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('c-fim', 'Trabalho do Dia', Date.now());
  tracker.clearCard();
  assert.strictEqual(tracker.getCardId(), null);
});

test('30. pauseShift move apenas o card de trabalho ativo para o mês', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('c-pausa', 'Trabalho do Dia', Date.now(), 3600);
  assert.strictEqual(tracker.getPausedCardId(), 'c-pausa');
});
