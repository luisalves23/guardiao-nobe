# Estágio de Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
COPY public ./public
RUN npm run build

# Estágio de Produção
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm install --only=production
COPY --from=builder /app/dist ./dist
COPY public ./public

# Volume persistente para manter os logs de 30 dias, agenda e configurações
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "dist/index.js"]
