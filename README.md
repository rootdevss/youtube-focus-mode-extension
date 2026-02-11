# YouTube Focus Mode Extension (MV3)

Extensão de navegador para deixar o YouTube mais “limpo” e mais produtivo.

## O que tem agora (v0.2)
- Focus Mode (liga/desliga) para esconder Shorts, relacionados, comentários, menu lateral e feed da Home.
- Auto Theater (opcional): entra em modo teatro automaticamente ao abrir vídeos.
- Velocidade por canal (opcional): lembra sua velocidade de reprodução por canal (e pode aplicar uma velocidade padrão).
- Atalhos de teclado (opcional): ações rápidas direto na página.
- Notas por vídeo (opcional): painel flutuante para anotar + salvar timestamps.

## Como usar (Chrome/Edge)
1. Abra `chrome://extensions`.
2. Ative **Developer mode**.
3. Clique em **Load unpacked** e selecione a pasta do projeto (onde está o `manifest.json`).
4. Abra o YouTube e use o popup para ativar/desativar funções.

## Atalhos (quando habilitado)
- Shift+F: alternar Focus Mode (Ativado).
- Shift+N: abrir/fechar Notas.
- Shift+T: alternar Theater mode.
- Shift+↑ / Shift+↓: aumentar/diminuir velocidade (0.25x).

## Estrutura
- `manifest.json` (MV3)
- `src/content.js` injeta CSS e implementa melhorias (theater, velocidade, teclas, notas)
- `src/popup.*` UI rápida
- `src/options.*` página de configurações

## Aviso
Este projeto não automatiza ações no YouTube e não armazena credenciais.
