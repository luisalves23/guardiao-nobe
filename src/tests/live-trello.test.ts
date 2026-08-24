import { TrelloService } from '../services/trello.service.js';
import { StorageService } from '../services/storage.service.js';
import { formatTodayDate } from '../core/jitter.js';

async function runLiveTest() {
  const trello = TrelloService.getInstance();
  const storage = StorageService.getInstance();
  const config = storage.getConfig();

  console.log('===========================================================');
  console.log('    🧪 INICIANDO TESTE 100% REAL NO TRELLO (NOBE TESTE)    ');
  console.log('===========================================================');

  // 1. Criar Card em "Trabalhando Agora"
  const dateFormatted = formatTodayDate(new Date());
  const cardTitle = `Trabalho do Dia - ${dateFormatted} - ${config.trello.userName || 'Luis Alves'}`;
  console.log(`1. Criando card na coluna "Trabalhando Agora": "${cardTitle}"`);
  
  const card = await trello.createCard(config.trello.workingListId, cardTitle, config.trello.memberId);
  console.log(`✅ Card criado com sucesso! ID: ${card.id}`);

  // 2. Comentário Inicial
  console.log('2. Postando comentário inicial no Trello...');
  await trello.addComment(card.id, 'Início do expediente - Tarefas do dia em andamento.');
  console.log('✅ Comentário inicial registrado!');

  // 3. Simulação de ataque do robô "A Presidência" (Mover para "Espera")
  console.log('3. Simulando ação da "Presidência" -> Movendo card para a coluna "Espera"...');
  await trello.moveCard(card.id, config.trello.waitListId);
  console.log('⚠️ Card agora está em "Espera".');

  // 4. Execução do Auto-Resgate
  console.log('4. Acionando Auto-Resgate do Guardião Nobe...');
  const cardCheck = await trello.getCard(card.id);
  if (cardCheck.idList === config.trello.waitListId) {
    await trello.moveCard(card.id, config.trello.workingListId);
    await trello.addComment(card.id, 'Reativando contagem de horas do card - Resgate automático 3s.');
    console.log('✅ [AUTO-RESGATE CONCLUÍDO]: Card restaurado para "Trabalhando Agora" e comentário postado!');
  }

  // 5. Teste de Coluna Mensal
  console.log('5. Localizando/Criando coluna do mês atual...');
  const monthlyList = await trello.findOrCreateMonthlyList(config.trello.boardId);
  console.log(`✅ Coluna mensal validada: "${monthlyList.name}" (ID: ${monthlyList.id})`);

  console.log('===========================================================');
  console.log('    🎉 TESTE REAL CONCLUÍDO COM 100% DE SUCESSO!           ');
  console.log('===========================================================');
}

runLiveTest().catch((err) => {
  console.error('❌ Erro no teste real:', err);
  process.exit(1);
});
