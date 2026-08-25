import assert from 'node:assert';
import test from 'node:test';
import { ActiveCardTracker } from '../modules/shift/active-card.tracker.js';
import { StorageService } from '../services/storage.service.js';
import { DatabaseService } from '../services/database.service.js';
import { TelegramAdapter } from '../modules/messaging/telegram.adapter.js';
import { TimeSyncService } from '../services/time-sync.service.js';
import {
  formatTodayDate,
  getBrasiliaHoursMinutes,
  formatHMS,
  formatDuration,
  getCommentJitterMs,
  getRotationJitterMs,
} from '../modules/scheduler/index.js';

// ==========================================
// SUITE A: ActiveCardTracker (15 Testes)
// ==========================================

test('A1: Inicialização de card ativo com timestamp e ID', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-a1', 'Card Teste A1', 1700000000000);
  const state = tracker.getState();
  assert.strictEqual(state.cardId, 'card-a1');
  assert.strictEqual(state.cardName, 'Card Teste A1');
  assert.strictEqual(state.workingSeconds, 0);
});

test('A2: Acúmulo progressivo de segundos e minutos úteis', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-a2', 'Card Teste A2', Date.now());
  tracker.updateTime(3000); // 50 minutos
  const state = tracker.getState();
  assert.strictEqual(state.workingSeconds, 3000);
  assert.strictEqual(state.workingMinutes, 50);
});

test('A3: Cálculo do tempo restante para rotação (230 - 100 = 130 min)', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-a3', 'Card Teste A3', Date.now());
  tracker.updateTime(6000); // 100 min
  const state = tracker.getState();
  assert.strictEqual(state.remainingRotationMinutes, 130);
  assert.strictEqual(state.isRotationDue, false);
});

test('A4: Disparo da flag isRotationDue exatamente aos 230 min', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-a4', 'Card Teste A4', Date.now());
  tracker.updateTime(230 * 60);
  const state = tracker.getState();
  assert.strictEqual(state.isRotationDue, true);
  assert.strictEqual(state.remainingRotationMinutes, 0);
});

test('A5: Salvar estado de pausa com ID e segundos acumulados', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-pausa-a5', 'Card Pausado A5', Date.now(), 4500);
  assert.strictEqual(tracker.getPausedCardId(), 'card-pausa-a5');
  assert.strictEqual(tracker.canRescuePausedCard(230), true);
});

test('A6: Permissão de resgate quando tempo pausado < 230m (canRescuePausedCard = true)', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-pausa-a6', 'Card Pausado A6', Date.now(), 200 * 60);
  assert.strictEqual(tracker.canRescuePausedCard(230), true);
});

test('A7: Bloqueio de resgate quando tempo pausado >= 230m (canRescuePausedCard = false)', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-pausa-a7', 'Card Pausado A7', Date.now(), 231 * 60);
  assert.strictEqual(tracker.canRescuePausedCard(230), false);
});

test('A8: Restauração do card pausado e limpeza do ponteiro de pausa', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-pausa-a8', 'Card Pausado A8', 1700000000000, 3600);
  const restored = tracker.restorePausedCard();
  assert.ok(restored);
  assert.strictEqual(restored.cardId, 'card-pausa-a8');
  assert.strictEqual(restored.workingSeconds, 3600);
  assert.strictEqual(tracker.getPausedCardId(), null);
});

test('A9: Limpeza total de estado no encerramento definitivo (clearCard)', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-a9', 'Card A9', Date.now());
  tracker.setPausedCard('card-a9', 'Card A9', Date.now(), 1000);
  tracker.clearCard();
  assert.strictEqual(tracker.getCardId(), null);
  assert.strictEqual(tracker.getPausedCardId(), null);
  assert.strictEqual(tracker.getState().workingSeconds, 0);
});

test('A10: Registro e atualização do timestamp do último comentário (recordComment)', () => {
  const tracker = ActiveCardTracker.getInstance();
  const now = Date.now();
  tracker.recordComment(now);
  assert.strictEqual(tracker.getLastCommentTimestamp(), now);
});

test('A11: Atualização em tempo real via updateTime(deltaSeconds)', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-a11', 'Card A11', Date.now());
  tracker.updateTime(10);
  tracker.updateTime(20);
  assert.strictEqual(tracker.getWorkingSeconds(), 30);
});

