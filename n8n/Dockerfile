FROM n8nio/n8n:latest

USER root

# Copiar el script de inicio
COPY run.sh /run.sh
RUN chmod +x /run.sh

ENTRYPOINT ["/run.sh"]
