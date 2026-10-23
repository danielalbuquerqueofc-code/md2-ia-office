# MD2 Pixel Office Layout

Branch `feat/md2-pixel-office-layout`, derivada de `feat/md2-office-foundation`.

Mapa nativo editável com sete departamentos, 20 posições e uma mesa exclusiva do CEO. Comercial, Marketing e Operações à esquerda; Diretoria, Financeiro e Tecnologia à direita; CEO e Atendimento no centro. Corredores conectam salas e convivência. Sprites, motor, editor, mapa padrão original e licença MIT preservados.

Geração reproduzível: `node scripts/build-md2-layout.mjs`. A paleta compartilhada fica em `core/src/assets/md2-palette.json`. O mapa global original não é sobrescrito. Mapas MD2 personalizados continuam salvos no projeto; a disposição nova é o padrão para projetos sem mapa salvo.

O enquadramento se ajusta à tela. Sprites no zoom fracionário são rasterizados na resolução original antes da redução, evitando frestas no celular. O editor mantém seu comportamento anterior. A barra original foi compactada, a navegação lateral pode rolar e os indicadores de atividade acompanham o zoom do canvas.

## Sessões e aprovações

As 20 posições são capacidade planejada, não agentes em execução. Abrir o mapa não inicia tarefas nem chamadas de IA. O Programador Codex continua sendo criado após conectar uma sessão real e recebe eventos reais do protocolo. Sua preferência de assento aponta para Tecnologia, inclusive no mapa MD2 anterior.

Tarefas persistidas, cancelamento, autorização do operador, aprovação humana de uso único, expiração e recusa de pedidos sem conteúdo revisável foram mantidos. Não houve nova execução de modelo nesta validação visual.

## Validação — 23/10/2026

- Interface: 200 testes aprovados. Inclui 5 testes do mapa: 20 posições + CEO, distribuição por área, IDs únicos, conexão dos postos por corredores e enquadramento em três tamanhos de tela.
- Servidor: 672 aprovados, 53 falharam e 8 ignorados. Os nomes das 53 falhas já constam nos registros da base oficial em Windows, incluindo suas execuções direcionadas. A suíte completa permanece sem aprovação; a comparação por nome não garante ausência de todos os defeitos.
- Os 8 testes da integração MD2 passaram, incluindo sessões/eventos, autorização, vínculo das tarefas, aprovações humanas e expiração.
- Empacotamento: 7 testes aprovados. Tipos e compilação aprovados. ESLint sem erros; um aviso anterior permanece no registro de ações do editor para testes E2E.
- Navegador local: carregamento do mapa real via WebSocket, 8 áreas e 21 assentos; API com 7 departamentos/20 posições; acesso sem credencial recebe 401; centro de aprovações abre; nenhum erro de página; quantidade de tarefas inalterada. Capturas de desktop, tela compacta e celular.

## Vulnerabilidades e limites

A auditoria inicial encontrou 11 alertas: 1 crítico, 8 altos e 2 moderados. `npm audit fix --ignore-scripts`, sem `--force`, atualizou o lockfile dentro das faixas permitidas. A auditoria posterior do projeto e seus workspaces retornou zero vulnerabilidades conhecidas. Versões resultantes incluem Fastify 5.12.7, shell-quote 1.12.0, Vite 8.3.5 e Vitest 4.1.12.

Zero alertas não garante segurança integral. A compilação ainda avisa sobre tamanho do JavaScript e compatibilidade futura do carregamento da configuração do Vite. Nenhum merge ou deploy foi feito.

## Reproduzir capturas

Com um servidor MD2 local já iniciado, configure `MD2_PREVIEW_URL`, `MD2_PREVIEW_TOKEN` e opcionalmente `MD2_SCREENSHOT_DIR`; execute `node scripts/verify-md2-layout.cjs`. Requer Playwright Chromium. O script só lê dados e navega: não envia tarefas nem inicia sessões de IA.
