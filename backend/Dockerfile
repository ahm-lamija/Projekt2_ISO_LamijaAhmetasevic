FROM node:18

WORKDIR /app

# Kopiramo package.json i instaliramo produkcijske dependencije
COPY package*.json ./
RUN npm install --only=production

# Kopiramo ostatak backend koda
COPY . .

# Otvaramo port 5000 na kojem sluša tvoj Node.js app
EXPOSE 5000

# Pokrećemo aplikaciju direktno preko Node-a (bez nodemona)
CMD ["node", "server.js"]