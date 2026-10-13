# Build from the repository root; target linux/amd64 for Fargate X86_64.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api/tsconfig*.json apps/api/
COPY apps/api/src apps/api/src
RUN npm run build -w @support/api

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@support/api --include-workspace-root=false

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app/apps/api
COPY --from=dependencies --chown=node:node /app/node_modules /app/node_modules
COPY --chown=node:node apps/api/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --chown=node:node apps/api/migrations ./migrations
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
