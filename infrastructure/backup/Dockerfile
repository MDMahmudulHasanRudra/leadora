# Backup sidecar: the same Postgres major version as the database, plus openssl for encryption.
FROM pgvector/pgvector:pg17
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && apt-get clean \
  && find /var/lib/apt/lists -mindepth 1 -delete
COPY backup.sh restore.sh restore-test.sh loop.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/restore-test.sh /usr/local/bin/loop.sh
ENTRYPOINT []
CMD ["/usr/local/bin/loop.sh"]
