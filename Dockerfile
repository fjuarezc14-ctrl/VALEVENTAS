# ==========================================
# Dockerfile para Backend (VALEVENTAS API)
# VT VALETEC Standard Node.js Container
# ==========================================
FROM node:20-alpine

# Definir directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de produccion
RUN npm install --only=production

# Copiar codigo fuente del backend
COPY server.js db.js ./

# Crear el directorio de datos para SQLite y asegurar permisos
RUN mkdir -p /app/data

# Exponer el puerto del backend (8090 por defecto)
EXPOSE 8090

# Variables de entorno por defecto
ENV PORT=8090
ENV NODE_ENV=production

# Comando de inicio del backend
CMD ["node", "server.js"]
