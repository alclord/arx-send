# WA Bulk Sender — App Local

Envie mensagens e arquivos para múltiplos contatos e grupos do WhatsApp,
conectando pelo QR code igual ao WhatsApp Web.

## Requisitos

- **Node.js** versão 18 ou superior → https://nodejs.org
- **Google Chrome** instalado (usado internamente pelo Puppeteer)

## Instalação

1. Extraia a pasta `wa-sender`
2. Abra o terminal dentro da pasta
3. Instale as dependências:

```bash
npm install
```

> A primeira instalação pode demorar alguns minutos (baixa o Chromium)

## Uso

1. Inicie o servidor:

```bash
npm start
```

2. Abra o navegador em: **http://localhost:3000**

3. Clique em **"Conectar"** e escaneie o QR code com o WhatsApp do celular:
   - Abra o WhatsApp → ⋮ Menu → Dispositivos conectados → Conectar um dispositivo

4. Seus contatos e grupos carregarão automaticamente

5. Selecione os destinatários, escreva a mensagem (e/ou anexe um arquivo) e dispare!

## Funcionalidades

- ✅ Conecta pelo QR code (sem precisar do WhatsApp Web aberto)
- ✅ Lista todos os contatos e grupos
- ✅ Filtro e busca de contatos
- ✅ Envio de texto, arquivo ou texto+arquivo
- ✅ Intervalo configurável entre envios
- ✅ Progresso em tempo real
- ✅ Botão de parar o disparo
- ✅ Sessão salva (não precisa escanear QR toda vez)

## ⚠️ Aviso

Use com responsabilidade. Disparos em massa podem resultar em banimento pelo WhatsApp.
Recomendamos intervalos maiores (5s+) e listas menores para uso pessoal.
