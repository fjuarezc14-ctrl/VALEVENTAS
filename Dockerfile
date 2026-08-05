# Imagen ligera de Node.js en Linux Alpine
FROM node:20-alpine

# Directorio de trabajo en el contenedor
WORKDIR /app

# Copiar definicion de dependencias
COPY package*.json ./

# Instalar dependencias del sistema y npm
RUN npm install --production

# Copiar el codigo fuente de la aplicacion
COPY . .

# Crear el directorio de datos para SQLite y volumenes
RUN mkdir -p /app/data

# Exponer el puerto de la aplicacion (8090)
EXPOSE 8090

# Variable de entorno por defecto
ENV PORT=8090
ENV NODE_ENV=production

# Comando para iniciar la aplicacion
CMD ["npm", "start"]
