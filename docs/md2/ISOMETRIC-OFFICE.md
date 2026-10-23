# MD2 IA Office — cena isométrica

Base: `feat/md2-pixel-office-layout`. Branch: `feat/md2-isometric-office`.

## Implementação

A imagem enviada orienta a composição: Comercial, Marketing e Operações à esquerda; Diretoria, Financeiro e Tecnologia à direita; CEO exclusivo ao centro superior; recepção com marca MD2 e área de convivência ao centro. Atendimento completa os sete departamentos e as 20 posições planejadas. CEO e recepcionista são personagens adicionais, não cargos acrescentados ao cadastro.

Cada sala tem piso, duas paredes em projeção isométrica, janelas, placas, mesas com profundidade, monitores, quadros, plantas e iluminação ambiente. O cenário é SVG composto de elementos independentes; não usa a referência como fundo. A projeção é calculada em código e a escala se adapta ao painel. Os sprites de personagens, PCs, plantas, estantes e sofás são os PNGs já existentes do Pixel Agents. Não houve geração de imagens nem chamadas de modelos.

Os personagens planejados têm animação ambiente identificada como ilustrativa. Somente uma tarefa em execução/aprovação com `threadId` e `agentId` produz o personagem de sessão real em Tecnologia. Em aprovação, esse personagem aguarda e não digita. Clicar em Tecnologia ou usar Enter/Espaço abre o painel existente de tarefas e aprovações. Movimento reduzido desativa as animações.

O backend, o cliente Codex, tarefas, aprovações, persistência, histórico, mapa nativo e editor originais não foram alterados. A nova cena aparece somente no modo MD2; o lançamento padrão do Pixel Agents mantém a apresentação original. O TypeScript dos testes passou a aceitar JSX/DOM para validar a renderização estática dos estados reais e de aprovação.

## Etapas e validação

1. Projeção, sete departamentos, 20 postos e vínculo com sessões: 10 testes direcionados aprovados (incluindo os 5 testes do mapa anterior).
2. Renderização dos estados real/em aprovação e composição no navegador; capturas desktop, compacta, mobile e painel de aprovações.
3. Validação final da interface: 207 testes aprovados. Integração MD2: 8 testes aprovados. Empacotamento: 7 testes aprovados. Tipos e compilação aprovados. ESLint sem erros, com um aviso anterior em App.tsx sobre dependência de hook no registro de ações E2E.
4. Suíte completa do servidor: 671 aprovados, 54 falharam, 8 ignorados. Das falhas, 53 têm nomes já registrados na base oficial no Windows. A adicional foi temporal (`claude-hook.js`, envio paralelo: 3591 ms contra limite de 3500 ms); passou isoladamente em aproximadamente 2192 ms. A suíte completa continua sem aprovação; o reteste isolado não altera esse resultado.
5. Auditoria de dependências: zero vulnerabilidades conhecidas. Permanecem avisos de tamanho do JavaScript e compatibilidade futura da configuração do Vite.

O teste de navegador confirma: 9 áreas visuais (7 departamentos, CEO, recepção), 21 mesas, 22 personagens ilustrativos sem sessões ativas; assets carregados sem erros HTTP; acesso sem credencial recebe 401; teclado e movimento reduzido funcionam; tarefas e aprovações permanecem idênticas antes/depois. Nenhuma tarefa é enviada durante a validação.

## Arquivos

- `webview-ui/src/components/Md2IsometricOffice.tsx`: cena e componentes visuais.
- `webview-ui/src/components/md2Isometric.ts`: projeção, composição e seleção da sessão real.
- `webview-ui/src/components/md2-isometric.css`: tema, iluminação, animações e responsividade.
- `webview-ui/src/components/Md2OfficePanel.tsx`: integração da cena ao estado real existente.
- `webview-ui/test/md2Isometric.test.ts`: geometria, postos, vínculo e renderização dos estados.
- `webview-ui/tsconfig.node.json`: suporte aos testes de renderização React.
- `scripts/verify-md2-isometric.cjs`: verificação de navegador somente leitura e capturas.
- `docs/md2/ISOMETRIC-OFFICE.md`: registro de implementação, testes e limitações.

Para reproduzir as capturas, com servidor MD2 local ocioso, defina `MD2_PREVIEW_URL`, `MD2_PREVIEW_TOKEN`, `MD2_SCREENSHOT_DIR` e execute `node scripts/verify-md2-isometric.cjs`. Requer Chromium do Playwright. Não inicia sessões de IA.

## Pendências e limites

A organização segue a referência, mas a arte é uma aproximação com os sprites disponíveis: não é reprodução pixel a pixel do acabamento ilustrado, das texturas ou das animações da imagem. Os demais agentes são cargos planejados; continuam sem automação. A visão mobile permite rolagem do cenário para preservar detalhes. As falhas herdadas/intermitentes do servidor e o aviso de hook ainda exigem trabalho separado. Nenhum merge ou deploy foi realizado.
