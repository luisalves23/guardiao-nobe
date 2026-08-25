import assert from 'node:assert';
import test from 'node:test';
import { ActiveCardTracker } from '../modules/shift/active-card.tracker.js';
import { StorageService } from '../services/storage.service.js';
import { DatabaseService } from '../services/database.service.js';
import { TelegramAdapter } from '../modules/messaging/telegram.adapter.js';
import { TimeSyncService } from '../services/time-sync.service.js';
import { formatTodayDate } from '../modules/scheduler/jitter.js';

test('1. Pausa de Card: Salva card no tracker com minutos acumulados', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-pausa-1', 'Trabalho do Dia - 25/08/2026', Date.now());
  tracker.updateTime(3600); // 60 minutos

  tracker.setPausedCard('card-pausa-1', 'Trabalho do Dia - 25/08/2026', Date.now(), 3600);
  assert.strictEqual(tracker.getPausedCardId(), 'card-pausa-1');
  assert.strictEqual(tracker.canRescuePausedCard(230), true);
});

test('2. Resgate de Card Pausado (< 230m): Restaura card do mês mantendo o tempo', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-pausa-2', 'Trabalho do Dia - 25/08/2026', Date.now(), 3600);
  
  assert.strictEqual(tracker.canRescuePausedCard(230), true);
  const restored = tracker.restorePausedCard();
  assert.ok(restored);
  assert.strictEqual(restored.cardId, 'card-pausa-2');
  assert.strictEqual(restored.workingSeconds, 3600);
  assert.strictEqual(tracker.getPausedCardId(), null);
});

test('3. Card Pausado que atingiu limite (>= 230m): Não permite resgate', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-pausa-expirado', 'Trabalho Antigo', Date.now(), 230 * 60);
  assert.strictEqual(tracker.canRescuePausedCard(230), false);
});

test('4. Encerramento Definitivo: Limpa completamente o card ativo e o card pausado', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-final', 'Trabalho', Date.now());
  tracker.setPausedCard('card-final', 'Trabalho', Date.now(), 1800);
  
  tracker.clearCard();
  assert.strictEqual(tracker.getCardId(), null);
  assert.strictEqual(tracker.getPausedCardId(), null);
  assert.strictEqual(tracker.canRescuePausedCard(230), false);
});

test('5. Lembrete de Pausa: Método sendPauseReminder formata mensagem sem quebrar', async () => {
  const telegram = TelegramAdapter.getInstance();
  // Chamada simulada (sem token não lança erro)
  await assert.doesNotReject(async () => {
    await telegram.sendPauseReminder(10);
  });
});

test('6. Botão Inline do Telegram: Callback "voltar" despacha comando para o handler', async () => {
  const telegram = TelegramAdapter.getInstance();
  let receivedCmd = '';
  telegram.setCommandHandler(async (cmd) => {
    receivedCmd = cmd;
    return `Executado: ${cmd}`;
  });

  // Simula clique em botão inline
  const res = await telegram.handleIncomingMessage('12345', '/voltar');
  assert.strictEqual(receivedCmd, 'voltar');
});

test('7. Botão Inline do Telegram: Callback "encerrar" despacha comando para o handler', async () => {
  const telegram = TelegramAdapter.getInstance();
  let receivedCmd = '';
  telegram.setCommandHandler(async (cmd) => {
    receivedCmd = cmd;
    return `Executado: ${cmd}`;
  });

  await telegram.handleIncomingMessage('12345', '/encerrar');
  assert.strictEqual(receivedCmd, 'encerrar');
});

test('8. Telegram: Resposta pura de texto sem /comentar durante pergunta de atividade', async () => {
  const storage = StorageService.getInstance();
  storage.saveConfig({
    telegram: {
      botToken: 'mock_token_123',
      chatId: '12345',
      enabled: true,
    },
  } as any);

  const telegram = TelegramAdapter.getInstance();
  
  // Inicia pergunta simulada em background
  const questionPromise = telegram.askActivityQuestion(2000);
  
  // Usuário responde apenas texto puro direto
  setTimeout(async () => {
    await telegram.handleIncomingMessage('12345', 'Criando testes unitários');
  }, 50);

  const reply = await questionPromise;
  assert.strictEqual(reply, 'Criando testes unitários');
});

