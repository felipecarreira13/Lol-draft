# Draft Rift

Site de draft competitivo de League of Legends. A versão deste pacote roda diretamente na Cloudflare ou no seu computador. Os capitães e espectadores entram pelos links da sala.

## Publicar na Cloudflare

Você precisa de uma conta Cloudflare com Workers e D1 e do Node.js 24 ou mais recente. Extraia o ZIP e abra o terminal na pasta que contém o arquivo wrangler.toml.

1. Entre na sua conta Cloudflare e crie o banco da aplicação.

   ~~~sh
   npx wrangler login
   npx wrangler d1 create draft-rift --update-config=false
   ~~~

2. No arquivo wrangler.toml, substitua COLE_AQUI_O_ID_DO_BANCO pelo database_id mostrado no terminal.
3. Crie a tabela de salas, gere o Worker e publique.

   ~~~sh
   npx wrangler d1 migrations apply DB --remote
   npm run build
   npx wrangler deploy
   ~~~

   Confirme a migração se o terminal pedir. No primeiro deploy, a Cloudflare pode pedir que você cadastre um subdomínio workers.dev.

4. Abra a URL workers.dev mostrada no terminal. Crie uma sala e use os convites gerados nesse endereço. O acesso de dono é guardado no navegador que criou a sala. Os convites dos capitães dão acesso aos controles dos respectivos times. Compartilhe o link de espectador com quem for só assistir.

Para publicar uma atualização, gere o Worker e rode npx wrangler deploy de novo. A configuração usa o banco indicado pelo database_id.

Referências oficiais: https://developers.cloudflare.com/d1/get-started/ e https://developers.cloudflare.com/workers/configuration/routing/workers-dev/

### Deploy pelo GitHub na Cloudflare

Nas configurações de build do Worker, use `npm run build` como comando de build e `npx wrangler deploy` como comando de deploy. O `wrangler.toml` também configura o build para execuções diretas do Wrangler.

Antes do primeiro deploy, crie o banco D1, preencha o `database_id` no `wrangler.toml` e execute `npx wrangler d1 migrations apply DB --remote`, conforme os passos acima.

## Rodar no seu computador

Abra um terminal nessa pasta, rode npm start e acesse http://127.0.0.1:4173. As salas locais são salvas em rooms.sqlite.

Para jogar em dispositivos na mesma rede, use no PowerShell:

~~~powershell
$env:DRAFT_HOST = '0.0.0.0'
npm.cmd start
~~~

Use o endereço de rede mostrado no terminal para abrir a página e criar a sala. Mantenha o servidor rodando durante o draft. Os dispositivos precisam de acesso ao servidor local e de internet para carregar as imagens e fontes.

## Verificar

npm test verifica as permissões, a prontidão dos capitães, a ordem dos 20 turnos, os modos Padrão, Fearless e Ironman e o comportamento do cronômetro.

Draft Rift é um projeto de fãs. League of Legends e suas imagens pertencem à Riot Games.
