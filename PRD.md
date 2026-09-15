# VALEVENTAS by VALETEC — Product Requirements Document (PRD)

**Versión del Producto:** 2.1  
**Estado:** Producción / Enterprise Local  
**Última Actualización:** Septiembre 2026  
**Autor:** Equipo de Ingeniería VALETEC  

---

## 1. Resumen Ejecutivo y Visión

**VALEVENTAS** es un sistema integral de Punto de Venta (POS), control de inventarios, gestión de créditos comerciales (*fiados*) y auditoría de caja diseñado específicamente para el comercio minorista peruano (bodegas, minimarkets, librerías, ferreterías y tiendas de conveniencia).

### Visión
Ofrecer una solución ágil, robusta, altamente disponible y sin dependencia obligatoria de internet para el comercio diario, facilitando el control financiero riguroso de caja, stock en tiempo real y fidelización de clientes a crédito.

### Objetivos Clave
1. **Velocidad en Caja:** Registro de ventas en menos de 3 segundos utilizando teclado, lector de código de barras o búsqueda inteligente.
2. **Cero Fugas de Dinero:** Cuadre de caja diario (*Arqueo Z*), control estricto de retiros de efectivo y registro detallado de faltantes/sobrantes.
3. **Control del Fiado:** Seguimiento transparente de deudas de clientes habituales, emisión de comprobantes de abono y alertas de cobranza.
4. **Puesta en Marcha Inmediata:** Capacidad de precargar catálogos estándar peruanos de consumo masivo con un solo clic.

---

## 2. Arquitectura y Stack Tecnológico

El sistema opera bajo una arquitectura contenerizada y modular, lista para despliegue en servidor local, red LAN o servidor en la nube.

```
┌─────────────────────────────────────────────────────────────┐
│                       NAVEGADOR / POS                       │
│           HTML5 + TailwindCSS + Vanilla JS (SPA)            │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / WebSocket (Socket.io)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 REVERSE PROXY (Nginx Alpine)                 │
│              Contenedor: valeventas-frontend                │
│                        Puerto: 3005                         │
└──────────────────────────────┬──────────────────────────────┘
                               │ Proxy Pass
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               BACKEND API (Node.js + Express)               │
│              Contenedor: valeventas-backend                 │
│                        Puerto: 8090                         │
│   • Rate Limiting Anti-Fuerza Bruta                         │
│   • JWT Auth & RBAC (Admin / Cajero)                        │
│   • WebSockets Real-Time Sync                               │
└──────────────────────────────┬──────────────────────────────┘
                               │ Pool pg (PostgreSQL)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              BASE DE DATOS RELACIONAL (PostgreSQL 16)       │
│                 Contenedor: valeventas-db                   │
│                        Puerto: 5433                         │
│               Volumen Persistente: postgres-data            │
└─────────────────────────────────────────────────────────────┘
```

* **Frontend:** Single Page Application (SPA) en JavaScript ES6+, HTML5 semántico, Tailwind CSS y FontAwesome 6.
* **Backend:** Node.js v20 LTS con Express, WebSockets (Socket.io) para sincronización entre múltiples terminales POS, Rate Limiter para mitigación de ataques de fuerza bruta y JSON Web Tokens (JWT).
* **Base de Datos:** PostgreSQL 16 Alpine con transacciones ACID atómicas (`BEGIN ... COMMIT / ROLLBACK`), advisory locks para correlativos concurrentes y claves foráneas en cascada.
* **Infraestructura:** Docker Compose multi-contenedor con volúmenes persistentes y scripts de arranque automático (`iniciar_valeventas.bat`).

---

## 3. Módulos Funcionales

### 3.1. Punto de Venta (POS) & Facturación Rápida
* **Búsqueda Inteligente:** Entrada por lector de código de barras, búsqueda por coincidencia parcial de texto y comandos de multiplicador de cantidad (`3*7750123001` para agregar 3 unidades directamente).
* **Navegación por Atajos de Teclado:**
  * `F2`: Enfocar buscador de productos.
  * `F4`: Abrir pasarela de cobro.
  * `F8`: Limpiar carrito.
  * `ESC`: Cerrar modales.
