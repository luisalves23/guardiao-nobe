# 🛡️ Guardião Nobe — Gestor Inteligente de Horas no Trello

Sistema autônomo, inteligente e resiliente desenvolvido para eliminar perdas de honorários como PJ na **Nobe**. O sistema automatiza o fluxo de cards e comentários no Trello em conformidade total com as regras da empresa, com proteção contra robôs de monitoramento (*"A Presidência"*), rotação segura de cards de 4 horas, comentários periódicos com jitter anti-detecção, tripla camada de fallback (WhatsApp $\rightarrow$ Agenda $\rightarrow$ Templates) e painel web moderno com retenção de 30 dias de logs.

---

## 🚀 Principais Recursos

1. **Jitter Anti-Detecção de Comentários (20 a 26 min)**
   - Varia o tempo de postagem para evitar padrões fixos ou suspeitas.
   - Pergunta interativamente no WhatsApp: *"O que você está fazendo agora?"*.
   - Se você não responder em 3.5 minutos, consome automaticamente a tarefa agendada ou um template realista de fallback.

2. **Rotação Automática de 4 Horas (3h50 a 3h58)**
   - Move o card anterior para a coluna mensal do usuário e cria o novo card na coluna *"Trabalhando Agora"* com a nomenclatura padrão: `Trabalho do Dia - DD/MM/AAAA - Luís Alves`.
   - Adiciona Luís Alves como membro e posta o comentário inicial obrigatório.

3. **Criação Automática da Coluna Mensal no Dia 01**
   - No início de cada mês, detecta ou cria automaticamente a coluna `[Mês] - Luís Alves` (ex: `Setembro - Luís Alves`) no Trello antes de arquivar os cards.

4. **Escudo de Auto-Resgate Contra o Robô "A Presidência"**
   - Monitora o estado do card a cada 20 segundos.
   - Se o robô mover seu card para `"EM ESPERA"`, o Guardião o restaura instantaneamente para `"Trabalhando Agora"`, faz um comentário de reativação imediato e emite alerta no WhatsApp.

5. **Painel Web em Tempo Real + Auditoria de 30 Dias**
   - Acompanhamento de ganhos acumulados no dia (R$ 18/h), cronômetros regressivos em tempo real e timeline auditável retida por 30 dias.

---

## 🛠️ Como Obter as Chaves do Trello

1. Acesse [https://trello.com/app-key](https://trello.com/app-key) logado na sua conta.
2. Copie a sua **API Key**.
3. Na mesma página, clique no link para gerar o seu **Token** de autorização (com permissão de leitura/escrita) e copie-o.
4. Para obter os IDs do Quadro, Colunas e Membro:
   - Você pode preenchê-los diretamente na aba **Configurações** do Painel Web e clicar em **Testar Conexão**.
   - Ou adicionar `.json` ao final da URL do seu quadro no navegador (ex: `https://trello.com/b/xyz123/nome-do-quadro.json`) para visualizar os IDs das listas `"Trabalhando Agora"` e `"EM ESPERA"`.

---

## 🖥️ Como Executar Localmente no Computador

```bash
# 1. Entre na pasta do projeto
cd guardiao-nobe

# 2. Instale as dependências
npm install

# 3. Inicie em modo de desenvolvimento
npm run dev

# 4. Acesse no navegador
http://localhost:3000
```

---

## ☁️ Como Hospedar 24/7 na Nuvem (VPS / Docker)

```bash
# 1. Suba o container com Docker Compose
docker compose up -d --build

# 2. Acesse o IP da sua VPS na porta 3000
http://SEU_IP_VPS:3000
```
> Os logs de 30 dias, agenda e configurações ficam salvos no volume `./data`, garantindo que nada se perca em reinicializações do servidor.

---

## 📱 Comandos do WhatsApp

| Comando | Ação |
| :--- | :--- |
| `!status` | Retorna o status ao vivo, card ativo, horas e ganhos de hoje |
| `!iniciar` | Cria o card do dia em *"Trabalhando Agora"* e inicia contagem |
| `!pausar` | Pausa temporariamente a contagem e os alertas |
| `!voltar` | Retoma o expediente após pausa ou almoço |
| `!almoco` | Inicia o intervalo de almoço |
| `!encerrar` | Encerra o dia e move o card com segurança para a coluna mensal |
| `!comentar <texto>` | Posta um comentário imediato no card ativo |
| `!ajuda` | Lista todos os comandos disponíveis |