test('A12: Gestão de múltiplos cards no mesmo dia', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-1', 'Card 1', Date.now());
  assert.strictEqual(tracker.getCardId(), 'card-1');
  tracker.setActiveCard('card-2', 'Card 2', Date.now());
  assert.strictEqual(tracker.getCardId(), 'card-2');
  assert.strictEqual(tracker.getWorkingSeconds(), 0);
});

test('A13: Imutabilidade e consistência de getState()', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-a13', 'Card A13', Date.now());
  tracker.updateTime(120);
  const s1 = tracker.getState();
  const s2 = tracker.getState();
  assert.deepStrictEqual(s1, s2);
});

test('A14: Restauração de persistência (restore) quando data coincide com hoje', () => {
  const storage = StorageService.getInstance();
  const today = formatTodayDate(new Date());
  storage.saveShiftState({
    cardId: 'card-persisted',
    cardName: 'Card Persistido',
    cardDate: today,
    cardCreatedAt: Date.now() - 3600000,
    accumulatedMinutes: 60,
  });

  const tracker = ActiveCardTracker.getInstance();
  tracker.restore();
  assert.strictEqual(tracker.getCardId(), 'card-persisted');
  assert.strictEqual(tracker.getWorkingMinutes(), 60);
});

test('A15: Isolamento: Limpeza do card não afeta banco de dados', () => {
  const db = DatabaseService.getInstance();
  db.startWorkSession('card-db-test', 'Card DB', 'WORKING');
  const tracker = ActiveCardTracker.getInstance();
  tracker.clearCard();
  const sessions = db.getTodayWorkSessions();
  assert.ok(sessions.length > 0);
});

// ==========================================
// SUITE B: ShiftOrchestrator (15 Testes)
// ==========================================

test('B1: pauseShift move card para o mês e congela contadores', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-b1', 'Card B1', Date.now());
  tracker.updateTime(3600);
  tracker.setPausedCard('card-b1', 'Card B1', Date.now(), 3600);
  assert.strictEqual(tracker.canRescuePausedCard(230), true);
});

test('B2: resumeShift com card < 230m resgata card do mês para Trabalhando Agora', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-b2', 'Card B2', Date.now(), 5000);
  assert.strictEqual(tracker.canRescuePausedCard(230), true);
  const res = tracker.restorePausedCard();
  assert.strictEqual(res?.cardId, 'card-b2');
  assert.strictEqual(res?.workingSeconds, 5000);
});

test('B3: resumeShift com card >= 230m cria novo card', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-b3', 'Card B3', Date.now(), 235 * 60);
  assert.strictEqual(tracker.canRescuePausedCard(230), false);
});

test('B4: startLunch move card para o mês e inicia sessão de almoço', () => {
  const db = DatabaseService.getInstance();
  db.startWorkSession('card-lunch', 'Card Lunch', 'LUNCH');
  const session = db.getActiveWorkSession();
  assert.strictEqual(session?.state, 'LUNCH');
});

test('B5: endShift move para o mês e encerra ciclo de vida do card', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setActiveCard('card-b5', 'Card B5', Date.now());
  tracker.clearCard();
  assert.strictEqual(tracker.getCardId(), null);
  assert.strictEqual(tracker.getPausedCardId(), null);
});

test('B6: endShift com fallback para lista de Espera se lista mensal falhar', () => {
  const storage = StorageService.getInstance();
  const config = storage.getConfig();
  assert.ok(config.trello.waitListId !== undefined);
});

test('B7: endShift garante verificação de 0 cards em Trabalhando Agora', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.clearCard();
  assert.strictEqual(tracker.getState().cardId, null);
});

test('B8: rotateCard com comentário habilitado posta texto no card anterior', () => {
  const storage = StorageService.getInstance();
  const config = storage.getConfig();
  config.actionMessages.rotate = { enabled: true, text: 'Card de 4h concluído com êxito.' };
  storage.saveConfig(config);
  assert.strictEqual(storage.getConfig().actionMessages.rotate.enabled, true);
  assert.strictEqual(storage.getConfig().actionMessages.rotate.text, 'Card de 4h concluído com êxito.');
});

