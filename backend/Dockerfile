FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=corporate_ca,required=false \
    if [ -s /run/secrets/corporate_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/corporate_ca npm ci; else npm ci; fi

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=corporate_ca,required=false \
    if [ -s /run/secrets/corporate_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/corporate_ca npm ci --omit=dev; else npm ci --omit=dev; fi \
    && npm cache clean --force

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run migration:run:prod && node dist/main.js"]
