# VALEVENTAS by VT VALETEC - Sistema POS & Fiados (Docker Local)

Sistema de Punto de Venta (POS), Gestión de Inventario, CRM de Clientes, Cuentas por Cobrar (Módulo Fiados) e Historial de Ventas optimizado para ejecución local en contenedores Docker mediante **Docker Compose**.

---

## 🏛️ Estándares Técnicos y Gobernanza

Este repositorio cumple estrictamente con los lineamientos especificados en la [Constitución de Desarrollo VT VALETEC](constitution.md):
- **Código y Nombres de Archivo:** Estándar internacional en inglés.
- **Documentación y Comentarios:** Redactados en español.
- **Seguridad:** Uso obligatorio de variables de entorno (`.env`) sin datos confidenciales incrustados.

---

## 🚀 Instalación y Pruebas Locales

1. Asegúrate de tener **Docker Desktop** activo en la computadora.
2. Abre la terminal en la raíz del proyecto.
3. Copia el archivo de variables de entorno (si no existe):
   ```bash
   cp .env.example .env
   ```
4. Inicia la arquitectura de contenedores con el siguiente comando:
   ```bash
   docker compose up -d --build
   ```
5. Acceso a las aplicaciones:
   - **Frontend (Interfaz POS & Gestión):** [http://localhost:3000](http://localhost:3000)
   - **Backend (API Dashboard & Endpoints):** [http://localhost:8090/api/dashboard](http://localhost:8090/api/dashboard)

---

## 🛠️ Servicios y Puertos Configurados

| Servicio | Contenedor | Puerto Host | Puerto Interno | Descripción |
| :--- | :--- | :---: | :---: | :--- |
| **Frontend** | `valeventas-frontend` | `3000` | `80` | Servidor Web Nginx sirviendo la SPA estática e integrando reverse proxy para la API. |
| **Backend** | `valeventas-backend` | `8090` | `8090` | Servidor API Node.js / Express con base de datos SQLite. |

---

## 🔒 Persistencia de Datos

Toda la información (ventas, productos, clientes y deudas) se almacena localmente en la base de datos SQLite en el volumen montado `./data/valeventas.db`. Los datos se mantienen seguros incluso si los contenedores se detienen o se reinicia la máquina.
