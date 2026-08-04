# VALEVENTAS by VALETEC - Sistema POS & Fiados (Instalación Local)

Sistema de Punto de Venta (POS), Gestión de Inventario, CRM de Clientes, Cuentas por Cobrar (Módulo Fiados) e Historial de Ventas empaquetado para instalación local rápida en computadoras de tienda usando **Docker Desktop**.

---

## 🚀 Instalación en la Computadora de la Tienda

1. Asegúrate de tener **Docker Desktop** instalado y abierto en la PC.
2. Abre la terminal o consola de comandos en la carpeta del proyecto.
3. Ejecuta el siguiente comando para iniciar el sistema:

```bash
docker-compose up -d --build
```

4. ¡Listo! Abre cualquier navegador web e ingresa a:
   **http://localhost:8090**

---

## 🔒 Persistencia de Datos
Toda la información (ventas, productos, clientes y deudas) se almacena en la base de datos local SQLite dentro de la carpeta `./data/valeventas.db`. Aunque el contenedor Docker se reinicie o apague la computadora, los datos permanecerán seguros.

---

## 🛠️ Puertos Utilizados
- **Puerto Host:** `8090` (Configurado para no tener conflicto con ningún otro proyecto Docker existente).
- **Contenedor:** `valeventas-app`.
