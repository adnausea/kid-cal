FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# --- Production stage ---
FROM node:24-alpine

# Non-root user for runtime
RUN addgroup -S kidcal && adduser -S kidcal -G kidcal

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ dist/

# Data directory owned by kidcal user
RUN mkdir -p /data && chown kidcal:kidcal /data

# Drop to non-root
USER kidcal

ENV DB_PATH=/data/kid-cal.db
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
