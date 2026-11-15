# Relatório da fase 2 — identidade dos agentes e validação comercial

15/11/2026 · Branch `claude/md2-ia-office-reformulacao-ktmyv0` · `main` intocada (`6a85d0e`) · sem merge, deploy, publicação, envio a clientes, nem alteração dos tetos de custo (US$ 5 por tarefa, 15 por execução, 60 por dia). Nada foi apagado.

## 1. O que encontrei, incluindo o meu erro

Nas fases anteriores eu afirmei que o cadastro original dos 22 agentes não existia e criei 12 identidades provisórias. **Isso estava errado.** Eu só havia inspecionado a `main`. O cadastro está na branch remota `chore/md2-02a-consolidacao`, commit `d4e3933` (trabalho original de 23 a 27/10/2026), com nome, departamento, cargo, descrição e capacidades de cada agente.

Consequência real: 6 agentes que eu havia inventado não existiam, 6 do cadastro estavam omitidos e vários tinham departamento ou cargo trocados. Isso foi corrigido, e os documentos anteriores que repetiam a afirmação errada ganharam nota de correção (`DIAGNOSTICO.md`, `STATUS.md`, `RELATORIO_OPERACAO_NOTURNA.md`).

Evidências preservadas literalmente em `docs/evidencias/md2-original/`; extração mecânica em `agents/original-registry.json`. Alfred **não existe** no projeto original (foi definido por você na reformulação). No original, a porta de entrada era o Carlos, por regras fixas.

## 2. O que mudou

| Área | Mudança |
|---|---|
| Identidade | `agents/registry.json` refeito sobre os 22 originais. Identidade = `confirmado_no_cadastro_original`. Competências = `proposta_pendente_de_confirmacao`. Teste `agents-identity.test.ts` impede divergência do original |
| Matriz | `docs/MATRIZ_DE_COMPETENCIAS.md` (gerada do registro): os 14 campos por agente, quando acionar, o que não pode, ferramentas permitidas e proibidas, skills. Menor privilégio: só 6 agentes têm shell; Isabela não tem |
| Skills | 30 (13 novas), cada agente com ao menos uma skill exclusiva e com as seções obrigatórias |
| Alfred | Cada tarefa tem entrega esperada e critérios de aceite. `validatePlan` rejeita duplicidade, skill de outro dono, ciclos e site/vídeo sem QA depois da construção. O sistema confere o arquivo de cada tarefa e Alfred cobra uma vez. Validação final pode pedir tarefas extras. Prévia de plano sem execução |
| Validação real | `preflight` mede material e ambiente sem custo e **aborta antes de gastar** se o material parece sintético. Cenários A e B no executor, com verificação independente (ffprobe, navegador) e classificação em três níveis |
| Windows | Detecção de executáveis (`.exe`) corrigida no sandbox; o isolamento em si só foi validado em Linux |
| CI | Instala ffmpeg, bubblewrap e socat |

Documentos: `AGENTES_ORIGINAIS_E_CONFIRMADOS.md`, `MATRIZ_DE_COMPETENCIAS.md`, `ALFRED_ORQUESTRADOR.md`, `PLANO_VALIDACAO_REAL.md` e este.

## 3. Testes

| Teste | Resultado |
|---|---|
| Tipagem | Passou |
| Unitários e integração | **131/131** (13 arquivos; eram 63) |
| Interface E2E | 39/39 na execução final |
| Build | Passou |
| `npm audit` | 0 vulnerabilidades |
| Sandbox obrigatório, com agente real tentando violar | 5/5 bloqueios (US$ 0,075) |
| Permissões por agente | Cobertas por `agents-matrix.test.ts` e `guardrails.test.ts` |
| Persistência e recuperação | Cobertas pelos testes existentes; não repeti a queda com `SIGKILL` nesta fase |
| Custo | Prévias entram em `previews` e no gasto diário (testado) |

**A divulgar:** uma execução do smoke de interface terminou sem imprimir o resultado, sem causa identificada; as quatro seguintes passaram 39/39. Não reproduzi.

## 4. Teste técnico do cenário B (não é validação)

