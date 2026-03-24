# Deploy Guide – Live Translator

## Rodar localmente (desenvolvimento)

```bash
cd server
cp .env.example .env        # preencha as chaves de API
npm install
npm run dev                 # http://localhost:3001
```

---

## Rodar com Docker (recomendado para produção)

### Pré-requisitos
- Docker 24+ e Docker Compose v2+

### 1. Configure as variáveis de ambiente

```bash
cp server/.env.example server/.env
```

Edite `server/.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
JWT_SECRET=gere-uma-string-aleatoria-longa-aqui
PORT=3001
# ALLOWED_ORIGINS=https://seudominio.com
```

### 2. Suba os containers

```bash
docker compose up -d
```

Acesse: **http://localhost** (nginx → app)
Ou direto: **http://localhost:3001**

### 3. Primeiro acesso

- Acesse http://localhost e clique em **Criar conta**
- O primeiro usuário cadastrado vira **administrador** automaticamente
- Acesse o painel admin em http://localhost/admin.html

### Comandos úteis

```bash
docker compose logs -f app          # logs em tempo real
docker compose restart app          # reiniciar só o app
docker compose down                 # parar tudo
docker compose down -v              # parar e apagar volumes (CUIDADO: apaga o banco)
```

---

## Deploy em VPS (Ubuntu/Debian)

```bash
# 1. Instalar Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 2. Clonar o repositório
git clone https://github.com/marcus1356/live-transcription.git
cd live-transcription

# 3. Configurar .env
cp server/.env.example server/.env
nano server/.env   # preencha as chaves

# 4. Subir
docker compose up -d

# 5. Ver status
docker compose ps
```

### Com domínio + SSL (Let's Encrypt)

```bash
# Instalar certbot
sudo apt install certbot

# Gerar certificado
sudo certbot certonly --standalone -d seudominio.com

# Copiar certs
mkdir -p nginx/certs
sudo cp /etc/letsencrypt/live/seudominio.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/seudominio.com/privkey.pem   nginx/certs/
sudo chown $USER:$USER nginx/certs/*

# Descomentar o bloco HTTPS no nginx/default.conf
# e comentar o bloco HTTP

docker compose restart nginx
```

---

## Estrutura dos containers

```
docker-compose.yml
├── app     → Node.js 20 (Express + SQLite)  porta 3001
│             volume: sqlite_data → /data/data.sqlite
└── nginx   → Nginx 1.27  portas 80 / 443
              reverse proxy → app:3001
              rate limit: 10 req/s por IP
```

---

## API pública (modelo de negócio para devs)

O servidor expõe uma API REST que pode ser vendida como serviço separado:

| Endpoint | Auth | Descrição |
|---|---|---|
| `POST /api/auth/register` | — | Criar conta |
| `POST /api/auth/login` | — | Login, retorna JWT |
| `GET /api/auth/me` | JWT | Dados do usuário + uso |
| `POST /api/translate` | JWT | Traduzir texto EN→PT |
| `POST /api/transcribe` | JWT | Transcrever áudio (Whisper) |
| `GET /api/admin/stats` | JWT admin | Estatísticas |
| `GET /api/admin/users` | JWT admin | Lista de usuários |
| `PATCH /api/admin/users/:id/plan` | JWT admin | Alterar plano |

Exemplo de chamada autenticada:
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"seu@email.com","password":"suasenha"}' | jq -r .token)

curl -X POST http://localhost:3001/api/translate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, how are you?"}'
```

---

## Backup do banco de dados

```bash
# Backup manual
docker compose exec app sh -c "cp /data/data.sqlite /data/backup-$(date +%Y%m%d).sqlite"
docker cp live-transcription-app-1:/data/backup-$(date +%Y%m%d).sqlite ./backup.sqlite

# Backup automático via cron (no servidor)
echo "0 3 * * * docker compose -f /path/to/docker-compose.yml exec -T app sh -c 'sqlite3 /data/data.sqlite .dump > /data/backup.sql'" | crontab -
```
