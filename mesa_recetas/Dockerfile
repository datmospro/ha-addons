FROM node:24-alpine
WORKDIR /app
COPY package.json domain.mjs seed.mjs server.mjs ./
COPY public ./public
ENV NODE_ENV=production PORT=8099 DATA_DIR=/data INGRESS_ONLY=true
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8099/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
