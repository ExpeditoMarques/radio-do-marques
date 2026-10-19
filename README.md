# Rádio do Marquês — Render gratuito

Versão de teste que reúne Node.js, FFmpeg e Icecast em um único contêiner Docker. Inclui player público e painel para transmissão pelo microfone do navegador.

## Implantar no Render

1. Envie todos os arquivos e pastas deste projeto para a raiz do repositório GitHub.
2. No Render, escolha **New + → Blueprint** e selecione o repositório; ou crie um Web Service com runtime **Docker**.
3. Se usar Blueprint, o `render.yaml` configura o serviço e gera automaticamente os tokens e senhas.
4. Aguarde o deploy ficar `Live`, abra o endereço `.onrender.com` e teste o player.
5. Para transmitir, abra o painel do locutor e use o valor de `BROADCAST_TOKEN` em Environment no painel do Render. Guarde esse segredo; não o publique.

## Recursos

- Player público em `/`, fluxo de áudio em `/stream/live.mp3`.
- Painel de locutor com acesso ao microfone via HTTPS.
- WebSocket autenticado por `BROADCAST_TOKEN`.
- FFmpeg converte WebM/Opus em MP3 e envia ao Icecast interno.
- Health check em `/health`.

## Limitações do plano gratuito

- O Render pode suspender um Web Service gratuito após 15 minutos sem tráfego de entrada; quando alguém acessa novamente, pode levar cerca de um minuto para acordar.
- O serviço pode reiniciar a qualquer momento. Uma transmissão ao vivo pode cair e precisar ser iniciada de novo.
- O sistema de arquivos é efêmero: não use para guardar gravações ou arquivos permanentes.
- CPU/RAM são limitadas (plano gratuito típico: 0,1 CPU e 512 MB RAM); o FFmpeg pode ficar sobrecarregado com áudio contínuo.
- Não é recomendado para uma rádio 24/7 ou audiência grande. A banda de saída consumida pelo áudio conta para os limites do Render.
- O player e o painel usam o mesmo serviço. Quando o serviço dorme, o áudio ao vivo para.

## Segurança

- Não envie `.env` ao GitHub e nunca compartilhe o `BROADCAST_TOKEN` publicamente.
- O endpoint de transmissão permite apenas um locutor por vez.
- A transmissão é pública. Avise as pessoas antes de ativar o microfone.
- Este projeto foi preparado para servir como base de teste; valide os logs e faça testes com dois dispositivos antes de divulgar.

## Rodar localmente

Copie `.env.example` para `.env`, preencha senhas fortes e execute:

```bash
docker build -t radio-do-marques .
docker run --rm -p 10000:10000 --env-file .env radio-do-marques
```

Abra `http://localhost:10000`. O microfone em produção deve usar HTTPS; `localhost` é uma exceção segura nos navegadores.