* **Tipos de Comprobante:**
  * **Ticket de Venta:** Para ventas rápidas a público general.
  * **Boleta de Venta:** Registro con validación de DNI y Nombres del cliente.
  * **Factura:** Registro con validación de RUC (11 dígitos) y Razón Social.
* **Generación Atómica de Correlativos:** Uso de bloqueos consultivos de PostgreSQL (`pg_advisory_xact_lock`) que garantizan correlativos consecutivos (ej. `T001-000123`, `B001-000045`, `F001-000012`) sin saltos ni duplicados bajo concurrencia.

### 3.2. Pasarela Multimedio de Pago
* **Efectivo:** Cálculo automático de vuelto / cambio monetario y botones de billetes rápidos (S/ 10, S/ 20, S/ 50, S/ 100).
* **Tarjeta:** Registro de cobros procesados por POS físico (Izipay, Niubiz, POS bancario).
* **Billeteras Digitales (Yape / Plin):** Identificación de transferencias directas sin comisión de efectivo.
* **Pago Mixto:** Desglose en dos montos independientes: parte en efectivo y parte por transferencia/tarjeta.
* **Venta a Crédito (Fiado):** Asignación de la deuda al cliente registrado, actualizando su saldo por cobrar de forma inmediata.
* **Cortesía / Degustación:** Modalidad para muestras, regalos o consumo interno; genera comprobante a S/ 0.00, descarga el stock con tipo `CORTESIA` y no altera los ingresos de dinero en caja.

### 3.3. Módulo de Créditos y Cuentas por Cobrar (Fiados)
* **Padrón de Clientes:** Ficha de cliente con DNI/RUC, teléfono, dirección y saldo deudor en tiempo real.
* **Registro de Abonos:** Recepción de pagos parciales o totales de deuda en efectivo, tarjeta o Yape/Plin, emitiendo ticket térmico de abono.
* **Historial de Cuenta Corriente:** Auditoría de cada incremento por compra fiada y decremento por abono, con fecha, cajero responsable y saldo resultante.
* **Anulación de Abonos:** Exclusivo para Administrador en caso de error de digitación, restituyendo el balance contable del cliente.

### 3.4. Gestión de Inventarios y Kardex
* **Control de Stock en Tiempo Real:** Descuento automático de existencias tras cada venta y restauración inmediata en caso de anulación.
* **Alerta de Stock Crítico:** Identificación visual de productos cuya existencia sea inferior o igual al stock mínimo configurado.
* **Kardex Valorizado y Movimientos:**
  * Tipos de movimiento: `INGRESO`, `VENTA`, `CORTESIA`, `MERMA`, `AJUSTE`, `SALIDA_INTERNA`, `DEVOLUCION_VENTA`.
  * Registro del documento de sustento (Guía de Remisión, Factura de Proveedor o Sustento Interno) y auditoría del usuario que realizó la operación.
* **Edición Rápida:** Modificación de precios de costo, precios de venta y categorías.

### 3.5. Catálogo Base Peruano & Plantillas Rápidas
* **Carga Masiva en 1 Clic:** Botón para poblar el inventario inicial con 28 productos de alta rotación de la canasta básica peruana con marcas reales vigentes (Gloria, Primor, Costeño, Cartavio, Inca Kola, San Mateo, Bolívar, Clorox, etc.).
* **Panel Lateral de Autocompletado:** Al crear un producto nuevo, un panel clasificado por categorías permite rellenar código, nombre, categoría, costos y márgenes sugeridos en un solo clic.

### 3.6. Control de Caja Diaria y Arqueo Z
* **Apertura de Caja:** Declaración del monto inicial en gaveta (fondo para vuelto).
* **Control de Retiros / Egresos:** Exclusivo para Administrador; retiro justificado con motivo obligatorio (pago a proveedores, servicios, gastos menores) que recalcula el efectivo esperado.
* **Cierre de Caja (Arqueo Z):**
  * Comparación entre el Efectivo Esperado (`Monto Inicial + Ventas Efectivo + Abonos Fiados - Retiros`) y el Efectivo Real contado.
  * Determinación automática de Cuadre Exacto, Sobrante (+) o Faltante (-).
  * Emisión de Ticket Térmico de Cierre Z con desglose por cada medio de pago.
* **Historial de Turnos de Cajeros:** Consulta histórica de turnos cerrados filtrados por cajero y rango de fechas, con auditoría de diferencias y reimpresión de comprobantes Z pasados.

