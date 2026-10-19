FROM node:20-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg icecast2 gettext-base ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY app/package.json ./package.json
RUN npm install --omit=dev
COPY app/ ./
COPY docker/icecast.xml.template /etc/icecast2/icecast.xml.template
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh && mkdir -p /var/log/icecast2 /var/lib/icecast2
ENV PORT=10000 ICECAST_PORT=8000
EXPOSE 10000
CMD ["/start.sh"]
