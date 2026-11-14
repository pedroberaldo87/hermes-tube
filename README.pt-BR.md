# HermesTube

<div align="center">

# Retome o seu feed.

As suas inscrições do YouTube dentro do Hermes Agent.<br>Você e o seu agente decidem o que você assiste. Não o algoritmo.

[English](README.md) · **Português**

[![GitHub stars](https://img.shields.io/github/stars/pedroberaldo87/hermes-tube?style=for-the-badge&logo=github)](https://github.com/pedroberaldo87/hermes-tube/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg?style=for-the-badge)](LICENSE)
![Hermes Agent ≥ 0.23.1](https://img.shields.io/badge/Hermes%20Agent-%E2%89%A5%200.23.1-blueviolet?style=for-the-badge)
![Chrome 120+, Manifest V3](https://img.shields.io/badge/Chrome-120%2B%20%C2%B7%20Manifest%20V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)

[Funcionalidades](#funcionalidades) · [Instalação](#instalação) · [Uso](#uso) · [Privacidade](#privacidade-e-divulgação) · [Como funciona](#como-funciona)

**Se o HermesTube for útil para você, uma estrela neste repositório ajuda outras pessoas a encontrá-lo.**

</div>

![Imagem de capa do HermesTube com o nome do projeto](assets/hermes-tube.jpg)

<table>
<tr>
<td width="50%" valign="top">
<h3>Organizado do seu jeito</h3>
<p>Pastas, tags e as suas próprias abas. Veja de relance o que saiu de novo nos canais que importam.</p>
<h3>Os seus dados ficam no seu computador</h3>
<p>Não há cadastro nem servidor nosso: não coletamos nada.</p>
</td>
<td width="50%" valign="top">
<h3>O seu modelo faz a parte chata</h3>
<p>Ele sugere pastas e monta uma aba inteira a partir de um assunto que você digita.</p>
<h3>Nunca sem o seu clique</h3>
<p>Uma pequena extensão de navegador conecta a sua conta do YouTube. Ela nunca cancela inscrição nenhuma sem o seu clique.</p>
</td>
</tr>
</table>

![A seção Subscriptions do HermesTube no Hermes Desktop com dados de exemplo: a barra de abas no alto, a aba de todos os vídeos novos selecionada e uma grade de vídeos novos, cada cartão com uma linha dizendo por que está ali](docs/screenshots/home.png)

<p align="center"><sub>Todas as imagens usam dados de exemplo inventados para o projeto: canais e vídeos fictícios, nenhuma conta real. A interface nas imagens está em inglês.</sub></p>

## Sobre

| O HermesTube faz | O HermesTube não faz |
|:---|:---|
| Acrescenta uma página ao Hermes Desktop, ferramentas para o agente, o comando `/tube` e rotinas opcionais | Não cancela inscrições sozinho: a IA, as ferramentas e as rotinas só montam listas |
| Mexe na sua conta do YouTube só por uma extensão do Chrome que você carrega | Não usa nuvem, conta, chave de API própria nem telemetria |
| Funciona em inglês e em português do Brasil | Não baixa vídeos |
| Ajuda mais quem já usa o Hermes com um modelo configurado | Ainda não está na Chrome Web Store: o plugin traz a extensão |

> [!WARNING]
> O HermesTube não usa a API oficial do YouTube. Os Termos de Serviço do YouTube podem não permitir esse tipo de acesso automatizado: use por sua conta e risco.

> [!NOTE]
> **Experimental:** a Faxina, o Telegram, as rotinas, os cartões de vídeo no chat e a barra no youtube.com só rodaram por inteiro numa conta real. [O que rodou](#funcionalidades)

## Funcionalidades

<table>
<tr>
<td width="50%" valign="top">
<p align="center">
<img src="docs/screenshots/organize-suggestions.png" alt="O diálogo Organize with Hermes com dados de exemplo: sugestões de pasta agrupadas por pasta, cada grupo com os botões Reject group e Accept group, e um botão Accept all; nada muda até você aceitar" width="100%">
</p>
<h3>Organizar com o Hermes</h3>
<p>O seu modelo propõe pastas e tags. Nada muda até você aceitar.</p>
<ul><li>Aceite ou rejeite por grupo</li><li>Pastas aninhadas e pastas favoritas</li></ul>
<p><kbd>Desktop</kbd> <kbd>IA</kbd></p>
</td>
<td width="50%" valign="top">
<p align="center">
<img src="docs/screenshots/topic-tab-building.png" alt="O diálogo de nova aba por assunto enquanto a aba é montada, com dados de exemplo: a lista de etapas (expandir o assunto, buscar no YouTube, selecionar com IA, montar a prévia) e espaços vazios para a prévia" width="100%">
</p>
<h3>Abas por assunto</h3>
<p>Digite um assunto. O modelo busca no YouTube e fica com o que serve.</p>
<ul><li>Diz por que cada vídeo está na aba</li><li>Filtros: Shorts, não vistos, duração</li></ul>
<p><kbd>Desktop</kbd> <kbd>IA</kbd></p>
</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">
<p align="center">
<img src="docs/screenshots/manage.png" alt="A tabela Manage com vários canais selecionados e a barra de ações em lote" width="100%">
</p>
<h3>Manage, com desfazer</h3>
<p>Todos os canais numa tabela, com ações em lote.</p>
<ul><li>Último vídeo, ritmo, fatia de Shorts</li><li>Desfazer, histórico e backup</li></ul>
<p><kbd>Desktop</kbd></p>
</td>
<td width="50%" valign="top">
<p align="center">
<img src="docs/screenshots/watching-tab.png" alt="Um vídeo tocando na seção Watch do HermesTube, no player embutido do próprio Hermes, com o título e o canal embaixo" width="100%">
</p>
<h3>Assistir dentro do Hermes</h3>
<p>Os vídeos tocam dentro do Hermes, no player dele.</p>
<ul><li>Visto, depois, arquivar, não é pra mim</li><li>⌘/Ctrl-clique abre no YouTube</li></ul>
<p><kbd>Desktop</kbd></p>
</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">
<p align="center">
<img src="docs/screenshots/cleanup.png" alt="A seção Cleanup com dados de exemplo: canais agrupados pelo motivo (Not watched, Off your profile), dois deles marcados, o botão Review cancellation (2) e a lista Ex-subscriptions vazia" width="100%">
</p>
<h3>Faxina, só com o seu clique</h3>
<p>Regras listam canais parados. O modelo diz por quê.</p>
<ul><li>Nada é cancelado antes do Run now</li><li>Reinscrição possível por 30 dias</li></ul>
<p><kbd>Desktop</kbd> <kbd>IA</kbd> <kbd>Extensão</kbd></p>
</td>
<td width="50%" valign="top">
<p align="center">
<img src="docs/screenshots/playlists.png" alt="A aba Playlists do HermesTube com dados de exemplo: uma playlist, Weekend watchlist, com a capa e uma linha dizendo que ela fica no HermesTube neste computador, não na sua conta do YouTube" width="100%">
</p>
<h3>Playlists</h3>
<p>Adicione qualquer vídeo pelo cartão ou pelo player.</p>
<ul><li>Tocar tudo, renomear, apagar</li><li>Ficam no seu computador, não no YouTube</li></ul>
<p><kbd>Desktop</kbd></p>
</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top">
<p align="center">
<img src="docs/screenshots/folder-pane.png" alt="O painel de pastas ao lado do Hermes Desktop com pastas, canais e contagem de vídeos novos" height="300">
<img src="docs/screenshots/youtube-sidebar.png" alt="A seção do HermesTube no menu lateral do YouTube, acima de Inscrições, com pastas e contagem de vídeos novos" height="300">
</p>
<h3>As suas pastas, em todo lugar</h3>
<p>Um painel de pastas no Hermes e uma barra no youtube.com.</p>
<ul><li>Edite as pastas pela barra, com Desfazer</li><li>Um cartão no canal para seguir ou guardar</li></ul>
<p><kbd>Desktop</kbd> <kbd>Extensão</kbd> <kbd>Novo na 0.2.0</kbd></p>
</td>
<td width="50%" valign="top">
<p align="center">
<img src="docs/screenshots/telegram-favorite.png" alt="Um alerta de favoritos no Telegram com dados de exemplo: a capa do vídeo, o canal, o título e o link" width="100%">
</p>
<h3>Telegram e rotinas</h3>
<p><code>/tube</code> com botões, mais nove ferramentas para o agente.</p>
<ul><li>Cinco rotinas; quatro sem modelo</li><li>Vídeos novos dos favoritos, com capa</li></ul>
<p><kbd>Telegram</kbd></p>
</td>
</tr>
</table>

<details>
<summary><b>Lista completa, mais telas e o que foi testado</b></summary>

**Mais telas**


![O diálogo de nova aba por assunto mostrando a prévia: os vídeos que ficaram, por que cada um serve e os canais por trás deles](docs/screenshots/theme-tab-preview.png)


**Todas as funcionalidades**

- Uma seção Subscriptions com abas prontas (All new, Favorites, Watch later) e abas que você cria: Category (pastas e tags), Channels, Topic ou Mixed.
- Filtros por aba: esconder Shorts, só não vistos, vídeos por canal, duração.
- Uma linha em cada vídeo dizendo por que ele está na aba (pasta, tag, canal ou assunto).
- Marcar como visto, guardar para depois, arquivar, "não é para mim".
- Painel de pastas aninhadas com contagem de vídeos novos, um contador na barra de status e comandos na paleta.
- Pastas favoritas, além dos canais favoritos, e a visão Only favorites no painel de pastas e na barra do youtube.com.
- Tabela Manage (pasta, tags, último vídeo, ritmo, parcela de Shorts, o que você assistiu, relação) com ações em lote. Cada mudança mostra um botão Desfazer por alguns segundos.
- Histórico das mudanças em canais e pastas, com Desfazer, e um backup que você exporta e importa (More actions, em Manage: History, Export backup, Import backup…).
- Seguir um canal sem se inscrever: cole o link de um canal, o link de um vídeo ou um @handle.
- Organizar com o Hermes: sugestões de pasta e tag do seu modelo no Hermes, aceitas ou recusadas por grupo.
- Faxina com aprovação (parados, não assistidos, fora do seu perfil, marcados por você) e Ex-inscrições com Reinscrever por 30 dias.
- Abas por assunto montadas pelo seu modelo no Hermes a partir dos resultados de busca do YouTube.
- Os vídeos tocam na seção Watch, no player embutido do próprio Hermes, com o consentimento de embeds do app.
- Playlists: Add to playlist em qualquer cartão de vídeo ou no player, e uma aba Playlists com Play all, renomear e apagar. Ficam no banco do plugin; nada é gravado na sua conta do YouTube.
- Nove ferramentas do agente, cartões de vídeo no chat do Desktop e `/tube` com botões no Telegram.
- Cinco rotinas no agendador do próprio Hermes; quatro delas não usam modelo.
- Dados de demonstração: 40 canais públicos em 6 pastas, sem mexer na sua conta.
- Extensão do Chrome: sincroniza as inscrições, registra o que você assiste, põe uma barra no youtube.com e faz os cancelamentos aprovados.
- A barra do youtube.com fica no menu do YouTube, presa à direita ou escondida, recolhe e abre com um atalho de teclado. Você escolhe o lugar na própria barra, no popup da extensão ou no Hermes, em In the browser.
- Modo Edit na barra: mudar a ordem das pastas, mover canais e marcar favoritos, com Desfazer.
- Um cartão nas páginas de canal para seguir o canal no HermesTube, marcar como favorito ou pôr numa pasta; nas páginas de vídeo, também Watch later e Add to playlist.
- O Hermes avisa quando um navegador conectado ainda roda uma cópia mais antiga da extensão.
- Inglês e português do Brasil no `/tube`, nas rotinas, na extensão e nos nomes que a IA escreve. As páginas do Desktop seguem o app e hoje ficam em inglês.

**O que rodou de ponta a ponta**

- **No Chrome de verdade, no macOS, numa conta do YouTube com a interface em português do Brasil e de uma a três inscrições:** a leitura das inscrições, o cancelamento e a reinscrição pela extensão e, na 0.2.0, a barra nos três lugares, recolher a barra, o atalho de teclado, o modo Edit com mudança de ordem e Desfazer, os favoritos e o Only favorites, o cartão do canal (seguir, favoritar, mover, pasta nova), o History com o desfazer de uma mudança feita no navegador e o Export backup.
- **Numa conversa real do Telegram:** `/tube` status e abas, a triagem com os botões, a faxina com a lista vazia, a instalação das rotinas e a mensagem do resumo da manhã.
- **Ainda sem rodar num app de verdade:** o Import backup, arrastar e soltar na barra, digitar o nome de uma pasta com um editor de métodos de entrada (IME) e o Windows.
- **Feitos e cobertos por testes automáticos, mas também ainda sem rodar de ponta a ponta:** as mensagens das outras quatro rotinas, o `/tube assunto` no Telegram, os cartões de vídeo no chat do Desktop, adicionar um canal pelo link, outros idiomas da interface do YouTube e listas longas de inscrições.
- Trate todos como experimentais.

Os nomes das telas e dos botões ficam em inglês aqui porque as imagens e o guia de instalação usam a interface em inglês. O texto em português das páginas vai junto com o plugin e só aparece se o Hermes Desktop rodar em português; hoje ele não tem essa opção.

</details>

## Instalação

| Você precisa de | Observação |
|:---|:---|
| **Hermes Agent 0.23.1** ou mais novo | com o Hermes Desktop |
| **Um modelo** configurado no Hermes | só para os recursos de IA |
| **Um navegador Chromium** com a conta do YouTube aberta | Chrome 120 ou mais novo, Edge, Brave, Vivaldi, Opera, Arc |
| **macOS ou Linux** | Windows: procuramos quem teste |
| **git** | a instalação clona o repositório |

> [!IMPORTANT]
> Instale o HermesTube no Hermes do computador onde está o seu navegador: a extensão só conversa com o Hermes do próprio computador.

1. **Instale o plugin.**

   ```bash
   hermes plugins install pedroberaldo87/hermes-tube/plugin --enable
   ```

   O Hermes avisa que é uma "custom (unreviewed) source": é o esperado para um plugin instalado de um repositório.

2. **Abra o HermesTube** na barra lateral: carregue a demonstração, cole um canal ou conecte a extensão.

3. **Configure a extensão.** Aperte **Set up the extension**; depois ligue o Developer mode no navegador e arraste a pasta para a página de extensões.

4. **Faça o pareamento.** Digite o código de 6 dígitos do Hermes na aba que a extensão abre e aperte Connect.

<p align="center">
<img src="docs/screenshots/connect-pairing.png" alt="A tela de conexão do HermesTube com dados de exemplo: um código de pareamento para digitar na extensão do navegador e os três passos (abrir a extensão, ler as suas inscrições, pronto)" width="620">
</p>

- O guia completo, com solução de problemas e como remover tudo, está em [docs/user/install.md](docs/user/install.md) (em inglês).
- Para remover o plugin: `hermes plugins remove hermes-tube` (remova antes as rotinas, se tiver instalado).

<details>
<summary><b>Se algo der errado, requisitos em detalhe e como gerar a extensão</b></summary>

**Os passos por inteiro**

- Se o seu Hermes Desktop está ligado a um gateway de outro computador, troque para This device antes de abrir o HermesTube.
- Configure a extensão do navegador: no HermesTube, escolha "Connect the browser extension", escolha o navegador se o Hermes achar mais de um e aperte **Set up the extension**.
- O plugin já traz a extensão pronta; o Hermes copia a extensão para uma pasta `HermesTube Extension` na sua pasta pessoal e abre a página de extensões desse navegador e a pasta.
- Depois o navegador precisa de dois cliques seus: ligar o Developer mode e arrastar a pasta para a página (ou escolher Load unpacked e selecionar a pasta).
- A tela sempre mostra esses passos, o endereço e o caminho da pasta com botões de copiar, então dá para fazer à mão também; se travar, **Ask Hermes to help** abre uma conversa com um pedido pronto, que você lê e envia.
- Mais tarde, o mesmo botão atualiza a extensão.
- Se você está atualizando da 0.1, reinicie o Hermes uma vez ([como atualizar](docs/user/install.md#updating), em inglês).
- Faça o pareamento: na mesma tela aparece um código de 6 dígitos (vale 5 minutos e só uma vez).
- Digite o código na aba que a extensão abre quando é carregada (ou no popup dela) e aperte Connect.

**Se algo não aparecer**

- Quando a entrada no catálogo estiver no ar, `hermes plugins install hermes-tube` também funciona no macOS e no Linux (até lá ele diz que o plugin não está no catálogo).
- Sem o `--enable`, responda "sim" ao "Enable now?" ou ligue o plugin no Hermes Desktop em Capabilities → Plugins.
- Se o HermesTube não aparecer na barra lateral do Desktop, abra Capabilities → Plugins e ligue a chave Desktop da linha do HermesTube.
- Se as ferramentas ou o `/tube` não aparecerem, reinicie o gateway: `hermes gateway restart`.
- Se der errado: "The plugin isn't on in …" (no painel lateral ou na tela principal), ou um diálogo de conexão dizendo que você está conectado a outro computador, quer dizer que o Desktop está num perfil ou num gateway sem o plugin.
- Troque o Desktop para This device, volte ao perfil onde instalou, ou ligue o plugin em Capabilities → Plugins.

**Requisitos em detalhe**

- Hermes Agent 0.23.1 ou mais novo, com o Hermes Desktop para as páginas.
  - `hermes --version` mostra a sua versão; a [documentação do Hermes](https://hermes-agent.nousresearch.com/docs) (em inglês) explica como instalar ou atualizar.
- Um modelo de IA configurado no Hermes para os recursos de IA (organizar, motivos da faxina, abas por assunto, a rotina de resumo por pasta).
  - O resto funciona sem modelo.
- Para a extensão: um navegador Chromium no mesmo computador do Hermes, com a conta do YouTube aberta — Chrome 120 ou mais novo, Edge, Brave, Chromium, Vivaldi, Opera ou (no macOS) Arc.
  - O teste do dia a dia é no Chrome, no macOS; o guia de instalação diz o que já foi experimentado em cada sistema.
- Sistemas: macOS (uso diário) e Linux (rodado num contêiner Debian, também sem tela).
  - O Windows, com o Hermes dentro do WSL 2 (o jeito comum) ou instalado direto, só foi conferido por testes automáticos e por um contêiner Linux que imita o WSL: ainda não rodou num Windows de verdade.
  - Procuramos quem teste no Windows: se você rodar no Windows, abra uma issue dizendo o que funcionou e o que quebrou.
  - Pull requests são bem-vindos.
  - O guia de instalação tem os detalhes, inclusive o que fazer quando o navegador no Windows não alcança o Hermes dentro do WSL.
- git (a instalação clona o repositório).
  - Num Linux mínimo, o instalador do Hermes também precisa do `libatomic1`.
  - Node.js 22 ou mais novo só se você mesmo gerar a extensão.

**Gerar a extensão você mesmo**

```bash
git clone https://github.com/pedroberaldo87/hermes-tube
cd hermes-tube
npm ci
EXT_DIST_DIR=extension/dist npm run build:ext
```

- No navegador, abra a página de extensões (`chrome://extensions`, `edge://extensions`, …), ligue o Developer mode, escolha Load unpacked e selecione a pasta `extension/dist`.

</details>

## Configuração

- Os ajustes ficam no Hermes, por perfil: Capabilities → Plugins, engrenagem na linha do HermesTube.
- Eles estão declarados em `plugin/plugin.yaml`.

<details>
<summary><b>Os cinco ajustes e os seus padrões</b></summary>

| Ajuste | Padrão | O que faz |
|---|---|---|
| RSS refresh interval (minutes) | 30 | tempo mínimo entre as buscas automáticas de vídeos novos (5 ou mais) |
| Language | `auto` | `en`, `pt-BR` ou `auto`; `auto` segue o app nas páginas e o idioma de exibição do Hermes (`display.language`) no `/tube`, nas ferramentas e nas rotinas, com inglês quando não há informação |
| Keep ex-subscriptions (days) | 30 | por quanto tempo os canais cancelados ficam em Ex-inscrições |
| Topic tabs refresh (days) | 7 | gravado em cada aba por assunto nova; esta versão não atualiza as abas por assunto sozinha |
| Mascot announces favorites | ligado | o mascote mostra um aviso curto quando um canal favorito publica um vídeo novo |

- Os recursos de IA rodam numa tarefa própria do plugin, que aparece em Settings → Models como "YouTube curator"; assim dá para usar nela um modelo diferente do chat.
- O plugin não precisa de chave de API nem de variável de ambiente.

</details>

## Uso

| Onde | Experimente |
|:---|:---|
| **Hermes Desktop** | Abra o HermesTube na barra lateral e clique num vídeo para assistir |
| **Chat** | "O que saiu hoje no YouTube?" · "Monta uma aba sobre café espresso em casa" |
| **Telegram** | `/tube` · `/tube triage` · `/tube cleanup`<br>`/tube topic <assunto>` · `/tube routines` |
| **youtube.com** | As suas pastas numa barra do HermesTube, e um cartão em cada página de canal |

**Guias (em inglês):** [instalação](docs/user/install.md) · [Telegram](docs/user/telegram.md)

<details>
<summary><b>O uso, por inteiro</b></summary>

**Desktop**

- O HermesTube na barra lateral abre a página do HermesTube na seção Subscriptions.
- Manage e Cleanup são seções da mesma página do HermesTube, e o painel Subscriptions mostra a sua árvore de pastas.
- Clique num vídeo para assistir na seção Watch, ou use ⌘/Ctrl-clique para abrir no YouTube.

**Chat**

- Pergunte "o que saiu hoje no YouTube?", "por que não vejo mais o canal X?" ou "monta uma aba sobre café espresso em casa".
- O Hermes usa as nove ferramentas `tube_*` do plugin.
- Elas nunca aprovam um cancelamento.

**`/tube`**

- Um resumo em qualquer chat.
- No Telegram (ou em outra plataforma de mensagens do Hermes com botões): `/tube triage`, `/tube cleanup`, `/tube topic <assunto>`, `/tube routines` (os subcomandos em português, como `/tube faxina`, também funcionam).
- Use numa conversa direta com o seu bot, não num grupo.
- Veja [docs/user/telegram.md](docs/user/telegram.md).

**Rotinas**

- Cinco rotinas agendadas (resumo da manhã, favoritos, resumo por pasta, lista mensal da faxina, canais novos sem pasta), instaladas pelo Telegram com uma confirmação.
- No Telegram, cada vídeo novo dos favoritos chega como uma mensagem com a capa do vídeo, o canal, o título e o link (testado no Telegram; as outras plataformas ficam com a entrega comum do cron).
- As rotinas nunca falam dos canais do modo demonstração.

**Extensão**

- Sincroniza as inscrições no pareamento, a cada 6 horas e no Sync now; registra os vídeos que você assiste; põe uma barra do HermesTube no YouTube, onde você também organiza pastas e canais; faz os cancelamentos que você aprovou, um por vez, numa aba visível, com um botão Stop.

</details>

## Privacidade e divulgação

| O quê | Em resumo |
|:---|:---|
| **A sua biblioteca** | Um banco SQLite no seu perfil do Hermes |
| **O que o plugin lê** | Páginas públicas do `www.youtube.com`, sem login |
| **O que a IA envia** | Nomes de canais, títulos de vídeos e nomes de pastas, ao seu modelo no Hermes |
| **A extensão** | Só fala com o plugin em `127.0.0.1`, no navegador com a sua conta aberta |
| **Telemetria** | Nenhuma: sem analytics, sem servidor nosso |

- Cada ação, com o arquivo por trás: [Disclosure no plugin/README.md](plugin/README.md#disclosure) (em inglês).

<details>
<summary><b>A lista completa</b></summary>

- O plugin lê só páginas públicas de `www.youtube.com` (e, para a capa dos favoritos, imagens de `i.ytimg.com`), sem login: os feeds RSS dos canais, as páginas dos canais, as playlists de envios e de Shorts de cada canal, as páginas `/shorts/<id>` e `/watch` para saber a duração de cada vídeo recente e se ele é um Short, e a página de busca para as abas por assunto.
  - As páginas do Desktop carregam as miniaturas de `i.ytimg.com` e os avatares dos canais dos endereços que o YouTube informa.
- Seus dados ficam num banco SQLite dentro do perfil do Hermes (na pasta `plugin-data/` do perfil).
  - Os recursos de IA mandam nomes de canais, títulos de vídeos e os nomes das suas pastas para o modelo que você configurou no Hermes, inclusive a partir de jobs agendados criados com os blueprints de automação do plugin, que rodam sem ninguém presente.
- A extensão conversa só com o servidor local do plugin em `127.0.0.1` (portas 47615 a 47624) e age só no seu navegador, com a sua sessão.
- Sem telemetria, sem analytics, sem servidor nosso.

</details>

## Como funciona

| **youtube.com** | ⇄ **Extensão** | ⇄ **Plugin HermesTube** | ⇄ **Hermes Desktop, chat, Telegram** |
|:-:|:-:|:-:|:-:|
| no seu navegador | pareada, só fala com 127.0.0.1 | Python, dentro do Hermes | página, ferramentas, /tube, rotinas |

- **Guarda:** um banco SQLite no seu perfil do Hermes
- **Pensa com:** o seu modelo no Hermes, só nos recursos de IA
- **Lê:** páginas públicas do YouTube, sem login

<details>
<summary><b>As partes, e os arquivos por trás de cada uma</b></summary>

**Plugin** (`plugin/`, Python, roda dentro do Hermes)

- rotas REST para as páginas do Desktop (`plugin/dashboard/plugin_api.py`, `plugin/api/`), métodos RPC para tarefas longas e aprovações (`plugin/rpc/`), ferramentas do agente (`plugin/tools/`), o comando `/tube` (`plugin/commands.py`), rotinas e blueprints (`plugin/routines/`, `plugin/blueprints.py`) e um hook `pre_llm_call` para o cartão de vídeo no chat.
- Os dados vão para o SQLite pelo armazenamento de plugins do Hermes (`plugin/adapters/storage.py`)
- as páginas do YouTube são lidas com a biblioteca padrão (`plugin/core/youtube.py`, `plugin/core/http.py`)
- as chamadas ao modelo passam pelo Hermes (`plugin/adapters/hermes_llm.py`).

**Páginas do Desktop** (`desktop-src/`, TypeScript e React sobre o SDK de plugins do Hermes Desktop)

- geradas com esbuild, sem minificar, em `plugin/desktop/plugin.js`, que o Hermes Desktop carrega.

**Extensão** (`extension/`, Manifest V3, Preact, gerada com Vite)

- lê o youtube.com no seu navegador e conversa com um pequeno servidor HTTP que o plugin liga sob demanda em `127.0.0.1` (`plugin/ext/_server.py`), depois do pareamento com um código.

**Contrato compartilhado**

- a API REST (`contract/api.yaml`), o esquema do banco (`contract/schema.sql`), o protocolo da extensão (`contract/ext-protocol.md`) e os tipos gerados a partir deles (`shared/`).

- O catálogo de plugins do Hermes instala só a pasta `plugin/`.
- Ela leva uma cópia pronta da extensão (`plugin/extension/`, gerada de novo com `npm run build:ext:plugin`), que o botão "Set up the extension" copia para fora; o código-fonte da extensão fica em `extension/`.

</details>

## Desenvolvimento

- Você precisa de um checkout do Hermes Agent com `hermes` no PATH, do [uv](https://docs.astral.sh/uv/) e do Node.js 22+.
- Detalhes em [CONTRIBUTING.md](CONTRIBUTING.md) (em inglês).

```bash
make venv              # .venv com o Python do Hermes mais pytest e ruff
npm ci
scripts/check          # todas as checagens: lint, testes, tipos, builds, catálogo
scripts/check --fast   # o mesmo sem os builds
npm run typecheck      # só o tsc
npm run test:js        # só o vitest
```

<details>
<summary><b>Variáveis de ambiente e notas sobre os testes</b></summary>

- `HERMES_SRC` aponta para o checkout do Hermes Agent (padrão `$HOME/.hermes/hermes-agent`); `TUBE_PY` troca o Python que o `scripts/check` usa.
- `HERMES_TUBE_DEV_PROFILE=<perfil> make link-dev` liga `plugin/` a um perfil do Hermes que você usa para desenvolver e habilita o plugin; `make status` lista os plugins desse perfil. Use um perfil descartável.
- Os testes usam páginas salvas ou sintéticas, não a rede. Os testes que usam a rede levam o marcador `live` e ficam de fora por padrão.

</details>

## Segurança

- Relate vulnerabilidades em particular, como explica o [SECURITY.md](SECURITY.md) (em inglês).
- Ele também lista o que o plugin e a extensão tocam.

## Contribuindo

- Issues e pull requests são bem-vindos.
- Veja o [CONTRIBUTING.md](CONTRIBUTING.md) e o [Código de Conduta](CODE_OF_CONDUCT.md) (em inglês).

## Licença

MIT, ver [LICENSE](LICENSE). Copyright (c) 2026 Pedro Beraldo.

*Autor.* Pedro Beraldo: [GitHub](https://github.com/pedroberaldo87) · [X](https://x.com/PedroBeraldo)

Projeto independente: sem ligação com o YouTube, o Google ou a Nous Research, e sem endosso deles.

<details>
<summary><b>Créditos e avisos</b></summary>

**De onde vem**

- O HermesTube continua o MyTube (github.com/pedroberaldo87/MyTube), extensão do Chrome do mesmo autor que organizava as inscrições dentro do youtube.com.
- O MyTube foi publicado sob GPL-3.0; o código trazido dele é relicenciado sob MIT pelo seu único autor.

**Como foi feito**

- O HermesTube foi feito com o próprio Hermes Agent.
- Pedro Beraldo definiu o produto, registrou as decisões e decidiu o que vai a público.
- Um agente de IA transformou isso num plano e em mais de 80 roteiros de tarefa escritos; cada roteiro foi executado por uma sessão separada do Hermes Agent com um modelo Claude, num worktree git próprio, com os testes escritos primeiro.
- O trabalho entrou depois de revisado, e o check completo do projeto (testes, checagem de tipos, validador do catálogo) controla o que vai a público.

**O que é do Hermes**

- O Hermes Agent e o Hermes Desktop são da Nous Research (MIT).
- O HermesTube usa as interfaces de plugin deles.
- O player de vídeo é o player embutido do próprio Hermes Desktop; o plugin só passa o link do vídeo.
- É um projeto independente, sem ligação com a Nous Research nem endosso dela.

**Código de terceiros**

- O plugin em Python e o código do Desktop não embutem biblioteca de terceiros: o código do Desktop importa só o que o Hermes Desktop fornece na hora.
- A extensão do navegador, que o plugin também traz pronta, embute o Preact (MIT).
- Ver THIRD_PARTY_NOTICES.md.

**YouTube**

- YouTube é marca registrada da Google LLC.
- O HermesTube não tem ligação com o YouTube nem com o Google, nem endosso deles.
- Ele lê páginas públicas do YouTube e age só no seu próprio navegador.
- A demonstração lista 40 canais públicos do YouTube pelo nome; eles não têm relação com este projeto.

**Hackathon**

- Feito para o Hermes Agent Plugin Hackathon (novembro de 2026).

</details>

Textos de licença do código de terceiros: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
