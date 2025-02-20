FROM node:18-alpine AS react_app

WORKDIR /usr/src/BitcoinChart

COPY ./src/BitcoinChart /usr/src/BitcoinChart
RUN npm ci

EXPOSE 8081