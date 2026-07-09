# ── build stage ──────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── runtime stage ────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# Installs prod deps only; typeorm (used by the migration CLI below) is a runtime dependency.
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
# Run pending migrations against the compiled data-source, then start the app. `exec` so node takes
# over PID 1 and receives SIGTERM directly; the app drains in-flight crawler dispatches on shutdown.
CMD ["sh", "-c", "node ./node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js && exec node dist/main.js"]
