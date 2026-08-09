FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Build du dashboard web (voir web/) — nécessite les devDependencies
# (vite/react), donc une install séparée dans web/ plutôt que --omit=dev
# ci-dessus qui ne concerne que le bot Node.
RUN npm run build:web

CMD ["node", "src/index.js"]