Rodei o pipeline novo do Reels (6 tarefas: Diego → Isabela → Vinícius → Diego → Sofia → Amanda) **uma vez**, com a pasta sintética da noite anterior, apenas para achar defeitos de pipeline. **Cenário B continua NÃO VALIDADO**: não houve vídeo real.

- Concluiu: 6/6 tarefas, 0 cobranças, 0 erros, 0 bloqueios de segurança, sandbox ativo, 18 min, **US$ 4,60** (dentro da estimativa de US$ 4 a 7).
- MP4 de 30,0 s, 1080x1920, 30 fps, H.264/AAC; script `montar.sh` reproduz o mesmo MD5.
- **Alfred e Diego identificaram sozinhos que o material era sintético** (o `LEIAME_TESTE.txt` e os quadros lisos), disseram que o vídeo não pode ser publicado e pediram o material real. Esse é o comportamento certo.
- Defeitos que o teste mostrou, ainda não corrigidos: a legenda ficou em duas versões divergentes (`legenda.txt` e o roteiro × `revisao-reels.md`), e Alfred deixou a atualização como pendência em vez de cobrar antes de entregar; texto do plano 9 com 62 px contra 64 a 72 px pedidos; um plano com imagem parada por 3 s; folhas de contato salvas em `inventario/` e não em `quadros/`. São candidatos a critério de aceite explícito ("uma única versão da legenda") antes da validação real.
- A verificação "tarefas em paralelo" reprova porque o plano de Reels é sequencial por natureza.

## 5. Custos pagos desta fase

| Item | US$ |
|---|---|
| 3 prévias de plano | 0,36 |
| Teste do sandbox com agente real | 0,08 |
| Teste técnico do Reels (sintético) | 4,60 |
| **Total** | **5,04** |

Estimativas do SDK, não fatura. Nenhuma chamada paga além dessas. Cenário A não foi executado.

## 6. Limites e riscos que continuam

1. **Nenhum cenário foi validado com material real.** B depende de vídeos seus; A depende de links, prints do Instagram e dados verdadeiros da empresa.
2. A execução real do A (9 agentes) pode ficar perto do teto de US$ 15 por execução. Não aumentei o teto; se bater, o sistema cancela as pendentes e avisa.
3. Só duas prévias de roteamento: não há taxa de acerto do Alfred medida em amostra.
4. Duplicidade semântica (títulos diferentes, mesmo trabalho) só é contida pelo prompt. A cobrança confere existência e registro, não conteúdo.
5. Playwright MCP nunca foi usado por um agente; o QA visual usa Chrome headless via shell.
6. Windows nativo e WSL2 não testados; o seu notebook provavelmente é Windows. O caminho mais simples é anexar os vídeos pela interface em um servidor Linux.
7. **As competências de todos os 22 agentes são propostas.** Só nome, departamento, cargo e descrição estão confirmados.
8. **Quatro lacunas de papel** que o cadastro original não cobre: editor de vídeo/motion, designer visual, Fechamento e Cobrança (existiam só num plano visual antigo). Hoje Diego faz a edição e Camila o layout, como expansão pendente da sua confirmação.

## 7. O que depende de você

| Decisão ou item | Por quê |
|---|---|
| Confirmar ou corrigir a matriz de competências | Só então o registro sai de `proposta_pendente_de_confirmacao` |
| Decidir as 4 lacunas de papel | Criar agentes novos altera a estrutura de 22 |
| Pasta com vídeos reais + autorização de uso | Única forma de validar o B (ver lista em `PLANO_VALIDACAO_REAL.md`) |
| Links do Maps e Instagram, prints, dados reais, autorização do cliente | Validar o A |
| Escolher onde rodar (Linux/WSL2 ou anexar pela interface) | O isolamento só vale em Linux |
| Teto do cenário A | Manter US$ 15 ou subir; **não alterei** |

## 8. Próximo passo

Você envia a pasta de vídeos reais. Rodo `npm run preflight`, depois `node e2e/real-operation.mjs --cenario=b --pasta=... --material-real`, antes endurecendo os critérios de aceite do Reels pelos defeitos da seção 4 (legenda única, tamanho mínimo de texto, quadros no lugar certo). Você responde as 5 perguntas sim/não do plano. Só então o B pode ser declarado validado.
