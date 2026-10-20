FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium iproute2 iptables ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /bench
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY transport-bench.mjs ./
CMD ["node", "transport-bench.mjs"]
