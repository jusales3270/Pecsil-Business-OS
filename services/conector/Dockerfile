FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Data e hora do ERP são locais: o fuso do serviço é o da empresa.
ENV TZ=America/Sao_Paulo
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 3200
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3200/saude >/dev/null || exit 1
CMD ["node", "conector.mjs"]
