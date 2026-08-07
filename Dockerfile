FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY .harness/ ./.harness/
ENTRYPOINT ["node", "dist/cli/index.js"]