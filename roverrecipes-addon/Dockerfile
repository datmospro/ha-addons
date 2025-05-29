FROM python:3.11-slim

WORKDIR /app

COPY app/ ./app/
COPY run.sh /run.sh

RUN pip install --no-cache-dir -r app/requirements.txt \
    && chmod +x /run.sh

EXPOSE 8000

CMD ["/run.sh"] 