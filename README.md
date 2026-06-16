# ARX Send

Plataforma de disparo em massa via WhatsApp desenvolvida para a **ARX Administradora**.  
Conecta pelo QR code (igual ao WhatsApp Web) e permite enviar mensagens e arquivos para múltiplos contatos e grupos simultaneamente.

## Funcionalidades

- **Múltiplos telefones por sessão** — conecte até 10 chips diferentes em uma mesma sessão e escolha qual deles faz o envio
- **Multi-sessão** — várias pessoas usam ao mesmo tempo, cada uma com seu próprio conjunto de telefones
- **QR code** para autenticação, igual ao WhatsApp Web; sessão salva em disco (não precisa escanear toda vez)
- **Importação de planilha** — importe contatos de arquivos `.xlsx`, `.xls` ou `.csv`
- **Mensagens personalizadas** — use variáveis `{{NomeColuna}}` substituídas pelos dados de cada linha da planilha
- **Envio de texto, arquivo ou texto + arquivo** (imagens, vídeos, PDFs, documentos, áudio — até 64 MB)
- **Filtro e busca** de contatos e grupos por telefone selecionado
- **Intervalo configurável** entre envios: 2s, 3s, 5s, 8s ou 15s
- **Progresso em tempo real** via Socket.IO com log por contato
- **Botão Parar** para interromper o disparo a qualquer momento
- **Cache de contatos** — na reconexão a lista aparece instantaneamente
- **Watchdog automático** — reconecta sozinho se o WhatsApp travar durante a inicialização
- **Auto-atualização** — o app detecta e aplica novas versões automaticamente
- Interface responsiva com tema escuro

## Limites

| Item | Limite |
|---|---|
| Telefones por sessão | 10 |
| Tamanho do arquivo anexo | 64 MB |
| Linhas por planilha | 10.000 |
| Contatos por disparo | 5.000 |
| Tipos de arquivo aceitos | jpg, jpeg, png, gif, webp, bmp, mp4, mov, avi, mkv, 3gp, mp3, ogg, wav, aac, m4a, pdf, doc, docx, xls, xlsx, ppt, pptx, zip, txt |

## Instalação — Windows (executável)

Baixe o instalador `ARX-Send-Setup-x.x.x.exe` na aba [Releases](../../releases) e execute.  
O aplicativo instala e abre automaticamente. Não requer Node.js nem Chrome instalados.

## Instalação — execução local (Node.js)

**Requisitos:** Node.js 20+ e Google Chrome instalados.

```bash
git clone https://github.com/alclord/arx-send.git
cd arx-send
npm install
npm start
```

Acesse: **http://localhost:3000**

## Deploy — Oracle Cloud Always Free

### Requisitos do servidor
- Ubuntu 22.04
- Shape Ampere A1.Flex (4 OCPUs / 24 GB RAM)
- Node.js 20, PM2, Google Chrome

### Instalação no servidor

```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# PM2
sudo npm install -g pm2

# Projeto
git clone https://github.com/alclord/arx-send.git
cd arx-send
npm install

# Google Chrome
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo DEBIAN_FRONTEND=noninteractive dpkg -i google-chrome-stable_current_amd64.deb
sudo apt install -f -y

# Swap recomendado
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Iniciar
pm2 start src/server.js --name arx-send
pm2 save
pm2 startup
```

### Firewall

```bash
sudo ufw allow 22
sudo ufw allow 3000
sudo ufw enable
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 22 -j ACCEPT
```

## Como usar

1. Abra o app e digite o nome da sua sessão (ex: `yuri`, `suporte`, `vendas`)
2. Clique em **📱 Gerenciar** no header
3. Adicione um telefone com um nome (ex: "Celular Yuri") e clique em **Conectar**
4. Escaneie o QR code com o WhatsApp do celular
5. Repita para adicionar mais chips se necessário (até 10 por sessão)
6. Aguarde os contatos carregarem no painel esquerdo
7. **(Opcional)** Clique em 📊 para importar contatos de uma planilha
8. Selecione os destinatários, configure a mensagem, escolha o telefone em **Enviar de:** e clique em **🚀 Iniciar Disparo**

### Múltiplos telefones

Na aba **Disparar**, o seletor **Enviar de:** lista apenas os telefones já conectados.  
O painel de contatos mostra automaticamente as conversas do telefone selecionado para visualização.

### Mensagens personalizadas com planilha

Importe uma planilha com colunas como `Nome`, `Empresa`, `Vencimento`.  
Na mensagem, use `{{Nome}}`, `{{Empresa}}` etc. — cada envio substitui automaticamente pelos dados da linha correspondente.

Exemplo:
```
Olá, {{Nome}}! Sua fatura da {{Empresa}} vence em {{Vencimento}}.
```

## Desenvolvimento

```bash
# Rodar testes de unidade (normalização de telefone, personalização de mensagem, etc.)
npm test

# Rodar em modo Electron (desenvolvimento)
npm run electron

# Gerar instalador Windows
npm run build
```

Os testes cobrem as funções críticas em `src/utils/helpers.js` usando o runner nativo do Node.js (`node:test`) — sem dependências extras.

## Histórico de versões

| Versão | Destaque |
|---|---|
| **2.0.0** | Múltiplos telefones por sessão (até 10), seletor de chip no disparo, fix do QR code |
| 1.3.0 | Auto-updater customizado (asar-only) |
| 1.2.2 | Testes do auto-updater |
| 1.2.1 | Fix EADDRINUSE ao abrir segunda instância |

## Aviso

Use com responsabilidade. Disparos em massa podem resultar em banimento pelo WhatsApp.  
Recomendamos intervalos maiores (5s+) e listas menores.
