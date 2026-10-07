# syntax=docker/dockerfile:1.7
# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- dev: Vite con HMR, código montado por volumen ----------
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--port", "5173", "--strictPort"]

# ---------- build ----------
FROM deps AS build
COPY . .
RUN npm run build

# ---------- prod: nginx sirve el estático y hace proxy de /api y /api/ws ----------
FROM nginx:1.27-alpine AS prod
# la imagen de nginx aplica envsubst a las plantillas (solo a variables definidas)
ENV API_UPSTREAM=http://api:8000
# el entrypoint exporta NGINX_LOCAL_RESOLVERS (DNS del contenedor) para la plantilla
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