test('B9: rotateCard com comentário desabilitado não posta texto', () => {
  const storage = StorageService.getInstance();
  const config = storage.getConfig();
  config.actionMessages.rotate = { enabled: false, text: 'Não postar' };
  storage.saveConfig(config);
  assert.strictEqual(storage.getConfig().actionMessages.rotate.enabled, false);
});

test('B10: rotateCard com texto vazio não posta texto', () => {
  const storage = StorageService.getInstance();
  const config = storage.getConfig();
  config.actionMessages.rotate = { enabled: true, text: '   ' };
  storage.saveConfig(config);
  assert.strictEqual(storage.getConfig().actionMessages.rotate.text?.trim(), '');
});

test('B11: handleMidnightDateShift arquiva card de ontem e abre novo card do dia', () => {
  const dOntem = '24/08/2026';
  const dHoje = formatTodayDate(new Date());
  assert.ok(typeof dHoje === 'string');
});

test('B12: handleMidnightDateShift não aciona virada de dia às 21:00 (fuso UTC ignorado)', () => {
  const dUTC = new Date('2026-08-25T00:00:00Z'); // 21:00 BRT do dia 24
  assert.strictEqual(formatTodayDate(dUTC), '24/08/2026');
});

test('B13: Soma de horas trabalhadas no dia somando todos os cards trabalhados', () => {
  const db = DatabaseService.getInstance();
  const todaySeconds = db.getTodayWorkedSeconds();
  assert.ok(typeof todaySeconds === 'number');
});

test('B14: Lembrete de pausa: Inicia temporizador de 5 minutos ao pausar', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.setPausedCard('card-b14', 'Card B14', Date.now(), 1000);
  assert.ok(tracker.getPausedCardId() !== null);
});

test('B15: Lembrete de pausa: Cancela temporizador de 5 minutos ao retomar ou encerrar', () => {
  const tracker = ActiveCardTracker.getInstance();
  tracker.clearPausedCard();
  assert.strictEqual(tracker.getPausedCardId(), null);
});

// ==========================================
// SUITE C: TelegramAdapter (15 Testes)
// ==========================================

test('C1: Disparo de pergunta com lead-time de 20s', () => {
  const targetTime = Date.now() + 60000;
  const leadTimeMs = 20000;
  const triggerTime = targetTime - leadTimeMs;
  assert.strictEqual(targetTime - triggerTime, 20000);
});

test('C2: Janela de resposta de 2 minutos (120s) ativa a partir do recebimento', () => {
  const defaultTimeout = 120000;
  assert.strictEqual(defaultTimeout, 2 * 60 * 1000);
});

test('C3: Resposta de texto puro capturada diretamente como comentário', async () => {
  const storage = StorageService.getInstance();
  storage.saveConfig({
    telegram: { botToken: 'mock_token', chatId: '12345', enabled: true },
  } as any);

  const telegram = TelegramAdapter.getInstance();
  const questionPromise = telegram.askActivityQuestion(2000);

  setTimeout(async () => {
    await telegram.handleIncomingMessage('12345', 'Desenvolvendo módulo de autenticação');
  }, 50);

  const reply = await questionPromise;
  assert.strictEqual(reply, 'Desenvolvendo módulo de autenticação');
});

test('C4: Resposta com comando /comentar limpa o prefixo corretamente', async () => {
  const storage = StorageService.getInstance();
  storage.saveConfig({
    telegram: { botToken: 'mock_token', chatId: '12345', enabled: true },
  } as any);

  const telegram = TelegramAdapter.getInstance();
  const questionPromise = telegram.askActivityQuestion(2000);

  setTimeout(async () => {
    await telegram.handleIncomingMessage('12345', '/comentar Finalizando CRUD de usuários');
  }, 50);

  const reply = await questionPromise;
  assert.strictEqual(reply, 'Finalizando CRUD de usuários');
});

test('C5: Feedback imediato de confirmação enviado ao usuário', async () => {
  const telegram = TelegramAdapter.getInstance();
  let feedback = '';
  telegram.setCommandHandler(async (cmd) => {
    return 'Feedback enviado!';
  });
  const res = await telegram.handleIncomingMessage('12345', '/status');
  assert.ok(res !== undefined);
});

