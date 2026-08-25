# System Rules: Antigravity Core

## 1. Protocolo de Diagnóstico Pré-Execução (Modo Análise)
Antes de escrever, editar ou propor alterações no código para correção de bugs ou refatorações, **NUNCA aplique mudanças de imediato**. Emita um relatório estruturado no seguinte padrão exato e aguarde aprovação explícita:

### I. Causa Raiz e Contexto
* **O quê:** Descrição técnica, concisa e objetiva do comportamento inesperado versus o esperado.
* **Por quê:** Mecanismo exato que causou a falha (ex.: *type mismatch*, *race condition*, mutação indevida, *null/undefined dereference*).
* **Quando:** Condição, estado ou gatilho temporal/operacional em que o erro se manifesta.
* **Onde:** Caminho exato dos arquivos, módulos, funções e intervalos de linha envolvidos.

### II. Mapeamento de Impacto e Dependências (Blast Radius)
* **Componentes Afetados:** Módulos, telas, contratos de API, hooks ou componentes de UI impactados direta e indiretamente.
* **Componentes Causadores:** Origem primária da falha e dependências que propagaram o estado inconsistente.
* **Análise de Regressão Ponta a Ponta:** Mapeamento minucioso de tudo o que pode quebrar (tipagens compartilhadas, chamadas downstream, estados globais, banco/cache, side-effects).

### III. Plano de Mudança Cirúrgico
* **Estratégia de Implementação:** Passo a passo técnico para resolver a falha sem alterar contratos públicos ou gerar quebras desnecessárias.
* **Isolamento e Retrocompatibilidade:** Abordagem para conter efeitos colaterais e garantir compatibilidade com o restante da aplicação.

### IV. Matriz de Cobertura de Testes (Mínimo de 5 Cenários)
Apresentar no mínimo 5 casos de teste cobrindo diferentes ângulos da aplicação:
1. **Caminho Feliz (Happy Path):** Validação do fluxo principal corrigido com dados nominais.
2. **Caso Limite (Edge Case):** Entradas extremas, vazias, nulas, arrays vazios ou limites de tipo/valor.
3. **Cenário de Falha / Exceção:** Validação do tratamento gracioso de erros (sem quebrar a aplicação/UI).
4. **Teste de Regressão / Integração:** Garantir que consumidores, componentes-pai ou APIs dependentes continuem funcionando.
5. **Teste de Estado / Concorrência:** Comportamento sob re-renderizações, chamadas assíncronas simultâneas ou mutações de estado.

### V. Alertas Técnicos e Pontos Cegos (Mínimo 3, Máximo 15)
* Riscos arquiteturais e débitos técnicos.
* Impactos em performance, memória ou consumo de rede.
* Considerações de segurança, tipagem estrita ou acessibilidade/UX.
* O que não está sendo considerado explicitamente no escopo inicial.

---

## 2. Gate de Confirmação (Wait for Approval)
> 🛑 **Bloqueio Mandatório:** Após apresentar a análise acima, finalize a resposta e **aguarde instruções**. Não execute ferramentas de escrita/edição de arquivos nem forneça o código final antes de receber uma confirmação explícita (ex.: *"Aprovado"*, *"Pode aplicar"*, *"Siga com o plano"*).

---

## 3. Diretrizes de Qualidade e Boas Práticas
* **Princípio da Menor Alteração Possível:** Modifique apenas o estritamente necessário para corrigir o problema.
* **Preservação de Padrões:** Siga rigorosamente as convenções de nomenclatura, tipagem, formatação e arquitetura do repositório.
* **Limpeza e Higiene de Código:** Não deixe imports órfãos, logs de depuração temporários ou código comentado.
