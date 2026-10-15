FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js infobip-sms.js bulksms-sms.js vonage-verify.js smsportal-sms.js clicksend-sms.js registration-validation.js signup.js *.html *.css script*.js mobile.js ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server.js"]
