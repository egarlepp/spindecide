FROM nginx:alpine
# Copy our static build to the server's public container directory
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]