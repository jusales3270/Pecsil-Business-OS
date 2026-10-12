# Transmissor de NF-e — serviço separado (GPL-3.0). No Coolify: app próprio a partir deste
# repositório, "Base Directory" = /services/transmissor-nfe, SEM domínio público (só rede interna).

# 1) Dependências. O libxmljs2 (validação pelo esquema) compila código nativo; o
#    xsd-schema-validator tenta compilar um auxiliar em Java no postinstall, que não usamos
#    (a validação é a em JS): por isso --ignore-scripts e depois só o rebuild do libxmljs2.
FROM node:22-bookworm-slim AS dependencias
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild libxmljs2

# 2) Execução. A biblioteca assina e abre o certificado com o openssl da linha de comando.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3100
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json servidor.mjs LICENSE README.md ./
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "servidor.mjs"]
