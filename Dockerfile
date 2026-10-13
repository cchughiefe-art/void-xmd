FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
CMD ["npm", "start"]
