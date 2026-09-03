// ==========================================
// Módulo de Conexión a Base de Datos PostgreSQL
// VT VALETEC Standard Database Layer
// ==========================================
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'valetec',
  password: process.env.POSTGRES_PASSWORD || 'valetec_secure_pass',
  database: process.env.POSTGRES_DB || 'valeventas_db'
});

// Probar conexión e inicializar esquemas de tablas
async function initDb() {
  try {
    const client = await pool.connect();
    console.log('✅ Base de Datos PostgreSQL conectada exitosamente.');
    client.release();

    // 1. PRODUCTOS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        code VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'Abarrotes',
        purchase_price NUMERIC(10,2) DEFAULT 0,
        price NUMERIC(10,2) NOT NULL,
        stock INT NOT NULL DEFAULT 0,
        min_stock INT DEFAULT 5,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
    `);

    // 2. CLIENTES
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        doc VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) DEFAULT '',
        address VARCHAR(255) DEFAULT '',
        debt NUMERIC(10,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. USUARIOS Y CONTROL DE ACCESO (DECLARADO ANTES DE SALES POR FK)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        plain_password VARCHAR(255) DEFAULT '',
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'Cajero',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    try { await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password VARCHAR(255) DEFAULT '';"); } catch(e){}

    // 7. ARQUEO Y CIERRE DE CAJA DIARIO (TURNO Z)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cash_registers (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(255) NOT NULL,
        opening_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        cash_sales NUMERIC(10,2) DEFAULT 0,
        card_sales NUMERIC(10,2) DEFAULT 0,
        transfer_sales NUMERIC(10,2) DEFAULT 0,
        fiado_sales NUMERIC(10,2) DEFAULT 0,
        fiado_abonos NUMERIC(10,2) DEFAULT 0,
        total_withdrawals NUMERIC(10,2) DEFAULT 0,
        expected_cash NUMERIC(10,2) DEFAULT 0,
        actual_cash NUMERIC(10,2) DEFAULT 0,
        difference NUMERIC(10,2) DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'abierta',
        notes VARCHAR(255) DEFAULT '',
        opened_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMPTZ
      );
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS fiado_abonos NUMERIC(10,2) DEFAULT 0;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS total_withdrawals NUMERIC(10,2) DEFAULT 0;
    `);

    // 8. MOVIMIENTOS Y RETIROS DE CAJA EN EFECTIVO
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cash_movements (
        id SERIAL PRIMARY KEY,
        cash_register_id INT REFERENCES cash_registers(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(255) NOT NULL,
        type VARCHAR(20) NOT NULL DEFAULT 'RETIRO',
        amount NUMERIC(10,2) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. VENTAS (CON AUDITORÍA DE VENDEDOR Y VÍNCULO A TURNO DE CAJA)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        receipt_code VARCHAR(100) UNIQUE NOT NULL,
        doc_type VARCHAR(50) NOT NULL,
        customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
        customer_name VARCHAR(255) DEFAULT 'Público General',
        payment_method VARCHAR(50) NOT NULL,
        subtotal NUMERIC(10,2) NOT NULL,
        tax NUMERIC(10,2) NOT NULL,
        total NUMERIC(10,2) NOT NULL,
        paid_amount NUMERIC(10,2) DEFAULT 0,
        change_amount NUMERIC(10,2) DEFAULT 0,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(255) DEFAULT 'Administrador Principal',
        cash_register_id INT REFERENCES cash_registers(id) ON DELETE SET NULL,
        status VARCHAR(20) DEFAULT 'completada',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS user_name VARCHAR(255) DEFAULT 'Administrador Principal';
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS cash_register_id INT REFERENCES cash_registers(id) ON DELETE SET NULL;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS mixed_cash NUMERIC(10,2) DEFAULT 0;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS mixed_other NUMERIC(10,2) DEFAULT 0;
    `);

    // 4. DETALLE DE VENTAS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id SERIAL PRIMARY KEY,
        sale_id INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id INT REFERENCES products(id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL,
        unit_price NUMERIC(10,2) NOT NULL,
        total_price NUMERIC(10,2) NOT NULL
      );
    `);

    // 5. HISTORIAL DE FIADOS Y ABONOS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fiado_payments (
        id SERIAL PRIMARY KEY,
        customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(255) DEFAULT 'Sistema',
        type VARCHAR(20) NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'Efectivo',
        amount NUMERIC(10,2) NOT NULL,
        balance_after NUMERIC(10,2) NOT NULL,
        details VARCHAR(255) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE fiado_payments ADD COLUMN IF NOT EXISTS user_id INT;
      ALTER TABLE fiado_payments ADD COLUMN IF NOT EXISTS user_name VARCHAR(255) DEFAULT 'Sistema';
      ALTER TABLE fiado_payments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Efectivo';
    `);

    // 9. REABASTECIMIENTO Y MOVIMIENTOS DE INVENTARIO (GUÍA DE REMISIÓN / FACTURAS)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id SERIAL PRIMARY KEY,
        product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        product_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL,
        type VARCHAR(20) NOT NULL DEFAULT 'INGRESO',
        doc_type VARCHAR(50) DEFAULT 'Guía de Remisión',
        doc_number VARCHAR(100) DEFAULT '',
        supplier_notes VARCHAR(255) DEFAULT '',
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(255) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await seedInitialData();

  } catch (err) {
    console.error('❌ Error conectando o inicializando PostgreSQL:', err.message);
  }
}

async function seedInitialData() {
  try {
    const adminPassHash = bcrypt.hashSync('admin123', 10);
    const cajeroPassHash = bcrypt.hashSync('cajero123', 10);

    console.log('🌱 Verificando y sembrando catálogo ampliado de productos por defecto...');
    await pool.query(`
      INSERT INTO products (code, name, category, purchase_price, price, stock, min_stock) VALUES
      ('7750123001', 'Arroz Superior Costeño 1kg', 'Abarrotes', 3.80, 4.50, 50, 10),
      ('7750123002', 'Aceite Primor Clásico 1L', 'Abarrotes', 7.50, 9.20, 30, 8),
      ('7750123003', 'Leche Gloria Entera 390g', 'Lácteos', 3.20, 4.00, 100, 15),
      ('7750123004', 'Detergente Opal ULTRA 800g', 'Limpieza', 5.50, 7.00, 15, 10),
      ('7750123005', 'Gaseosa Coca Cola 1.5L', 'Bebidas', 5.00, 6.50, 24, 5),
      ('7750123006', 'Azúcar Rubia Dulfina 1kg', 'Abarrotes', 3.30, 4.00, 40, 10),
      ('7750123007', 'Fideos Molitalia Tallarín 500g', 'Abarrotes', 2.40, 3.20, 35, 8),
      ('7750123008', 'Atún Campomar Trozos de Atún 170g', 'Abarrotes', 4.20, 5.50, 30, 6),
      ('7750123009', 'Sal Yodada Emsal 1kg', 'Abarrotes', 1.20, 1.80, 50, 10),
      ('7750123010', 'Harina Preparada Blanca Flor 1kg', 'Abarrotes', 4.50, 5.80, 20, 5),
      ('7750123011', 'Avena 3 Ositos 500g', 'Abarrotes', 3.00, 4.00, 25, 5),
      ('7750123012', 'Mantequilla Laive 200g', 'Lácteos', 5.80, 7.50, 15, 4),
      ('7750123013', 'Yogurt Gloria Fresa 1L', 'Lácteos', 5.20, 6.80, 18, 5),
      ('7750123014', 'Queso Edam Laive 250g', 'Lácteos', 9.50, 12.50, 10, 3),
      ('7750123015', 'Gaseosa Inca Kola 1.5L', 'Bebidas', 5.00, 6.50, 24, 5),
      ('7750123016', 'Agua Mineral San Luis Sin Gas 620ml', 'Bebidas', 1.20, 2.00, 40, 10),
      ('7750123017', 'Cerveza Cusqueña Dorada 620ml', 'Bebidas', 5.50, 7.50, 36, 12),
      ('7750123018', 'Energizante Red Bull 250ml', 'Bebidas', 6.80, 9.00, 15, 5),
      ('7750123019', 'Jabón Bolívar Blanco 210g', 'Limpieza', 2.20, 3.00, 40, 8),
      ('7750123020', 'Lejía Clorox Tradicional 930ml', 'Limpieza', 3.20, 4.50, 25, 5),
      ('7750123021', 'Lavavajillas Ayudín Limón 450g', 'Limpieza', 4.00, 5.40, 20, 5),
      ('7750123022', 'Papel Higiénico Suave Doble Hoja 4 rollos', 'Limpieza', 4.80, 6.50, 30, 8),
      ('7750123023', 'Galletas Soda Field Paquete 6un', 'Snacks', 2.80, 3.80, 35, 10),
      ('7750123024', 'Chocolate Sublime Extragrande 40g', 'Snacks', 1.50, 2.20, 50, 15),
      ('7750123025', 'Papas Lays Clásicas 160g', 'Snacks', 4.50, 6.00, 20, 5),
      ('7750123026', 'Galletas Morochas Paquete 6un', 'Snacks', 2.80, 3.80, 30, 8),
      ('7750123027', 'Shampoo Head & Shoulders 375ml', 'Cuidado Personal', 14.50, 18.90, 12, 3),
      ('7750123028', 'Crema Dental Kolynos 75ml', 'Cuidado Personal', 3.20, 4.50, 25, 5),
      ('7750123029', 'Jabón de Tocador Camay 125g', 'Cuidado Personal', 2.10, 3.00, 30, 6),
      ('7750123030', 'Café Nescafé Tradicional 100g', 'Abarrotes', 9.80, 12.80, 15, 4)
      ON CONFLICT (code) DO NOTHING;
    `);

    const resCust = await pool.query('SELECT COUNT(*) FROM customers');
    if (parseInt(resCust.rows[0].count) === 0) {
      console.log('🌱 Sembrando datos iniciales de clientes...');
      await pool.query(`
        INSERT INTO customers (doc, name, phone, address, debt) VALUES
        ('45892301', 'Juan Pérez', '987654321', 'Av. Central 123', 0),
        ('10458923011', 'Comercial Don José S.A.C.', '912345678', 'Jr. Comercio 456', 57.50);
      `);
    }

    const resUsers = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(resUsers.rows[0].count) === 0) {
      console.log('🌱 Sembrando usuarios con contraseñas hacheadas bcrypt...');
      await pool.query(`
        INSERT INTO users (username, password, plain_password, name, role) VALUES
        ('admin', $1, 'admin123', 'Administrador Principal', 'Admin'),
        ('cajero', $2, 'cajero123', 'Cajero Turno Mañana', 'Cajero');
      `, [adminPassHash, cajeroPassHash]);
    } else {
      await pool.query("UPDATE users SET password = $1, plain_password = 'admin123' WHERE username = $2 AND (plain_password IS NULL OR plain_password = '');", [adminPassHash, 'admin']);
      await pool.query("UPDATE users SET password = $1, plain_password = 'cajero123' WHERE username = $2 AND (plain_password IS NULL OR plain_password = '');", [cajeroPassHash, 'cajero']);
    }
  } catch (err) {
    console.error('❌ Error sembrando datos iniciales:', err.message);
  }
}

initDb();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
