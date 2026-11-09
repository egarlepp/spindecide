# Serves the single-file app with nginx. Pinned to the stable 1.30 line so
# patch releases are picked up on rebuild without jumping minor versions.
FROM nginx:1.30-alpine

COPY index.html /usr/share/nginx/html/index.html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
