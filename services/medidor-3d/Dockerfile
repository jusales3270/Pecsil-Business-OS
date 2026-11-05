# Medidor 3D — serviço separado (ROADMAP C-19). No Coolify: app próprio a partir deste repositório,
# "Base Directory" = /services/medidor-3d, SEM domínio público (só rede interna).

# 1) O motor: solidcraft-cli (MIT/Apache) da release oficial, com o sha256 publicado em SHA256SUMS.txt.
FROM node:22-bookworm-slim AS motor
ARG SOLIDCRAFT_VERSAO=0.30.1
ARG SOLIDCRAFT_SHA256=2be163c618e7ccd9523d997ebd9f5094c310e968a80560b2840db1e1a8c0d482
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/sc.tar.gz "https://github.com/tangency-labs/solidcraft/releases/download/v${SOLIDCRAFT_VERSAO}/solidcraft-${SOLIDCRAFT_VERSAO}-linux-x86_64.tar.gz" \
 && echo "${SOLIDCRAFT_SHA256}  /tmp/sc.tar.gz" | sha256sum -c - \
 && mkdir -p /opt/solidcraft/bin \
 && tar -xzf /tmp/sc.tar.gz -C /tmp \
 && cp "/tmp/solidcraft-${SOLIDCRAFT_VERSAO}-linux-x86_64/bin/solidcraft-cli" /opt/solidcraft/bin/ \
 && cp /tmp/solidcraft-${SOLIDCRAFT_VERSAO}-linux-x86_64/share/doc/solidcraft/* /opt/solidcraft/ 2>/dev/null || true \
 && rm -rf /tmp/sc.tar.gz /tmp/solidcraft-*

# 2) Execução: Node puro (sem dependências), o motor sem placa de vídeo (desenha na CPU).
FROM node:22-bookworm-slim
COPY --from=motor /opt/solidcraft /opt/solidcraft
ENV NODE_ENV=production PORT=3200 SOLIDCRAFT_CLI=/opt/solidcraft/bin/solidcraft-cli SOLIDCRAFT_GPU=cpu
WORKDIR /app
COPY package.json servidor.mjs geometria.mjs README.md ./
USER node
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "servidor.mjs"]