### 3.7. Reportes Financieros y Exportación a Excel
* **Métricas Clave (KPIs):** Ventas totales, Ganancia neta (utilidad bruta sobre costo de reposición), Cantidad de transacciones y Ticket promedio.
* **Desglose de Ingresos:** Segmentación por Efectivo, Tarjeta, Yape/Plin, Fiados entregados, Abonos cobrados y Cortesías.
* **Exportación Optimizada a Excel:**
  * Generación de archivo `.csv` compatible con la configuración regional de Perú y Latinoamérica.
  * Cabecera con directiva `sep=;` y delimitador por punto y coma (`;`), evitando la agrupación de datos en una sola celda.
  * Columnas perfectamente estructuradas: N° Comprobante, Fecha/Hora, Cliente, DNI/RUC, Cajero, Tipo Comprobante, Método de Pago, Monto Total, Ganancia Neta y Estado.

### 3.8. Seguridad, Roles y Auditoría
* **Control de Acceso Basado en Roles (RBAC):**
  * **Administrador:** Acceso total (Gestión de usuarios, anulación de ventas, edición de precios, retiros de caja, reportes de utilidades y copias de seguridad).
  * **Cajero:** Operación del POS, cobro, consulta de stock, apertura y cierre de su propio turno.
* **Protección Anti-Fuerza Bruta:** Rate limiter de 20 intentos por minuto en el endpoint de autenticación `/api/auth/login`.
* **Cifrado de Credenciales:** Contraseñas protegidas mediante hash unidireccional con algoritmo `bcryptjs`.

### 3.9. Configuración de Empresa y Copia de Seguridad
* **Datos Fiscales Personalizables:** Nombre comercial, RUC, dirección, teléfono y pie de ticket para impresión térmica de 80mm y 58mm.
* **Copia de Seguridad (Backup) en 1 Clic:** Descarga de un archivo `.json` estructurado con la totalidad de tablas de la base de datos (usuarios, productos, ventas, kardex, fiados y cajas) para custodia ante contingencias.

---

## 4. Requisitos No Funcionales (NFR)

| Dimensión | Requisito | Métrica / Criterio de Aceptación |
|---|---|---|
| **Rendimiento** | Tiempo de respuesta de endpoints transaccionales | < 150 ms bajo carga normal en red local. |
| **Concurrencia** | Serialización de ventas simultáneas | Cero colisiones de stock y correlativos únicos garantizados con `pg_advisory_xact_lock`. |
| **Disponibilidad** | Operación offline / local | Sistema 100% funcional sin conexión a internet externa. |
| **Compatibilidad** | Impresión térmica de tickets | Formato universal ESC/POS estándar de 80mm y 58mm vía diálogo del navegador. |
| **Integridad de Datos** | Tolerancia a fallos en ventas | Transacciones atómicas con reversión (`ROLLBACK`) ante cualquier inconsistencia. |
| **Portabilidad** | Despliegue multiplataforma | Docker Compose compatible con Windows 10/11, Linux y macOS. |

---

## 5. Changelog Reciente (Versión 2.1)

* **Fix Fiados en Compras Grandes:** Migración de la columna `details` en la tabla `fiado_payments` de `VARCHAR(255)` a `TEXT`. Se eliminó el error de desbordamiento al procesar ventas a crédito con múltiples productos.
* **Carga Masiva de Catálogo:** Implementación del endpoint `/api/products/bulk` y botón en Inventario para registrar 28 productos de consumo masivo peruanos en lote sin duplicar códigos existentes.
* **Reporte de Cajeros por Turno:** Implementación del endpoint `/api/cash-registers/history` y la vista de turnos en Reportes para auditar cierres Z pasados por cajero.
* **Formato Excel Profesional:** Ajuste del exportador de reportes con directiva `sep=;` y delimitador por punto y coma, garantizando la apertura ordenada en columnas independientes en Microsoft Excel para Windows.
* **Ventas de Cortesía:** Incorporación del método de pago "Cortesía" en el POS, permitiendo entregar muestras o consumos autorizados descontando stock sin alterar los ingresos de caja.

---

*VALEVENTAS es una marca y desarrollo propiedad de VT VALETEC. Todos los derechos reservados.*
