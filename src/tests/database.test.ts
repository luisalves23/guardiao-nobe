import test from 'node:test';
import assert from 'node:assert';
import { DatabaseService } from '../services/database.service.js';

test('DatabaseService: Gestão de Sessões de Trabalho, Atividades e Registro de Erros', async () => {
  const db = DatabaseService.getInstance();

  // 1. Inicia Sessão de Trabalho
  const session1 = db.startWorkSession('card_test_123', 'Trabalho do Dia - Luis Alves', 'WORKING');
  assert.ok(session1.id > 0);
  assert.strictEqual(session1.state, 'WORKING');
  assert.strictEqual(session1.is_active, 1);

  // 2. Verifica sessão ativa
  const active = db.getActiveWorkSession();
  assert.ok(active !== null);
  assert.strictEqual(active?.id, session1.id);

  // 3. Finaliza sessão
  const ended = db.endActiveWorkSession('USER_PAUSE');
  assert.ok(ended !== null);
  assert.strictEqual(ended?.is_active, 0);
  assert.strictEqual(ended?.end_reason, 'USER_PAUSE');

  // 4. Inicia segunda sessão
  const session2 = db.startWorkSession('card_test_123', 'Trabalho do Dia - Luis Alves', 'WORKING');
  assert.ok(session2.id > session1.id);

  // 5. Cálculo de segundos trabalhados hoje
  const todaySeconds = db.getTodayWorkedSeconds();
  assert.ok(todaySeconds >= 0);

  db.endActiveWorkSession('USER_END');

  // 6. Registro de Atividades
  const act = db.logActivity('TRELLO', 'CARD_MOVED', 'Card movido para Trabalhando Agora', 'list_1 -> list_2');
  assert.ok(act.id > 0);
  assert.strictEqual(act.category, 'TRELLO');

  const activities = db.getRecentActivities(10);
  assert.ok(activities.length >= 1);

  // 7. Registro de Erros com Stack e Contexto
  const errLog = db.logError('TRELLO', 'Rate limit atingido na API', 'Error: 429\n  at callApi()', { status: 429, retryAfter: 30 }, 'ERR_RATE_LIMIT');
  assert.ok(errLog.id > 0);
  assert.strictEqual(errLog.module, 'TRELLO');
  assert.strictEqual(errLog.error_code, 'ERR_RATE_LIMIT');

  const errors = db.getRecentErrors(10);
  assert.ok(errors.length >= 1);
  assert.strictEqual(errors[0].error_message, 'Rate limit atingido na API');
});