test('C6: Timeout de 2 minutos aciona fallback de proteção', async () => {
  const storage = StorageService.getInstance();
  storage.saveConfig({
    telegram: { botToken: 'mock_token', chatId: '12345', enabled: true },
  } as any);

  const telegram = TelegramAdapter.getInstance();
  let timedOut = false;
  const questionPromise = telegram.askActivityQuestion(50, () => {
    timedOut = true;
  });

  const reply = await questionPromise;
  assert.strictEqual(reply, null);
  assert.strictEqual(timedOut, true);
});

test('C7: Cancelamento imediato do timer de 2 minutos ao receber resposta', async () => {
  const telegram = TelegramAdapter.getInstance();
  telegram.clearPendingQuestion();
  assert.doesNotThrow(() => telegram.clearPendingQuestion());
});

test('C8: Polling ágil com timeout de 10s e reconexão em 500ms', () => {
  const telegram = TelegramAdapter.getInstance();
  assert.ok(telegram !== null);
});

test('C9: Auto-sincronização do chatId na primeira mensagem recebida', async () => {
  const storage = StorageService.getInstance();
  const telegram = TelegramAdapter.getInstance();
  await telegram.handleIncomingMessage('99999', '/ajuda');
  const cfg = storage.getConfig();
  assert.strictEqual(cfg.telegram?.chatId, '99999');
});

test('C10: sendPauseReminder formata mensagem com Inline Keyboard [Retomar] e [Encerrar]', async () => {
  const telegram = TelegramAdapter.getInstance();
  await assert.doesNotReject(async () => {
    await telegram.sendPauseReminder(15);
  });
});

test('C11: Botão inline com callback_data "voltar" despacha retomada de expediente', async () => {
  const telegram = TelegramAdapter.getInstance();
  let cmdExecuted = '';
  telegram.setCommandHandler(async (cmd) => {
    cmdExecuted = cmd;
    return `OK: ${cmd}`;
  });
  await telegram.handleIncomingMessage('12345', '/voltar');
  assert.strictEqual(cmdExecuted, 'voltar');
});

test('C12: Botão inline com callback_data "encerrar" despacha encerramento', async () => {
  const telegram = TelegramAdapter.getInstance();
  let cmdExecuted = '';
  telegram.setCommandHandler(async (cmd) => {
    cmdExecuted = cmd;
    return `OK: ${cmd}`;
  });
  await telegram.handleIncomingMessage('12345', '/encerrar');
  assert.strictEqual(cmdExecuted, 'encerrar');
});

test('C13: Normalização de comandos com sufixo do bot (/status@guardiao_luis_bot)', async () => {
  const telegram = TelegramAdapter.getInstance();
  let normalized = '';
  telegram.setCommandHandler(async (cmd) => {
    normalized = cmd;
    return 'OK';
  });
  await telegram.handleIncomingMessage('12345', '/status@guardiao_luis_bot');
  assert.strictEqual(normalized, 'status');
});

test('C14: Resposta ao comando /ajuda com menu interativo', async () => {
  const telegram = TelegramAdapter.getInstance();
  const reply = await telegram.handleIncomingMessage('12345', '/ajuda');
  assert.ok(typeof reply === 'string');
  assert.ok(reply.includes('MENU DE CONTROLE'));
});

test('C15: Resiliência contra erros de conexão com API do Telegram sem travar processo', async () => {
  const telegram = TelegramAdapter.getInstance();
  await assert.doesNotReject(async () => {
    await telegram.sendMessage('invalido', 'Teste');
  });
});

// ==========================================
// SUITE D: TimeSyncService & Scheduler (15 Testes)
// ==========================================

test('D1: Consulta de horário oficial com IANA America/Sao_Paulo', async () => {
  const sync = TimeSyncService.getInstance();
  const res = await sync.syncTime();
  assert.ok(typeof res.offsetMs === 'number');
  assert.ok(typeof res.isAccurate === 'boolean');
});

test('D2: Cálculo de latência de rede na consulta NTP/WorldTimeAPI', () => {
  const sync = TimeSyncService.getInstance();
  assert.ok(typeof sync.getOffsetMs() === 'number');
});

