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
async function initDb(retries = 8, delay = 2000) {
  while (retries > 0) {
    try {
      const client = await pool.connect();
      console.log('✅ Base de Datos PostgreSQL conectada exitosamente.');
      client.release();
      break;
    } catch (err) {
      retries--;
      console.warn(`⏳ Esperando a PostgreSQL (${err.message})... Reintentos restantes: ${retries}`);
      if (retries === 0) {
        console.error('❌ Error conectando o inicializando PostgreSQL:', err.message);
        return;
      }
      await new Promise(res => setTimeout(res, delay));
    }
  }

  try {

    // 0. CATEGORÍAS INDEPENDIENTES
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO categories (name) VALUES 
        ('Abarrotes'), ('Bebidas'), ('Lácteos'), ('Limpieza'), ('Snacks'), 
        ('Panadería'), ('Cuidado Personal'), ('Promociones/Combos')
      ON CONFLICT (name) DO NOTHING;

      INSERT INTO categories (name) 
      SELECT DISTINCT category FROM products 
      WHERE category IS NOT NULL AND TRIM(category) != '' 
      ON CONFLICT (name) DO NOTHING;
    `);

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
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'Cajero',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    try { await pool.query("ALTER TABLE users DROP COLUMN IF EXISTS plain_password;"); } catch(e){}

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
        details TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE fiado_payments ALTER COLUMN details TYPE TEXT;
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

    // 10. DATOS DE LA EMPRESA / CONFIGURACIÓN DE TICKETS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id INT PRIMARY KEY DEFAULT 1,
        name VARCHAR(255) NOT NULL DEFAULT 'VALE-VENTAS by VALETEC',
        ruc VARCHAR(50) NOT NULL DEFAULT '20123456789',
        address VARCHAR(255) NOT NULL DEFAULT 'Av. Principal 123 - Lima, Perú',
        phone VARCHAR(50) NOT NULL DEFAULT '987654321',
        ticket_footer VARCHAR(255) NOT NULL DEFAULT '¡Gracias por su preferencia! Vuelva pronto.',
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO company_settings (id, name, ruc, address, phone, ticket_footer)
      VALUES (1, 'VALE-VENTAS by VALETEC', '20123456789', 'Av. Principal 123 - Lima, Perú', '987654321', '¡Gracias por su preferencia! Vuelva pronto.')
      ON CONFLICT (id) DO NOTHING;
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

    // Nota: El catálogo de productos no se siembra automáticamente al arrancar.
    // El Administrador puede cargar voluntariamente el Catálogo Base desde el botón en la vista de Inventario.

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
        INSERT INTO users (username, password, name, role) VALUES
        ('admin', $1, 'Administrador Principal', 'Admin'),
        ('cajero', $2, 'Cajero Turno Mañana', 'Cajero');
      `, [adminPassHash, cajeroPassHash]);
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
