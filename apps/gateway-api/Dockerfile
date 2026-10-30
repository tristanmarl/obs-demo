FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY server.js attributes.js attributes-store.js apply-attributes.js ./
EXPOSE 8080
CMD ["npm", "start"]
