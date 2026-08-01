FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY server.js resource-attrs.js ./
EXPOSE 8080
CMD ["npm", "start"]
