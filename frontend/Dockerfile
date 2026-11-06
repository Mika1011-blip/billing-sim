FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# `vite preview` proxies /setup, /sim, /dev and /client to the API (see vite.config.ts).
ENV VITE_API_TARGET=http://api:8000
EXPOSE 5173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
