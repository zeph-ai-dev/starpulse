FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src ./src

ENV PORT=3737
EXPOSE 3737

CMD ["node", "src/index.js"]
