FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Build du dashboard React (voir web/) — web/dist n'est pas commité, il
# doit être généré à chaque build d'image (voir src/server.js#startServer,
# qui sert ce dossier).
RUN npm run build:web

CMD ["node", "src/index.js"]
