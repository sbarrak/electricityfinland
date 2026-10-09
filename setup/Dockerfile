# One-shot "installer": copies the web files and the nginx config into folders
# on the host (e.g. on the Synology), then exits. Build context = repo root.
FROM alpine:3.20
COPY web /seed/web
COPY nginx/default.conf /seed/nginx/default.conf
CMD ["sh", "-c", "mkdir -p /target/web /target/nginx && cp -a /seed/web/. /target/web/ && cp -f /seed/nginx/default.conf /target/nginx/default.conf && echo 'web files and nginx config installed'"]
