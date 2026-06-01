# ARX Send

Plataforma de disparo em massa via WhatsApp desenvolvida para a **ARX Administradora**.  
Conecta pelo QR code (igual ao WhatsApp Web) e permite enviar mensagens e arquivos para múltiplos contatos e grupos simultaneamente.

## Funcionalidades

- Multi-sessão — várias pessoas podem usar ao mesmo tempo, cada uma com seu próprio WhatsApp
- QR code para autenticação, igual ao WhatsApp Web
- Cache de contatos — na reconexão os contatos aparecem instantaneamente
- Envio de texto, arquivo ou texto + arquivo
- Filtro e busca de contatos e grupos
- Intervalo configurável entre envios (proteção contra banimento)
- Progresso em tempo real via Socket.IO
- Botão para parar o disparo a qualquer momento
- Interface responsiva com tema escuro

## Requisitos (execução local)

- **Node.js** 20 ou superior → https://nodejs.org
- **Google Chrome** instalado

## Instalação local

```bash
git clone https://github.com/alclord/arx-send.git
cd arx-send
npm install
npm start
```

Acesse: **http://localhost:3000**

## Deploy (Oracle Cloud Always Free)

A aplicação está configurada para rodar em servidor Linux com Google Chrome.

### Requisitos do servidor
- Ubuntu 22.04
- Shape Ampere A1.Flex (4 OCPUs / 24GB RAM) — Oracle Always Free
- Node.js 20, PM2, Google Chrome

### Instalação no servidor

```bash
# Instalar Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Instalar PM2
sudo npm install -g pm2

# Clonar o projeto
git clone https://github.com/alclord/arx-send.git
cd arx-send
npm install

# Instalar Google Chrome
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo DEBIAN_FRONTEND=noninteractive dpkg -i google-chrome-stable_current_amd64.deb
sudo apt install -f -y

# Criar swap (recomendado)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Iniciar com PM2
pm2 start src/server.js --name arx-send
pm2 save
pm2 startup
```

### Firewall

Liberar portas no Oracle Security List e no iptables:

```bash
sudo ufw allow 22
sudo ufw allow 3000
sudo ufw enable
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 22 -j ACCEPT
```

## Como usar

1. Acesse a URL do servidor no navegador
2. Digite o nome da sua sessão (ex: `yuri`, `suporte`, `vendas`)
3. Clique em **Conectar** e escaneie o QR code com o WhatsApp
4. Aguarde os contatos carregarem
5. Selecione os destinatários, escreva a mensagem e clique em **Disparar**

## Aviso

Use com responsabilidade. Disparos em massa podem resultar em banimento pelo WhatsApp.  
Recomendamos intervalos maiores (5s+) e listas menores.
