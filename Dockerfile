# Serves the static app with nginx and the security headers from nginx/.
# Pinned to the stable 1.30 line so patch releases are picked up on rebuild
# without jumping minor versions.
FROM nginx:1.30-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY index.html /usr/share/nginx/html/index.html
COPY assets/ /usr/share/nginx/html/assets/
COPY vendor/ /usr/share/nginx/html/vendor/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
