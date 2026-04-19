FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# --- Production stage ---
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/

# SQLite DB lives in /data (mounted volume)
ENV DB_PATH=/data/kid-cal.db

CMD ["node", "dist/index.js"]
