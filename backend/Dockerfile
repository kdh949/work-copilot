FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY backend backend
RUN npm run build --workspace=backend && npm prune --omit=dev

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/backend/dist backend/dist
COPY deploy/cleanup-loop.sh /usr/local/bin/work-copilot-cleanup-loop

RUN chmod 0555 /usr/local/bin/work-copilot-cleanup-loop

WORKDIR /app/backend
USER node

EXPOSE 3000

CMD ["node", "dist/src/main"]
