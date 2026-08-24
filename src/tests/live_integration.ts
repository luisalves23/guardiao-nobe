import dotenv from 'dotenv';
dotenv.config();

import { StorageService } from '../services/storage.service.js';
import { TrelloClient } from '../modules/trello/trello.client.js';
import { TrelloCardsManager } from '../modules/trello/trello.cards.js';
import { TrelloListsManager } from '../modules/trello/trello.lists.js';
import { TelegramAdapter } from '../modules/messaging/telegram.adapter.js';
import { formatTodayDate } from '../modules/scheduler/jitter.js';

async function runLiveDiagnostics() {
  console.log('====================================================');
  console.log('   🔍 DIAGNÓSTICO COMPLETO DE FERRAMENTAS & APIS    ');
  console.log('====================================================');

  const storage = StorageService.getInstance();
  const config = storage.getConfig();

  console.log('\n1. 📋 VERIFICAÇÃO DE CONFIGURAÇÃO:');
  console.log('   - Board ID:', config.trello.boardId);
  console.log('   - Working List ID:', config.trello.workingListId);
  console.log('   - Wait List ID:', config.trello.waitListId);
  console.log('   - Member ID:', config.trello.memberId);
  console.log('   - User Name:', config.trello.userName);
  console.log('   - Telegram Bot Token:', config.telegram?.botToken ? 'Configurado' : 'Ausente');
  console.log('   - Telegram Chat ID:', config.telegram?.chatId || 'Não detectado');

  console.log('\n2. 🔗 TESTE DE AUTENTICAÇÃO TRELLO:');
  const trelloClient = TrelloClient.getInstance();
  try {
    const memberRes = await trelloClient.getHttp().get('/members/me', { params: trelloClient.getAuthParams() });
    console.log(`   ✅ Trello Conectado: Usuário "${memberRes.data.fullName}" (@${memberRes.data.username})`);
  } catch (err: any) {
    console.error('   ❌ Falha na autenticação do Trello:', err.message);
  }

  console.log('\n3. 📑 TESTE DE LISTAS DO QUADRO:');
  const listsManager = TrelloListsManager.getInstance();
  try {
    const lists = await listsManager.getBoardLists(config.trello.boardId);
    console.log(`   ✅ ${lists.length} listas encontradas no Quadro:`);
    for (const l of lists) {
      const isWorking = l.id === config.trello.workingListId ? ' [TRABALHANDO AGORA]' : '';
      const isWait = l.id === config.trello.waitListId ? ' [ESPERA]' : '';
      console.log(`      - ${l.name} (ID: ${l.id})${isWorking}${isWait}`);
    }

    const monthlyList = await listsManager.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
    console.log(`   ✅ Lista Mensal Localizada/Criada: "${monthlyList.name}" (ID: ${monthlyList.id})`);
  } catch (err: any) {
    console.error('   ❌ Erro ao buscar listas:', err.message);
  }

  console.log('\n4. 🤖 TESTE DO TELEGRAM BOT:');
  const telegram = TelegramAdapter.getInstance();
  try {
    const token = config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const tgRes = await (await import('axios')).default.get(`https://api.telegram.org/bot${token}/getMe`);
      console.log(`   ✅ Telegram Conectado: Bot @${tgRes.data.result.username} (${tgRes.data.result.first_name})`);
    } else {
      console.log('   ⚠️ Token do Telegram não configurado no ambiente.');
    }
  } catch (err: any) {
    console.error('   ❌ Erro na API do Telegram:', err.message);
  }

  console.log('\n5. 🃏 TESTE DE CICLO DE CARDS NO TRELLO (CRUD & UNARCHIVE):');
  const cardsManager = TrelloCardsManager.getInstance();
  try {
    const today = formatTodayDate(new Date());
    const testTitle = `[TESTE AUTOMATIZADO] - ${today}`;
    
    // 5.1 Criação
    const created = await cardsManager.createCard(config.trello.workingListId, testTitle);
    console.log(`   ✅ Card de teste criado com sucesso (ID: ${created.id})`);

    // 5.2 Comentário
    await cardsManager.addComment(created.id, 'Teste de comentário automático.');
    console.log('   ✅ Comentário adicionado com sucesso');

    // 5.3 Movimentação
    const monthlyList = await listsManager.findOrCreateMonthlyList(config.trello.boardId, config.trello.userName);
    await cardsManager.moveCard(created.id, monthlyList.id);
    console.log(`   ✅ Card movido para a pasta mensal (${monthlyList.name})`);

    // 5.4 Arquivamento e Desarquivamento
    await trelloClient.getHttp().put(`/cards/${created.id}`, null, {
      params: { ...trelloClient.getAuthParams(), closed: true },
    });
    console.log('   ✅ Card arquivado para teste de auto-desarquivamento');

    const unarchived = await cardsManager.unarchiveCard(created.id, config.trello.workingListId);
    console.log(`   ✅ Card desarquivado e retornado para Trabalhando Agora (closed: ${unarchived.closed})`);

    // 5.5 Limpeza final do card de teste
    await trelloClient.getHttp().delete(`/cards/${created.id}`, {
      params: trelloClient.getAuthParams(),
    });
    console.log('   ✅ Card de teste excluído com sucesso (Quadro limpo)');
  } catch (err: any) {
    console.error('   ❌ Erro no ciclo de cards do Trello:', err.message);
  }

  console.log('\n====================================================');
  console.log('   🎉 DIAGNÓSTICO CONCLUÍDO COM SUCESSO!            ');
  console.log('====================================================');
}

runLiveDiagnostics().catch(console.error);
