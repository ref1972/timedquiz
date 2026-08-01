FROM node:24.14.0-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DB_PATH=/data/quiz.db

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY src ./src
RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "start"]
