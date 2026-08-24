import assert from 'node:assert';
import test from 'node:test';
import { TrelloTimeAuditor } from '../modules/trello/trello.time-auditor.js';

test('TrelloTimeAuditor: Cálculo milimétrico de tempo trabalhado com base em Actions do Trello', () => {
  const workingListId = 'list-working';
  const waitListId = 'list-wait';
  const monthlyListId = 'list-monthly';

  // Simulação exata dos logs descritos pelo usuário:
  // 12:00:00 -> Abertura em Trabalhando Agora
  // 12:01:30 -> Colocado em Espera (90s de trabalho)
  // 12:01:35 -> Voltou ao Trabalho
  // 12:02:00 -> Movido para Arquivado (25s de trabalho)
  // 12:02:03 -> Movido para Trabalhando Agora (Desarquivado)
  // 12:02:05 -> Movido para a lista do Mês (2s de trabalho)
  // Total esperado: 90s + 25s + 2s = 117s (00h01min57seg)

  const actions = [
    {
      date: '2026-08-24T12:00:00.000Z',
      type: 'createCard',
      data: { list: { id: workingListId, name: 'Trabalhando Agora' }, card: { name: 'Card Teste Milimétrico' } },
    },
    {
      date: '2026-08-24T12:01:30.000Z',
      type: 'updateCard',
      data: { listBefore: { id: workingListId }, listAfter: { id: waitListId } },
    },
    {
      date: '2026-08-24T12:01:35.000Z',
      type: 'updateCard',
      data: { listBefore: { id: waitListId }, listAfter: { id: workingListId } },
    },
    {
      date: '2026-08-24T12:02:00.000Z',
      type: 'updateCard',
      data: { card: { closed: true }, old: { closed: false } },
    },
    {
      date: '2026-08-24T12:02:03.000Z',
      type: 'updateCard',
      data: { card: { closed: false }, old: { closed: true } },
    },
    {
      date: '2026-08-24T12:02:05.000Z',
      type: 'updateCard',
      data: { listBefore: { id: workingListId }, listAfter: { id: monthlyListId } },
    },
  ];

  let currentListId: string | null = null;
  let isClosed = false;
  let lastWorkingEnteredTime: number | null = null;
  let accumulatedSeconds = 0;
  const intervals: Array<{ start: string; end: string; seconds: number }> = [];

  for (const a of actions) {
    const t = new Date(a.date).getTime();
    const wasWorking = currentListId === workingListId && !isClosed;

    if (a.type === 'createCard') {
      currentListId = a.data?.list?.id || null;
      isClosed = false;
    }
    if (a.data?.listAfter?.id) {
      currentListId = a.data.listAfter.id;
    }
    if (a.data?.card && typeof a.data.card.closed === 'boolean') {
      isClosed = a.data.card.closed;
    }

    const isWorking = currentListId === workingListId && !isClosed;

    if (wasWorking && !isWorking) {
      if (lastWorkingEnteredTime !== null) {
        const diffSec = (t - lastWorkingEnteredTime) / 1000;
        accumulatedSeconds += diffSec;
        intervals.push({
          start: new Date(lastWorkingEnteredTime).toISOString(),
          end: new Date(t).toISOString(),
          seconds: diffSec,
        });
        lastWorkingEnteredTime = null;
      }
    } else if (!wasWorking && isWorking) {
      lastWorkingEnteredTime = t;
    }
  }

  assert.strictEqual(accumulatedSeconds, 117, 'Total de segundos deve ser exatamente 117s');
  assert.strictEqual(intervals.length, 3, 'Devem existir exatamente 3 intervalos de trabalho contabilizados');
  assert.strictEqual(intervals[0].seconds, 90, 'Primeiro intervalo deve ter 90 segundos');
  assert.strictEqual(intervals[1].seconds, 25, 'Segundo intervalo deve ter 25 segundos');
  assert.strictEqual(intervals[2].seconds, 2, 'Terceiro intervalo deve ter 2 segundos');

  const formatted = TrelloTimeAuditor.formatSecondsToHMS(accumulatedSeconds);
  assert.strictEqual(formatted, '00h01min57seg', 'Formatação deve ser rigorosamente 00h01min57seg');
});