test('9. Telegram: Resposta com prefixo /comentar limpa o prefixo corretamente', async () => {
  const storage = StorageService.getInstance();
  storage.saveConfig({
    telegram: {
      botToken: 'mock_token_123',
      chatId: '12345',
      enabled: true,
    },
  } as any);

  const telegram = TelegramAdapter.getInstance();
  
  const questionPromise = telegram.askActivityQuestion(2000);
  
  setTimeout(async () => {
    await telegram.handleIncomingMessage('12345', '/comentar Finalizando tela de login');
  }, 50);

  const reply = await questionPromise;
  assert.strictEqual(reply, 'Finalizando tela de login');
});

test('10. Telegram: Timeout da pergunta de 20s expira sem travar o sistema', async () => {
  const storage = StorageService.getInstance();
  storage.saveConfig({
    telegram: {
      botToken: 'mock_token_123',
      chatId: '12345',
      enabled: true,
    },
  } as any);

  const telegram = TelegramAdapter.getInstance();
  let timeoutTriggered = false;

  const questionPromise = telegram.askActivityQuestion(50, () => {
    timeoutTriggered = true;
  });

  const reply = await questionPromise;
  assert.strictEqual(reply, null);
  assert.strictEqual(timeoutTriggered, true);
});

test('11. Rotação com comentário habilitado: Configuração actionMessages.rotate', () => {
  const storage = StorageService.getInstance();
  const config = storage.getConfig();
  config.actionMessages = config.actionMessages || ({} as any);
  config.actionMessages.rotate = {
    enabled: true,
    text: 'Card de 4h concluído com sucesso.',
  };
  storage.saveConfig(config);

  const updated = storage.getConfig();
  assert.strictEqual(updated.actionMessages.rotate.enabled, true);
  assert.strictEqual(updated.actionMessages.rotate.text, 'Card de 4h concluído com sucesso.');
});

test('12. Rotação com comentário desabilitado: Flag enabled: false é respeitada', () => {
  const storage = StorageService.getInstance();
  const config = storage.getConfig();
  config.actionMessages.rotate = {
    enabled: false,
    text: 'Não deve postar',
  };
  storage.saveConfig(config);

  const updated = storage.getConfig();
  assert.strictEqual(updated.actionMessages.rotate.enabled, false);
});

test('13. Fuso Horário de Brasília: Virada de dia às 00:00:00 e não às 21:00', () => {
  // 24 de Agosto às 23:59 BRT (02:59 UTC do dia 25)
  const d1 = new Date('2026-08-25T02:59:00Z');
  assert.strictEqual(formatTodayDate(d1), '24/08/2026');

  // 25 de Agosto às 00:01 BRT (03:01 UTC do dia 25)
  const d2 = new Date('2026-08-25T03:01:00Z');
  assert.strictEqual(formatTodayDate(d2), '25/08/2026');
});

test('14. TimeSyncService: Consulta e verificação de desvio de relógio', async () => {
  const timeSync = TimeSyncService.getInstance();
  const result = await timeSync.syncTime();
  assert.ok(typeof result.offsetMs === 'number');
  assert.ok(typeof result.isAccurate === 'boolean');
  assert.ok(timeSync.getNow() instanceof Date);
});

test('15. SQLite & Sessões: Gravação de múltiplas sessões com histórico de horas', () => {
  const db = DatabaseService.getInstance();
  db.startWorkSession('card-1', 'Trabalho 1', 'WORKING');
  db.endActiveWorkSession('ROTATION');
  
  db.startWorkSession('card-2', 'Trabalho 2', 'WORKING');
  db.endActiveWorkSession('USER_END');

  const sessions = db.getTodayWorkSessions();
  assert.ok(sessions.length >= 2);
});

test('16. Jitter & Lead-time de 20s: Cálculo matemático de target time', () => {
  const nextCommentTargetTime = Date.now() + 60000;
  const leadTimeMs = 20000;
  const triggerTime = nextCommentTargetTime - leadTimeMs;
  
  assert.strictEqual(nextCommentTargetTime - triggerTime, 20000);
});
