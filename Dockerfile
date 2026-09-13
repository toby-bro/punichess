# Everything — node, npm, the dependency tree — lives in here. Nothing is
# installed on the host.
FROM node:26-slim

WORKDIR /app

# Dependencies are resolved only from the committed lockfile (exact versions,
# integrity-hashed), and install scripts are refused outright: no package in the
# tree gets to run code on install.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
 && chown -R node:node /app

COPY --chown=node:node . .

# Unprivileged, and uid 1000 matches the host user so bind-mounted writes keep
# sane ownership.
USER node

EXPOSE 5173
CMD ["npm", "run", "dev"]
