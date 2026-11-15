# Diagnóstico técnico — estado do repositório antes da reformulação

Data da auditoria: 15/11/2026 · Branch: `claude/md2-ia-office-reformulacao-ktmyv0` (criada a partir de `main`, commit `6a85d0e`).

## O que havia no repositório

O repositório `danielalbuquerqueofc-code/md2-ia-office` era um **fork da extensão de VS Code "Pixel Agents"** (`pablodelucca/pixel-agents`, versão `1.3.0-dev.1`). Não havia nada específico do MD2 IA Office:

| Item procurado | Resultado |
|---|---|
| Alfred | **Não existia.** Nenhuma ocorrência no código. |
| Os 22 agentes (Carlos, Lucas, Fernanda, Rafael, Helena, Mariana, Beatriz, Gabriel, Pedro, Patrícia…) | **Não existiam.** Nenhum nome, cadastro, prompt ou configuração de agente. |
| Banco de dados | Nenhum. Persistência só em `workspaceState` do VS Code e arquivos JSON em `~/.pixel-agents/`. |
| API própria / runtime de agentes | Nenhum. A extensão apenas observa terminais do Claude Code (arquivos JSONL e hooks) e anima personagens. |
| Integrações (Google, Instagram, FFmpeg, Playwright como ferramenta de agente) | Nenhuma. |
| Alterações não commitadas | Nenhuma. Árvore limpa. |
| Branches | `main` e a branch de trabalho (idêntica a `main`). |

O que existia e funcionava: escritório em pixel art (canvas, sprites, editor de layout), detecção de status de terminais Claude Code/Codex via hooks e JSONL, servidor HTTP local para hooks, testes Vitest e Playwright da extensão.

## Principais problemas frente à visão do produto

1. **Natureza errada do produto**: era uma visualização de terminais, não um sistema que executa trabalho. Nenhuma tarefa era delegada, executada ou entregue pelo sistema.
2. **Experiência visual oposta à pedida**: pixel art, personagens caminhando, salas e mesas — exatamente o que deveria sair.
3. **Dependência total da tela aberta**: tudo vivia dentro do VS Code; fechar a janela parava tudo.
4. **Sem orquestração, sem estado de tarefas, sem entregáveis, sem aprovações, sem conhecimento ou skills.**

## Decisões de preservação

- **Nada foi apagado.** Todo o código da extensão foi movido com `git mv` para `legacy/pixel-agents/`, preservando o histórico. A branch `main` permanece intacta.
- O fork não é reaproveitável como base do novo produto (é um renderizador de terminais em canvas). Foi reaproveitado o que era tecnicamente aplicável como **conhecimento**: TypeScript estrito, Vitest, a lição de parear observação com persistência, e o uso do servidor HTTP local.

## Sobre os 22 agentes

Como o cadastro original não estava no repositório, a estrutura foi recriada exatamente conforme a especificação recebida:

- **Nomes preservados conforme informados (10):** Carlos (Direção), Lucas, Fernanda, Rafael (Comercial), Helena (Jurídico), Mariana, Beatriz, Gabriel, Pedro (Marketing), Patrícia (Administrativo).
- **Nomes provisórios (12)**, porque a especificação dizia "preservar os agentes existentes" sem informar os nomes: Thiago, Bruno, Camila, Diego (Desenvolvimento); Juliana, Larissa (Atendimento); Roberto, Aline (Financeiro); Marcelo, Vanessa (Operações); Leonardo, Isabela (Produção). Estão marcados com `"provisionalName": true` em `agents/registry.json` e sinalizados na interface. **Se você tem o cadastro original, substitua nome e função nesse arquivo** — os `id` podem mudar à vontade, desde que as referências em `skills/*/SKILL.md` (`owners`) acompanhem; o teste `registries.test.ts` aponta qualquer inconsistência.
- As **funções** dos agentes de Comercial e Marketing também foram definidas por mim (a especificação trazia só os nomes). Ajuste se divergirem do original.
