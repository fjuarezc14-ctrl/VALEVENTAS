const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Asegurar que exista el directorio data para la persistencia de SQLite
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'valeventas.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error conectando a SQLite:', err.message);
  } else {
    console.log('✅ Base de Datos SQLite conectada en:', dbPath);
  }
});

// Inicializar Tablas
db.serialize(() => {
  // 1. PRODUCTOS
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Abarrotes',
      purchase_price REAL DEFAULT 0,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. CLIENTES
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      debt REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. VENTAS
  db.run(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_code TEXT UNIQUE NOT NULL,
      doc_type TEXT NOT NULL, -- Ticket, Boleta, Factura
      customer_id INTEGER,
      customer_name TEXT DEFAULT 'Público General',
      payment_method TEXT NOT NULL, -- Efectivo, Tarjeta, Yape/Plin, Mixto, Fiado
      subtotal REAL NOT NULL,
      tax REAL NOT NULL,
      total REAL NOT NULL,
      paid_amount REAL DEFAULT 0,
      change_amount REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
  `);

  // 4. DETALLE DE VENTAS
  db.run(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE
    )
  `);

  // 5. REGISTROS FIADOS Y ABONOS
  db.run(`
    CREATE TABLE IF NOT EXISTS fiado_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      type TEXT NOT NULL, -- COMPRA_FIADA | ABONO
      amount REAL NOT NULL,
      details TEXT DEFAULT '',
      balance_after REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
  `);

  // 6. USUARIOS Y PERMISOS
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Vendedor', -- Administrador, Cajero, Vendedor
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // SEED DE DATOS INICIALES SI LA TABLA DE PRODUCTOS ESTÁ VACÍA
  db.get("SELECT COUNT(*) AS count FROM products", (err, row) => {
    if (!err && row.count === 0) {
      console.log('🌱 Poblando datos iniciales de prueba para la bodega...');

      const stmtProduct = db.prepare(`
        INSERT INTO products (code, name, category, purchase_price, price, stock)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const initialProducts = [
        ['75010001', 'Inka Kola 3L Desechable', 'Bebidas', 9.50, 12.50, 24],
        ['75010002', 'Coca Cola 3L Desechable', 'Bebidas', 9.50, 12.50, 18],
        ['75010003', 'Arroz Costeño 1kg', 'Abarrotes', 4.10, 4.90, 50],
        ['75010004', 'Azúcar Rubia Casa Grande 1kg', 'Abarrotes', 3.80, 4.50, 40],
        ['75010005', 'Aceite Primor 1L', 'Abarrotes', 8.20, 10.50, 15],
        ['75010006', 'Leche Gloria Azul 400g', 'Lácteos', 3.60, 4.30, 36],
        ['75010007', 'Pan de Molde Bimbo Blanco 480g', 'Panadería', 6.00, 7.80, 8],
        ['75010008', 'Detergente Opal 800g', 'Limpieza', 6.50, 8.20, 12],
        ['75010009', 'Jabón Bolívar Blanco', 'Limpieza', 2.80, 3.50, 25],
        ['75010010', 'Galletas Casino Menta 6pk', 'Snacks', 2.50, 3.20, 30]
      ];

      initialProducts.forEach(p => stmtProduct.run(p));
      stmtProduct.finalize();

      // Seed Clientes
      const stmtCustomer = db.prepare(`
        INSERT INTO customers (doc, name, phone, debt)
        VALUES (?, ?, ?, ?)
      `);

      const initialCustomers = [
        ['45891234', 'María Mendoza', '987654321', 45.00],
        ['10234567891', 'Bodega San Martín RUC', '912345678', 0.00],
        ['41239876', 'Jorge Ramírez', '955443322', 12.50]
      ];

      initialCustomers.forEach(c => stmtCustomer.run(c));
      stmtCustomer.finalize();

      // Seed Historial de Fiados inicial para María Mendoza (ID 1)
      db.run(`
        INSERT INTO fiado_records (customer_id, type, amount, details, balance_after)
        VALUES (1, 'COMPRA_FIADA', 45.00, '2x Inka Kola 3L, 1x Aceite Primor', 45.00)
      `);

      // Seed Usuarios
      db.run(`
        INSERT INTO users (username, name, role)
        VALUES ('admin', 'Carlos Admin', 'Administrador'), ('cajero1', 'Ana Cajera', 'Cajero')
      `);

      console.log('✅ Base de datos poblada con éxito.');
    }
  });
});

module.exports = db;
