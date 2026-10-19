# Backup externo (T-02). No Coolify: app próprio a partir deste repositório,
# "Base Directory" = /services/backup, SEM domínio público. Ver docs/BACKUP-EXTERNO.md.
# pg_dump 17 (o Postgres da plataforma é 17.x) e age (criptografia antes de sair).
FROM node:22-alpine
RUN apk add --no-cache postgresql17-client age tar
ENV NODE_ENV=production TZ=America/Sao_Paulo
WORKDIR /app
COPY nucleo.mjs backup.mjs restaurar.mjs ./
USER node
CMD ["node", "backup.mjs"]
