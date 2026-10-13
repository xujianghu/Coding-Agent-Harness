FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# 分发镜像使用已编译代码；请在 docker build 前运行 npm run build。
COPY dist/ ./dist/
COPY eval/ ./eval/
# 项目配置与凭据由目标工作区提供，不复制开发者的 .harness。
WORKDIR /workspace
ENTRYPOINT ["node", "/app/dist/cli/index.js"]
