FROM node:25.2.1-bookworm-slim as builder

WORKDIR /provoc

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

FROM node:25.2.1-bookworm-slim

WORKDIR /provoc

COPY --from=builder /provoc .

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
