FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# yt-dlp (binaire autonome) : liste les dernières vidéos TikTok d'un compte
# avec leurs vues, sans navigateur (voir src/tiktok.js). Téléchargé à chaque
# build de l'image, donc toujours à jour — TikTok change régulièrement et
# yt-dlp suit ces changements. Le `--version` fait échouer le build tout de
# suite si le binaire est inutilisable, plutôt qu'au premier scan.
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
 && chmod 755 /usr/local/bin/yt-dlp \
 && yt-dlp --version

COPY . .

# Build du dashboard React (voir web/) — web/dist n'est pas commité, il
# doit être généré à chaque build d'image (voir src/server.js#startServer,
# qui sert ce dossier).
RUN npm run build:web

CMD ["node", "src/index.js"]
