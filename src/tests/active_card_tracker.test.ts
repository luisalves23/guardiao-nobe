import assert from 'node:assert';
import test from 'node:test';
import { ActiveCardTracker } from '../modules/shift/active-card.tracker.js';

test('ActiveCardTracker: Gestão unificada de idade do card, cálculo de rotação e comentários', () => {
  const tracker = ActiveCardTracker.getInstance();
  
  tracker.setActiveCard('card-123', 'Trabalho do Dia - Teste', Date.now());
  let state = tracker.getState();
  assert.strictEqual(state.cardId, 'card-123');
  assert.strictEqual(state.cardName, 'Trabalho do Dia - Teste');
  assert.strictEqual(state.workingSeconds, 0);
  assert.strictEqual(state.isRotationDue, false);
  assert.strictEqual(state.remainingRotationMinutes, 230);
  
  // Simula 100 minutos trabalhados (6000s)
  tracker.updateTime(6000);
  state = tracker.getState();
  assert.strictEqual(state.workingSeconds, 6000);
  assert.strictEqual(state.workingMinutes, 100);
  assert.strictEqual(state.remainingRotationMinutes, 130);
  assert.strictEqual(state.isRotationDue, false);

  // Simula mais 135 minutos trabalhados (total 235m > 230m)
  tracker.updateTime(135 * 60);
  state = tracker.getState();
  assert.strictEqual(state.workingMinutes, 235);
  assert.strictEqual(state.remainingRotationMinutes, 0);
  assert.strictEqual(state.isRotationDue, true);

  // Registro de comentário
  const commentTime = Date.now();
  tracker.recordComment(commentTime);
  assert.strictEqual(tracker.getLastCommentTimestamp(), commentTime);

  // Limpeza
  tracker.clearCard();
  state = tracker.getState();
  assert.strictEqual(state.cardId, null);
  assert.strictEqual(state.workingSeconds, 0);
});
