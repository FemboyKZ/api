# Docker Deployment Guide

## Quick Start with Docker Compose

The easiest way to run the entire stack (API + MySQL + Redis):

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop all services
docker-compose down
```

## Environment Configuration

Create a `.env` file in the project root:

```bash
# Database
DB_ROOT_PASSWORD=securerootpassword
DB_NAME=server_api
DB_USER=apiuser
DB_PASSWORD=securepassword

# API
PORT=3000
CORS_ORIGIN=*
RATE_LIMIT_MAX=100

# Redis
REDIS_ENABLED=true
```

## Building the Docker Image

```bash
# Build the image
docker build -t server-api .

# Run the container
docker run -p 3000:3000 --env-file .env server-api
```

## Docker Compose Services

### MySQL Database

- **Port:** 3306
- **Volume:** `mysql_data` (persistent storage)
- **Initialization:** Automatically runs `schema.sql` and `seed.sql` on first startup

### Redis Cache

- **Port:** 6379
- **Volume:** `redis_data` (persistent storage)
- **Optional:** Can be disabled by setting `REDIS_ENABLED=false`

### API Server

- **Port:** 3000 (configurable)
- **Depends on:** MySQL and Redis
- **Health check:** Built-in at `/api/health`
- **Volumes:**
  - `./config:/app/config:ro` - Read-only server configuration
  - `./logs:/app/logs` - Persistent log files

## Health Checks

All services include health checks:

```bash
# Check API health
curl http://localhost:3000/api/health

# Check MySQL
docker-compose exec mysql mysqladmin ping

# Check Redis
docker-compose exec redis redis-cli ping
```

## Production Deployment

### Security Recommendations

1. **Use strong passwords** in production
2. **Limit CORS origins** to specific domains
3. **Use environment-specific .env files**
4. **Enable Redis** for better performance
5. **Set up SSL/TLS** with a reverse proxy (nginx/Traefik)

### Example Production docker-compose.yml

```yaml
version: "3.8"

services:
  mysql:
    image: mysql:8.0
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD_FILE: /run/secrets/db_root_password
      MYSQL_DATABASE: server_api
      MYSQL_USER: apiuser
      MYSQL_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_root_password
      - db_password
    volumes:
      - mysql_data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data

  api:
    build: .
    restart: always
    environment:
      NODE_ENV: production
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    depends_on:
      - mysql
      - redis
    secrets:
      - db_password

secrets:
  db_root_password:
    file: ./secrets/db_root_password.txt
  db_password:
    file: ./secrets/db_password.txt

volumes:
  mysql_data:
  redis_data:
```

## Monitoring & Logs

```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f api
docker-compose logs -f mysql
docker-compose logs -f redis

# Check container status
docker-compose ps

# View resource usage
docker stats
```

## Backup & Restore

### Database Backup

```bash
# Backup
docker-compose exec mysql mysqldump -u root -p server_api > backup.sql

# Restore
docker-compose exec -T mysql mysql -u root -p server_api < backup.sql
```

### Redis Backup

```bash
# Trigger save
docker-compose exec redis redis-cli save

# Copy dump file
docker cp server-api-redis:/data/dump.rdb ./redis-backup.rdb
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs api

# Check database connectivity
docker-compose exec api ping mysql

# Verify environment variables
docker-compose config
```

### Database connection issues

```bash
# Verify MySQL is healthy
docker-compose ps mysql

# Check MySQL logs
docker-compose logs mysql

# Test connection from API container
docker-compose exec api mysql -h mysql -u apiuser -p
```

### Performance optimization

```bash
# Increase database connection pool
environment:
  DB_CONNECTION_LIMIT: 20

# Allocate more memory to Redis
redis:
  command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

## Scaling

To run multiple API instances:

```yaml
api:
  build: .
  deploy:
    replicas: 3
  ports:
    - "3000-3002:3000"
```

Add a load balancer (nginx):

```yaml
nginx:
  image: nginx:alpine
  ports:
    - "80:80"
  volumes:
    - ./nginx.conf:/etc/nginx/nginx.conf:ro
  depends_on:
    - api
```
