FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

# Prune dev deps after generating (prisma CLI is a devDep)
RUN npm prune --omit=dev

COPY src ./src

EXPOSE 3001

CMD ["node", "src/index.js"]
