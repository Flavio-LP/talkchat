# Chalk Talk frontend — development image (Vite dev server with HMR, used by
# docker-compose). Not a production build.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
