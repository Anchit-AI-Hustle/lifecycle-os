# Lifecycle OS on Google Cloud Run (the Cloud Build trigger on main).
# Production is Vercel; this container runs the same app as one Node process
# (scripts/cloudrun-server.js reads vercel.json), listening on $PORT.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev
EXPOSE 8080
CMD ["node", "scripts/cloudrun-server.js"]