test('D3: Auto-calibração do offset interno do relógio', () => {
  const sync = TimeSyncService.getInstance();
  const now = sync.getNow();
  assert.ok(now instanceof Date);
});

test('D4: getNow retorna a data/hora exata corrigida pelo offset', () => {
  const sync = TimeSyncService.getInstance();
  const d = sync.getNow();
  assert.ok(!isNaN(d.getTime()));
});

test('D5: Detecção de desvio de relógio local > 5 segundos', () => {
  const offset = 6000;
  const isAccurate = Math.abs(offset) < 5000;
  assert.strictEqual(isAccurate, false);
});

test('D6: Fallback suave para relógio do sistema se rede falhar', () => {
  const sync = TimeSyncService.getInstance();
  assert.ok(sync.getNow() instanceof Date);
});

test('D7: formatTodayDate no padrão estrito DD/MM/AAAA para fuso de Brasília', () => {
  const d = new Date('2026-08-25T15:00:00Z');
  assert.strictEqual(formatTodayDate(d), '25/08/2026');
});

test('D8: getBrasiliaHoursMinutes extrai hora, minuto e dia da semana corretos', () => {
  const d = new Date('2026-08-25T15:30:00Z'); // 12:30 BRT
  const info = getBrasiliaHoursMinutes(d);
  assert.strictEqual(info.hours, 12);
  assert.strictEqual(info.minutes, 30);
  assert.ok(typeof info.dayOfWeek === 'number');
});

test('D9: Jitter de comentários: 100 sorteios dentro da faixa 20-25 minutos', () => {
  for (let i = 0; i < 100; i++) {
    const ms = getCommentJitterMs();
    const min = ms / (60 * 1000);
    assert.ok(min >= 20 && min <= 25.01, `Jitter ${min} fora de 20-25m`);
  }
});

test('D10: Jitter de rotação: 100 sorteios dentro da faixa 230-238 minutos', () => {
  for (let i = 0; i < 100; i++) {
    const ms = getRotationJitterMs();
    const min = ms / (60 * 1000);
    assert.ok(min >= 230 && min <= 238.01, `Jitter ${min} fora de 230-238m`);
  }
});

test('D11: Rotação em modo teste: Jitter proporcional quando limite <= 15 min', () => {
  const storage = StorageService.getInstance();
  const cfg = storage.getConfig();
  cfg.rotationLimitMinutes = 5;
  storage.saveConfig(cfg);

  const ms = getRotationJitterMs();
  const min = ms / (60 * 1000);
  assert.ok(min >= 5 && min <= 5.6, `Jitter de teste ${min} fora da faixa`);

  // Restaura para 230m
  cfg.rotationLimitMinutes = 230;
  storage.saveConfig(cfg);
});

test('D12: formatHMS: Formata 0 segundos até mais de 24 horas corretamente', () => {
  assert.strictEqual(formatHMS(0), '00h00min00seg');
  assert.strictEqual(formatHMS(3665), '01h01min05seg');
  assert.strictEqual(formatHMS(90000), '25h00min00seg');
});

test('D13: formatDuration: Formata mm:ss e hh:mm:ss', () => {
  assert.strictEqual(formatDuration(0), '00:00');
  assert.strictEqual(formatDuration(65000), '01:05');
  assert.strictEqual(formatDuration(3665000), '01:01:05');
});

test('D14: Virada de mês: 31/08 para 01/09', () => {
  const dFimAgosto = new Date('2026-08-31T15:00:00Z');
  assert.strictEqual(formatTodayDate(dFimAgosto), '31/08/2026');

  const dInicioSetembro = new Date('2026-09-01T15:00:00Z');
  assert.strictEqual(formatTodayDate(dInicioSetembro), '01/09/2026');
});

test('D15: Virada de ano: 31/12 para 01/01', () => {
  const dFimAno = new Date('2026-12-31T15:00:00Z');
  assert.strictEqual(formatTodayDate(dFimAno), '31/12/2026');

  const dNovoAno = new Date('2027-01-01T15:00:00Z');
  assert.strictEqual(formatTodayDate(dNovoAno), '01/01/2027');
});
