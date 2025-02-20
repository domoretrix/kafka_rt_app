FROM node:18-alpine AS api

WORKDIR  /usr/src

COPY ./src /usr/src

RUN npm ci

EXPOSE 8085