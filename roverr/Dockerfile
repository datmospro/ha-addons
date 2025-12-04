ARG BUILD_FROM
FROM $BUILD_FROM

# Install requirements for add-on
RUN \
  apk add --no-cache \
    python3 \
    py3-pip \
    cifs-utils \
    ffmpeg \
    samba-client

# Copy data for add-on
COPY run.sh /
COPY app /app

# Install Python dependencies
RUN pip3 install --no-cache-dir --break-system-packages \
    fastapi \
    uvicorn \
    qbittorrent-api \
    peewee \
    python-multipart \
    jinja2 \
    aiofiles \
    requests \
    feedparser

WORKDIR /app

RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
