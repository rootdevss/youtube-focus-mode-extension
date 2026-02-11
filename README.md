# YouTube Focus Mode Extension (MV3)

Extensão de navegador para reduzir distrações no YouTube, escondendo elementos como **Shorts**, recomendações e comentários.

## Recursos
- Alternar (liga/desliga) por item: Shorts, recomendações (Home/Related), comentários e barra lateral.
- Funciona via CSS + content script (sem login, sem scraping de dados).

## Como usar (Chrome/Edge)
1. Abra `chrome://extensions`.
2. Ative **Developer mode**.
3. Clique em **Load unpacked** e selecione a pasta do projeto (onde está o `manifest.json`).
4. Abra o YouTube e use o popup para ativar/desativar os filtros.

## Estrutura
- `manifest.json` (MV3)
- `src/content.js` injeta CSS conforme configurações
- `src/popup.*` UI rápida
- `src/options.*` página de configurações

## Aviso
Este projeto não automatiza ações no YouTube e não armazena credenciais.
