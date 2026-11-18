FROM dhi.io/node:24-dev AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM dhi.io/node:24
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
EXPOSE 3000
# DHI runtime images run as a non-root user by default.
ENTRYPOINT ["node", "dist/server.js"]
