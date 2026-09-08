// ==========================================
// Servidor Backend API VALEVENTAS (Express + WebSockets Socket.io + PostgreSQL + Rate Limiter Anti-Fuerza Bruta)
// VT VALETEC Standard Enterprise Server
// ==========================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

const PORT = process.env.PORT || 8090;
const JWT_SECRET = process.env.JWT_SECRET || 'valetec_jwt_super_secret_key_2026';

// Configuración de Rate Limiting para Login (Protección Anti-Fuerza Bruta)
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // Ventana de 1 minuto
  max: 20, // 20 intentos por IP dentro del minuto
  skipSuccessfulRequests: true, // No penalizar inicios de sesión exitosos
  message: { error: '⚠️ Demasiados intentos fallidos de inicio de sesión. Por seguridad, espere 1 minuto antes de reintentar.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Manejo de Conexiones WebSocket en Tiempo Real
io.on('connection', (socket) => {
  console.log(`🔌 Cliente WebSocket conectado (ID: ${socket.id})`);
  
  socket.on('disconnect', () => {
    console.log(`🔌 Cliente WebSocket desconectado (ID: ${socket.id})`);
  });
});

// Middleware de Autenticación JWT
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso no autorizado. Token JWT requerido.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada o token no válido.' });
  }
}

// Middleware para verificar Rol de Administrador
function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'Admin') {
    next();
  } else {
    res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de Administrador.' });
  }
}

// ==========================================
// 0. AUTENTICACIÓN (LOGIN CON PROTECCIÓN ANTI-FUERZA BRUTA & VERIFICACIÓN)
// ==========================================
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const match = bcrypt.compareSync(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });

  } catch (err) {
    console.error('❌ Error en login:', err.message);
    res.status(500).json({ error: 'Error al procesar el inicio de sesión.' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ==========================================
// 1. DASHBOARD & MÉTRICAS
// ==========================================
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const querySales = `
      SELECT 
        COALESCE(SUM(total), 0) AS "totalSales",
        COUNT(id) AS "ticketsCount"
      FROM sales
      WHERE DATE(created_at) = CURRENT_DATE AND status = 'completada'
    `;

    const queryFiados = `SELECT COALESCE(SUM(debt), 0) AS "totalDebt" FROM customers`;

    const queryTopProduct = `
      SELECT product_name, SUM(quantity) as "totalQty" 
      FROM sale_items 
      GROUP BY product_name 
      ORDER BY "totalQty" DESC 
      LIMIT 1
    `;

    const queryLowStock = `
      SELECT COUNT(id) AS "lowStockCount"
      FROM products
      WHERE stock <= min_stock
    `;

    const salesRes = await db.query(querySales);
    const fiadosRes = await db.query(queryFiados);
    const topProdRes = await db.query(queryTopProduct);
    const lowStockRes = await db.query(queryLowStock);

    res.json({
      todaySales: parseFloat(salesRes.rows[0].totalSales),
      todayTickets: parseInt(salesRes.rows[0].ticketsCount),
      totalFiadosDebt: parseFloat(fiadosRes.rows[0].totalDebt),
      topProduct: topProdRes.rows[0] ? topProdRes.rows[0].product_name : 'N/A',
      lowStockCount: parseInt(lowStockRes.rows[0].lowStockCount)
    });
  } catch (err) {
    console.error('❌ Error cargando dashboard:', err.message);
    res.status(500).json({ error: 'Error al obtener métricas del sistema.' });
  }
});

// ==========================================
// 2. PRODUCTOS (INVENTARIO)
// ==========================================
app.get('/api/products', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, 
        code, 
        name, 
        category, 
        purchase_price::float AS purchase_price, 
        price::float AS price, 
        stock, 
        min_stock, 
        created_at 
      FROM products 
      ORDER BY name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error obteniendo productos:', err.message);
    res.status(500).json({ error: 'Error al consultar inventario.' });
  }
});

app.post('/api/products', authMiddleware, adminOnly, async (req, res) => {
  const { code, name, category, purchase_price, price, stock, min_stock } = req.body;
  if (!code || !name || price === undefined) {
    return res.status(400).json({ error: 'Código, Nombre y Precio son requeridos.' });
  }

  try {
    const query = `
      INSERT INTO products (code, name, category, purchase_price, price, stock, min_stock)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, code, name, category, price::float, stock, min_stock
    `;
    const result = await db.query(query, [
      code,
      name,
      category || 'Abarrotes',
      purchase_price || 0,
      price,
      stock || 0,
      min_stock || 5
    ]);

    // Si el producto se registra con stock inicial > 0, asentar movimiento en Kardex
    if (parseInt(stock) > 0) {
      await db.query(`
        INSERT INTO stock_movements (product_id, product_name, quantity, type, doc_type, doc_number, supplier_notes, user_id, user_name)
        VALUES ($1, $2, $3, 'INGRESO_INICIAL', 'Inventario Inicial', $4, 'Stock inicial registrado al crear el producto', $5, $6)
      `, [result.rows[0].id, name, parseInt(stock), code, req.user?.id || null, req.user?.name || 'Administrador']);
    }

    // Emitir evento de cambio en inventario a todos los POS conectados
    io.emit('products_changed');

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error registrando producto:', err.message);
    res.status(500).json({ error: 'Error al guardar el producto.' });
  }
});

app.put('/api/products/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { code, name, category, purchase_price, price, stock, min_stock } = req.body;

  try {
    const query = `
      UPDATE products 
      SET code = $1, name = $2, category = $3, purchase_price = $4, price = $5, stock = $6, min_stock = $7
      WHERE id = $8
    `;
    await db.query(query, [code, name, category, purchase_price, price, stock, min_stock, id]);
    
    // Emitir evento en tiempo real
    io.emit('products_changed');

    res.json({ message: 'Producto actualizado con éxito' });
  } catch (err) {
    console.error('❌ Error actualizando producto:', err.message);
    res.status(500).json({ error: 'Error al actualizar el producto.' });
  }
});

// REABASTECIMIENTO DE STOCK DE PRODUCTO CON GUÍA DE REMISIÓN / FACTURA / MERMA / CORTESÍA
app.post('/api/products/:id/stock', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { quantity, doc_type, doc_number, supplier_notes, new_purchase_price, new_price, movement_type } = req.body;
  const qty = parseInt(quantity);

  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'La cantidad a ingresar debe ser un número entero mayor a 0.' });
  }

  const typeFinal = (movement_type || 'INGRESO').toUpperCase();
  const isDecrease = ['MERMA', 'CORTESIA', 'SALIDA_INTERNA'].includes(typeFinal);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const prodRes = await client.query('SELECT id, name, stock, purchase_price, price FROM products WHERE id = $1 FOR UPDATE', [id]);
    const product = prodRes.rows[0];

    if (!product) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }

    const updatedStock = isDecrease ? Math.max(0, product.stock - qty) : (product.stock + qty);
    const updateFields = ['stock = $1'];
    const updateParams = [updatedStock];
    let paramIdx = 2;

    if (new_purchase_price !== undefined && new_purchase_price !== null && new_purchase_price !== '') {
      updateFields.push(`purchase_price = $${paramIdx}`);
      updateParams.push(parseFloat(new_purchase_price) || 0);
      paramIdx++;
    }
    if (new_price !== undefined && new_price !== null && new_price !== '') {
      updateFields.push(`price = $${paramIdx}`);
      updateParams.push(parseFloat(new_price) || product.price);
      paramIdx++;
    }

    updateParams.push(id);
    await client.query(`UPDATE products SET ${updateFields.join(', ')} WHERE id = $${updateParams.length}`, updateParams);

    const docTypeFinal = doc_type || (isDecrease ? 'Sustento Interno' : 'Guía de Remisión');
    const docNumFinal = doc_number ? doc_number.trim() : '';
    const notesFinal = supplier_notes ? supplier_notes.trim() : '';

    await client.query(`
      INSERT INTO stock_movements (product_id, product_name, quantity, type, doc_type, doc_number, supplier_notes, user_id, user_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [id, product.name, qty, typeFinal, docTypeFinal, docNumFinal, notesFinal, req.user.id, req.user.name]);

    await client.query('COMMIT');

    io.emit('products_changed');

    const actionText = isDecrease ? `disminuido en -${qty} unds.` : `incrementado en +${qty} unds.`;
    res.json({
      success: true,
      message: `Stock de "${product.name}" ${actionText} (Total en stock: ${updatedStock})`,
      newStock: updatedStock
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error registrando movimiento de stock:', err.message);
    res.status(500).json({ error: 'Error al registrar movimiento de stock: ' + err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/movements', authMiddleware, async (req, res) => {
  const { type } = req.query;
  try {
    let whereClause = '';
    const params = [];
    if (type && type !== 'Todos') {
      whereClause = 'WHERE sm.type = $1';
      params.push(type);
    }

    const result = await db.query(`
      SELECT 
        sm.id, sm.product_id, sm.product_name, sm.quantity, sm.type, sm.doc_type, sm.doc_number, sm.supplier_notes, sm.user_id, COALESCE(sm.user_name, 'Sistema') AS user_name, sm.created_at
      FROM stock_movements sm
      ${whereClause}
      ORDER BY sm.id DESC
      LIMIT 300
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error obteniendo movimientos de inventario:', err.message);
    res.status(500).json({ error: 'Error al consultar movimientos de stock.' });
  }
});

app.delete('/api/products/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM products WHERE id = $1', [id]);
    
    // Emitir evento en tiempo real
    io.emit('products_changed');

    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    console.error('❌ Error eliminando producto:', err.message);
    res.status(500).json({ error: 'Error al eliminar el producto.' });
  }
});

// ==========================================
// 3. CLIENTES & CRM
// ==========================================
app.get('/api/customers', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, doc, name, phone, address, debt::float AS debt, created_at 
      FROM customers ORDER BY name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error obteniendo clientes:', err.message);
    res.status(500).json({ error: 'Error al consultar clientes.' });
  }
});

app.post('/api/customers', authMiddleware, async (req, res) => {
  const { doc, name, phone, address } = req.body;
  if (!doc || !name) {
    return res.status(400).json({ error: 'Documento (DNI/RUC) y Nombre son requeridos.' });
  }

  try {
    const query = `
      INSERT INTO customers (doc, name, phone, address, debt) 
      VALUES ($1, $2, $3, $4, 0)
      RETURNING id, doc, name, phone, address, debt::float
    `;
    const result = await db.query(query, [doc, name, phone || '', address || '']);
    
    io.emit('customers_changed');

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error registrando cliente:', err.message);
    if (err.code === '23505') {
      return res.status(400).json({ error: '⚠️ Ya existe un cliente registrado con este Documento (DNI/RUC).' });
    }
    res.status(500).json({ error: 'Error al registrar cliente.' });
  }
});

// ==========================================
// 4. MÓDULO DE CIERRE DE CAJA DIARIO (ARQUEO Z)
// ==========================================
app.get('/api/cash-register/current', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, 
        user_id, 
        user_name, 
        opening_amount::float AS opening_amount, 
        cash_sales::float AS cash_sales, 
        card_sales::float AS card_sales, 
        transfer_sales::float AS transfer_sales, 
        fiado_sales::float AS fiado_sales, 
        COALESCE(fiado_abonos, 0)::float AS fiado_abonos,
        COALESCE(total_withdrawals, 0)::float AS total_withdrawals,
        expected_cash::float AS expected_cash, 
        actual_cash::float AS actual_cash, 
        difference::float AS difference, 
        status, 
        opened_at, 
        closed_at 
      FROM cash_registers 
      WHERE status = 'abierta' 
      ORDER BY id DESC LIMIT 1
    `);
    const reg = result.rows[0] || null;
    if (reg) {
      reg.expected_cash = (parseFloat(reg.opening_amount) || 0) + (parseFloat(reg.cash_sales) || 0) + (parseFloat(reg.fiado_abonos) || 0) - (parseFloat(reg.total_withdrawals) || 0);
      const movs = await db.query("SELECT id, user_id, user_name, type, amount::float AS amount, reason, created_at FROM cash_movements WHERE cash_register_id = $1 ORDER BY id DESC", [reg.id]);
      reg.movements = movs.rows;

      const abonosRes = await db.query(`
        SELECT fp.id, fp.customer_id, COALESCE(c.name, 'Cliente Registrado') AS customer_name, COALESCE(c.doc, '-') AS customer_doc, COALESCE(fp.user_name, 'Sistema') AS user_name, fp.amount::float AS amount, fp.details, fp.created_at
        FROM fiado_payments fp
        LEFT JOIN customers c ON c.id = fp.customer_id
        WHERE fp.type = 'ABONO' AND fp.created_at >= $1
        ORDER BY fp.id DESC
      `, [reg.opened_at]);
      reg.shift_abonos = abonosRes.rows;
    }
    res.json(reg);
  } catch (err) {
    console.error('❌ Error obteniendo caja actual:', err.message);
    res.status(500).json({ error: 'Error obteniendo estado de caja.' });
  }
});

app.post('/api/cash-register/open', authMiddleware, async (req, res) => {
  const { opening_amount } = req.body;
  const initialAmt = parseFloat(opening_amount) || 0;

  try {
    const checkActive = await db.query("SELECT id FROM cash_registers WHERE status = 'abierta'");
    if (checkActive.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe una caja abierta actualmente.' });
    }

    const query = `
      INSERT INTO cash_registers (user_id, user_name, opening_amount, expected_cash, status)
      VALUES ($1, $2, $3, $3, 'abierta')
      RETURNING *
    `;
    const result = await db.query(query, [req.user.id, req.user.name, initialAmt]);
    
    io.emit('cash_register_changed');

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error abriendo caja:', err.message);
    res.status(500).json({ error: 'Error al abrir caja.' });
  }
});

// RETIRO DE EFECTIVO DE CAJA CON MOTIVO (Exclusivo Administrador)
app.post('/api/cash-register/movement', authMiddleware, adminOnly, async (req, res) => {
  const { amount, reason } = req.body;
  const withdrawalAmt = parseFloat(amount);

  if (isNaN(withdrawalAmt) || withdrawalAmt <= 0) {
    return res.status(400).json({ error: 'El monto del retiro debe ser un número mayor a 0.' });
  }
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'Debe ingresar un motivo o concepto para el retiro de caja.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const activeRes = await client.query("SELECT * FROM cash_registers WHERE status = 'abierta' ORDER BY id DESC LIMIT 1 FOR UPDATE");
    const activeRegister = activeRes.rows[0];

    if (!activeRegister) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay ninguna caja abierta para registrar el retiro.' });
    }

    await client.query(`
      INSERT INTO cash_movements (cash_register_id, user_id, user_name, type, amount, reason)
      VALUES ($1, $2, $3, 'RETIRO', $4, $5)
    `, [activeRegister.id, req.user.id, req.user.name, withdrawalAmt, reason.trim()]);

    const newWithdrawals = (parseFloat(activeRegister.total_withdrawals) || 0) + withdrawalAmt;
    const newExpected = (parseFloat(activeRegister.opening_amount) || 0) + (parseFloat(activeRegister.cash_sales) || 0) + (parseFloat(activeRegister.fiado_abonos) || 0) - newWithdrawals;

    await client.query(`
      UPDATE cash_registers 
      SET total_withdrawals = $1, expected_cash = $2 
      WHERE id = $3
    `, [newWithdrawals, newExpected, activeRegister.id]);

    await client.query('COMMIT');

    io.emit('cash_register_changed');

    res.json({
      success: true,
      message: `Retiro de S/ ${withdrawalAmt.toFixed(2)} registrado correctamente por ${req.user.name}`,
      newWithdrawals,
      newExpected
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error registrando retiro de caja:', err.message);
    res.status(500).json({ error: 'Error al registrar el retiro de caja.' });
  } finally {
    client.release();
  }
});

app.post('/api/cash-register/close', authMiddleware, async (req, res) => {
  const { actual_cash, notes } = req.body;
  const actualAmt = parseFloat(actual_cash) || 0;

  try {
    const activeRes = await db.query("SELECT * FROM cash_registers WHERE status = 'abierta' ORDER BY id DESC LIMIT 1");
    const activeRegister = activeRes.rows[0];

    if (!activeRegister) {
      return res.status(400).json({ error: 'No hay ninguna caja abierta para cerrar.' });
    }

    const expectedCash = (parseFloat(activeRegister.opening_amount) || 0) + 
                         (parseFloat(activeRegister.cash_sales) || 0) + 
                         (parseFloat(activeRegister.fiado_abonos) || 0) - 
                         (parseFloat(activeRegister.total_withdrawals) || 0);
    const difference = actualAmt - expectedCash;

    const updateQuery = `
      UPDATE cash_registers 
      SET 
        expected_cash = $1, 
        actual_cash = $2, 
        difference = $3, 
        status = 'cerrada', 
        notes = $4, 
        closed_at = CURRENT_TIMESTAMP 
      WHERE id = $5 
      RETURNING *
    `;

    const result = await db.query(updateQuery, [expectedCash, actualAmt, difference, notes || '', activeRegister.id]);
    
    io.emit('cash_register_changed');

    res.json({ success: true, message: 'Cierre Z completado correctamente', register: result.rows[0] });

  } catch (err) {
    console.error('❌ Error cerrando caja Z:', err.message);
    res.status(500).json({ error: 'Error al realizar el cierre de caja.' });
  }
});

// ==========================================
// 5. VENTAS & REPORTES AVANZADOS CON AUDITORÍA DE VENDEDOR
// ==========================================
app.get('/api/sales', authMiddleware, async (req, res) => {
  const { startDate, endDate, paymentMethod, docType, userId, q } = req.query;

  try {
    let whereConditions = ["s.status = 'completada'"];
    let queryParams = [];
    let paramIndex = 1;

    if (startDate) {
      whereConditions.push(`DATE(s.created_at) >= $${paramIndex}`);
      queryParams.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`DATE(s.created_at) <= $${paramIndex}`);
      queryParams.push(endDate);
      paramIndex++;
    }

    if (paymentMethod && paymentMethod !== 'Todos') {
      whereConditions.push(`s.payment_method = $${paramIndex}`);
      queryParams.push(paymentMethod);
      paramIndex++;
    }

    if (docType && docType !== 'Todos') {
      whereConditions.push(`s.doc_type = $${paramIndex}`);
      queryParams.push(docType);
      paramIndex++;
    }

    if (userId && userId !== 'Todos') {
      whereConditions.push(`s.user_id = $${paramIndex}`);
      queryParams.push(parseInt(userId));
      paramIndex++;
    }

    if (q && q.trim()) {
      const searchPattern = `%${q.trim().toLowerCase()}%`;
      whereConditions.push(`(LOWER(s.receipt_code) LIKE $${paramIndex} OR LOWER(s.customer_name) LIKE $${paramIndex} OR LOWER(s.user_name) LIKE $${paramIndex})`);
      queryParams.push(searchPattern);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    const salesQuery = `
      SELECT 
        s.id, 
        s.receipt_code, 
        s.doc_type, 
        s.customer_id,
        s.customer_name, 
        s.payment_method, 
        s.user_id,
        COALESCE(s.user_name, 'Administrador Principal') AS user_name,
        s.cash_register_id,
        s.total::float AS total,
        s.subtotal::float AS subtotal,
        s.tax::float AS tax,
        COALESCE(s.mixed_cash, 0)::float AS mixed_cash,
        COALESCE(s.mixed_other, 0)::float AS mixed_other,
        s.status, 
        s.created_at,
        COALESCE(
          (SELECT SUM((si.unit_price - COALESCE(p.purchase_price, 0)) * si.quantity)
           FROM sale_items si
           LEFT JOIN products p ON si.product_id = p.id
           WHERE si.sale_id = s.id), 0
        )::float AS profit
      FROM sales s
      WHERE ${whereClause}
      ORDER BY s.id DESC
    `;

    const result = await db.query(salesQuery, queryParams);
    const sales = result.rows;

    let totalSales = 0;
    let totalProfit = 0;
    let breakdown = { cash: 0, card: 0, transfer: 0, fiado: 0, fiadoAbonos: 0 };

    sales.forEach(s => {
      totalSales += s.total;
      totalProfit += s.profit;

      if (s.payment_method === 'Efectivo') breakdown.cash += s.total;
      else if (s.payment_method === 'Tarjeta') breakdown.card += s.total;
      else if (s.payment_method === 'Yape/Plin') breakdown.transfer += s.total;
      else if (s.payment_method === 'Fiado') breakdown.fiado += s.total;
      else if (s.payment_method === 'Pago Mixto') {
        breakdown.cash += (parseFloat(s.mixed_cash) || 0);
        breakdown.transfer += (parseFloat(s.mixed_other) || 0);
      }
    });

    // Consultar abonos de fiados para el informe de reportes
    let abonoConditions = ["fp.type = 'ABONO'"];
    let abonoParams = [];
    let abonoIdx = 1;

    if (startDate) {
      abonoConditions.push(`DATE(fp.created_at) >= $${abonoIdx}`);
      abonoParams.push(startDate);
      abonoIdx++;
    }
    if (endDate) {
      abonoConditions.push(`DATE(fp.created_at) <= $${abonoIdx}`);
      abonoParams.push(endDate);
      abonoIdx++;
    }

    const abonosResult = await db.query(`
      SELECT fp.id, fp.customer_id, COALESCE(c.name, 'Cliente Registrado') AS customer_name, COALESCE(c.doc, '-') AS customer_doc, COALESCE(fp.user_name, 'Sistema') AS user_name, fp.type, fp.amount::float AS amount, fp.details, fp.created_at
      FROM fiado_payments fp
      LEFT JOIN customers c ON c.id = fp.customer_id
      WHERE ${abonoConditions.join(' AND ')}
      ORDER BY fp.id DESC
    `, abonoParams);

    const abonos = abonosResult.rows;
    let totalFiadoAbonos = 0;
    abonos.forEach(a => { totalFiadoAbonos += a.amount; });
    breakdown.fiadoAbonos = totalFiadoAbonos;

    const ticketsCount = sales.length;
    const averageTicket = ticketsCount > 0 ? totalSales / ticketsCount : 0;

    res.json({
      summary: {
        totalSales,
        totalProfit,
        ticketsCount,
        averageTicket,
        breakdown
      },
      sales,
      abonos
    });

  } catch (err) {
    console.error('❌ Error filtrando ventas:', err.message);
    res.status(500).json({ error: 'Error al consultar reporte de ventas.' });
  }
});

// EDITAR VENTA (Solo Administrador - Permite ajustar método de pago, cliente y comprobante)
app.put('/api/sales/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { doc_type, payment_method, customer_id, customer_name } = req.body;
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const saleRes = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [id]);
    const oldSale = saleRes.rows[0];

    if (!oldSale || oldSale.status === 'anulada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La venta no existe o está anulada.' });
    }

    // Si cambió el método de pago a/desde FIADO, ajustar la deuda del cliente
    const oldTotal = parseFloat(oldSale.total);
    
    // 1. Revertir impacto de la antigua venta fiada si la había
    if (oldSale.payment_method === 'Fiado' && oldSale.customer_id) {
      const custRes = await client.query('SELECT debt::float FROM customers WHERE id = $1 FOR UPDATE', [oldSale.customer_id]);
      if (custRes.rows[0]) {
        const revertedDebt = Math.round(Math.max(0, custRes.rows[0].debt - oldTotal) * 100) / 100;
        await client.query('UPDATE customers SET debt = $1 WHERE id = $2', [revertedDebt, oldSale.customer_id]);
      }
    }

    // 2. Aplicar impacto del nuevo método de pago si es Fiado
    let finalCustId = customer_id !== undefined ? customer_id : oldSale.customer_id;
    let finalCustName = customer_name !== undefined ? customer_name : oldSale.customer_name;
    let finalDocType = doc_type || oldSale.doc_type;
    let finalPayMethod = payment_method || oldSale.payment_method;

    if (finalPayMethod === 'Fiado' && finalCustId) {
      const custRes = await client.query('SELECT debt::float FROM customers WHERE id = $1 FOR UPDATE', [finalCustId]);
      if (custRes.rows[0]) {
        const newDebt = Math.round((custRes.rows[0].debt + oldTotal) * 100) / 100;
        await client.query('UPDATE customers SET debt = $1 WHERE id = $2', [newDebt, finalCustId]);
      }
    }

    // 3. Actualizar la venta
    const updateQuery = `
      UPDATE sales 
      SET doc_type = $1, payment_method = $2, customer_id = $3, customer_name = $4
      WHERE id = $5
      RETURNING *
    `;
    const result = await client.query(updateQuery, [finalDocType, finalPayMethod, finalCustId || null, finalCustName || 'Público General', id]);

    await client.query('COMMIT');

    io.emit('sales_changed');
    io.emit('customers_changed');

    res.json({ success: true, message: 'Venta actualizada correctamente', sale: result.rows[0] });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error editando venta:', err.message);
    res.status(500).json({ error: 'Error al editar la venta.' });
  } finally {
    client.release();
  }
});

// OBTENER DETALLE DE UNA VENTA PARA REIMPRESIÓN (Admin o Cajero)
app.get('/api/sales/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const saleRes = await db.query(`
      SELECT 
        s.id, 
        s.receipt_code, 
        s.doc_type, 
        s.customer_id,
        s.customer_name, 
        s.payment_method, 
        s.user_id,
        COALESCE(s.user_name, 'Sistema') AS user_name,
        s.cash_register_id,
        s.total::float AS total,
        s.subtotal::float AS subtotal,
        s.tax::float AS tax,
        s.paid_amount::float AS paid_amount,
        s.change_amount::float AS change_amount,
        COALESCE(s.mixed_cash, 0)::float AS mixed_cash,
        COALESCE(s.mixed_other, 0)::float AS mixed_other,
        s.status, 
        s.created_at,
        c.doc AS customer_doc
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = $1
    `, [id]);

    if (saleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada.' });
    }

    const sale = saleRes.rows[0];
    const itemsRes = await db.query(`
      SELECT 
        id, 
        product_id, 
        product_name, 
        quantity, 
        unit_price::float AS unit_price, 
        total_price::float AS total_price
      FROM sale_items 
      WHERE sale_id = $1 
      ORDER BY id ASC
    `, [id]);

    sale.items = itemsRes.rows;
    res.json(sale);

  } catch (err) {
    console.error('❌ Error obteniendo venta para reimpresión:', err.message);
    res.status(500).json({ error: 'Error al consultar comprobante de venta.' });
  }
});

// ANULAR VENTA (Solo Administrador)
app.put('/api/sales/:id/anular', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const saleRes = await client.query(`
      SELECT 
        id, 
        receipt_code, 
        total::float, 
        customer_id, 
        payment_method, 
        status, 
        cash_register_id,
        COALESCE(mixed_cash, 0)::float AS mixed_cash,
        COALESCE(mixed_other, 0)::float AS mixed_other
      FROM sales 
      WHERE id = $1 
      FOR UPDATE
    `, [id]);
    const sale = saleRes.rows[0];

    if (!sale || sale.status === 'anulada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Venta no encontrada o ya anulada.' });
    }

    // 1. Devolver stock al inventario
    const itemsRes = await client.query('SELECT product_id, product_name, quantity FROM sale_items WHERE sale_id = $1', [id]);
    for (const item of itemsRes.rows) {
      if (item.product_id) {
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
        await client.query(`
          INSERT INTO stock_movements (product_id, product_name, quantity, type, doc_type, doc_number, supplier_notes, user_id, user_name)
          VALUES ($1, $2, $3, 'DEVOLUCION_VENTA', 'Anulación Venta', $4, $5, $6, $7)
        `, [item.product_id, item.product_name, item.quantity, sale.receipt_code, 'Restauración de stock por anulación de venta #' + id, req.user.id, req.user.name]);
      }
    }

    // 2. Revertir impacto si fue Fiado
    if (sale.payment_method === 'Fiado' && sale.customer_id) {
      const custRes = await client.query('SELECT debt::float FROM customers WHERE id = $1 FOR UPDATE', [sale.customer_id]);
      const newDebt = Math.round(Math.max(0, custRes.rows[0].debt - sale.total) * 100) / 100;
      await client.query('UPDATE customers SET debt = $1 WHERE id = $2', [newDebt, sale.customer_id]);
      await client.query(`
        INSERT INTO fiado_payments (customer_id, type, amount, details, balance_after)
        VALUES ($1, 'ANULACION', $2, $3, $4)
      `, [sale.customer_id, sale.total, 'Anulación de venta #' + id, newDebt]);
    }

    // 3. Ajuste contable en Caja Activa (Evita descuadre en Arqueo Z)
    let targetRegister = null;
    if (sale.cash_register_id) {
      const regRes = await client.query("SELECT * FROM cash_registers WHERE id = $1 AND status = 'abierta' FOR UPDATE", [sale.cash_register_id]);
      if (regRes.rows.length > 0) targetRegister = regRes.rows[0];
    }
    
    // Si no tenía cash_register_id o no coincidió, buscar la caja actualmente abierta
    if (!targetRegister) {
      const activeRegRes = await client.query("SELECT * FROM cash_registers WHERE status = 'abierta' ORDER BY id DESC LIMIT 1 FOR UPDATE");
      if (activeRegRes.rows.length > 0) targetRegister = activeRegRes.rows[0];
    }

    if (targetRegister) {
      if (sale.payment_method === 'Efectivo') {
        await client.query("UPDATE cash_registers SET cash_sales = GREATEST(0, cash_sales - $1) WHERE id = $2", [sale.total, targetRegister.id]);
      } else if (sale.payment_method === 'Tarjeta') {
        await client.query("UPDATE cash_registers SET card_sales = GREATEST(0, card_sales - $1) WHERE id = $2", [sale.total, targetRegister.id]);
      } else if (sale.payment_method === 'Yape/Plin') {
        await client.query("UPDATE cash_registers SET transfer_sales = GREATEST(0, transfer_sales - $1) WHERE id = $2", [sale.total, targetRegister.id]);
      } else if (sale.payment_method === 'Fiado') {
        await client.query("UPDATE cash_registers SET fiado_sales = GREATEST(0, fiado_sales - $1) WHERE id = $2", [sale.total, targetRegister.id]);
      } else if (sale.payment_method === 'Pago Mixto') {
        await client.query("UPDATE cash_registers SET cash_sales = GREATEST(0, cash_sales - $1), transfer_sales = GREATEST(0, transfer_sales - $2) WHERE id = $3", [sale.mixed_cash, sale.mixed_other, targetRegister.id]);
      }

      // Recalcular saldo esperado de caja en gaveta
      await client.query(`
        UPDATE cash_registers 
        SET expected_cash = opening_amount + cash_sales + COALESCE(fiado_abonos, 0) - COALESCE(total_withdrawals, 0) 
        WHERE id = $1
      `, [targetRegister.id]);
    }

    await client.query("UPDATE sales SET status = 'anulada' WHERE id = $1", [id]);
    await client.query('COMMIT');

    // Notificar actualización en tiempo real a todos los terminales POS
    io.emit('products_changed');
    io.emit('sales_changed');
    io.emit('cash_register_changed');
    if (sale.payment_method === 'Fiado') io.emit('customers_changed');

    res.json({ success: true, message: 'Venta anulada correctamente e importe descontado de caja', receipt_code: sale.receipt_code });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error anulando venta:', err.message);
    res.status(500).json({ error: 'Error al anular la venta.' });
  } finally {
    client.release();
  }
});

// PROCESAR NUEVA VENTA (CON AUDITORÍA DE VENDEDOR Y NOTIFICACIÓN WEBSOCKET)
app.post('/api/sales', authMiddleware, async (req, res) => {
  const { doc_type, customer_id, customer_name, payment_method, items, paid_amount, change_amount } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'El carrito no puede estar vacío.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // 0. Validar que exista una caja abierta en el turno actual
    const activeRegisterRes = await client.query("SELECT id FROM cash_registers WHERE status = 'abierta' ORDER BY id DESC LIMIT 1");
    const activeRegister = activeRegisterRes.rows[0];

    if (!activeRegister) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '⚠️ No hay ninguna caja abierta en este turno. Debe abrir la caja antes de procesar ventas.' });
    }

    if (payment_method === 'Fiado' && (!customer_id || parseInt(customer_id) <= 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '⚠️ Para registrar una venta a FIADO es obligatorio seleccionar un cliente registrado.' });
    }

    let total = 0;
    items.forEach(i => { total += i.quantity * i.unit_price; });

    const subtotal = total / 1.18;
    const tax = total - subtotal;

    const mixedCashAmt = payment_method === 'Pago Mixto' ? (parseFloat(req.body.mixed_cash) || 0) : 0;
    const mixedOtherAmt = payment_method === 'Pago Mixto' ? (parseFloat(req.body.mixed_other) || (total - mixedCashAmt)) : 0;

    // 1. Validar Stock
    const productIds = items.filter(i => i.product_id).map(i => i.product_id);
    if (productIds.length > 0) {
      const stockRes = await client.query('SELECT id, name, stock FROM products WHERE id = ANY($1::int[]) FOR UPDATE', [productIds]);
      const stockMap = new Map(stockRes.rows.map(r => [r.id, r]));

      for (const item of items) {
        if (item.product_id) {
          const product = stockMap.get(item.product_id);
          if (!product || product.stock < item.quantity) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Stock insuficiente para ${item.product_name}.` });
          }
        }
      }
    }

    // 2. Correlativo de Ticket Seguro y Atómico (Resistente a concurrencia y huecos)
    const docTypeFinal = doc_type || 'Ticket';
    const prefix = docTypeFinal === 'Factura' ? 'F' : (docTypeFinal === 'Boleta' ? 'B' : 'T');

    // Bloqueo consultivo por tipo de documento para serializar la asignación bajo concurrencia
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sales_correlativo_' || $1))", [docTypeFinal]);

    const maxRes = await client.query(`
      SELECT COALESCE(MAX(
        CAST(SUBSTRING(receipt_code FROM '-([0-9]+)$') AS INTEGER)
      ), 0) AS max_num
      FROM sales
      WHERE doc_type = $1
    `, [docTypeFinal]);

    let nextNum = parseInt(maxRes.rows[0].max_num) + 1;
    let receipt_code = `${prefix}001-${String(nextNum).padStart(6, '0')}`;

    // Verificación defensiva contra duplicados
    while (true) {
      const existsCheck = await client.query('SELECT id FROM sales WHERE receipt_code = $1', [receipt_code]);
      if (existsCheck.rows.length === 0) break;
      nextNum++;
      receipt_code = `${prefix}001-${String(nextNum).padStart(6, '0')}`;
    }

    // 3. Insertar Venta con auditoría de vendedor y caja
    const sellerId = req.user.id;
    const sellerName = req.user.name;

    const saleInsertRes = await client.query(`
      INSERT INTO sales (receipt_code, doc_type, customer_id, customer_name, payment_method, subtotal, tax, total, paid_amount, change_amount, user_id, user_name, cash_register_id, mixed_cash, mixed_other)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id
    `, [receipt_code, doc_type || 'Ticket', customer_id || null, customer_name || 'Público General', payment_method, subtotal, tax, total, paid_amount || total, change_amount || 0, sellerId, sellerName, activeRegister.id, mixedCashAmt, mixedOtherAmt]);

    const saleId = saleInsertRes.rows[0].id;

    // 4. Detalle y Descuento Stock
    for (const item of items) {
      const itemSubtotal = item.quantity * item.unit_price;
      await client.query(`
        INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, total_price)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [saleId, item.product_id, item.product_name, item.quantity, item.unit_price, itemSubtotal]);

      if (item.product_id) {
        await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.product_id]);
        await client.query(`
          INSERT INTO stock_movements (product_id, product_name, quantity, type, doc_type, doc_number, supplier_notes, user_id, user_name)
          VALUES ($1, $2, $3, 'VENTA', $4, $5, 'Salida por venta en POS', $6, $7)
        `, [item.product_id, item.product_name, item.quantity, docTypeFinal, receipt_code, sellerId, sellerName]);
      }
    }

    // 5. Fiado
    if (payment_method === 'Fiado' && customer_id) {
      const custRes = await client.query('SELECT debt::float FROM customers WHERE id = $1 FOR UPDATE', [customer_id]);
      const newDebt = Math.round(((custRes.rows[0] ? custRes.rows[0].debt : 0) + total) * 100) / 100;
      const details = items.map(i => `${i.quantity}x ${i.product_name}`).join(', ');

      await client.query('UPDATE customers SET debt = $1 WHERE id = $2', [customer_id, newDebt]);
      await client.query(`
        INSERT INTO fiado_payments (customer_id, user_id, user_name, type, payment_method, amount, details, balance_after)
        VALUES ($1, $2, $3, 'COMPRA_FIADA', 'Fiado', $4, $5, $6)
      `, [customer_id, sellerId, sellerName, total, details, newDebt]);
    }

    // 6. Acumular venta en la caja abierta del turno
    if (payment_method === 'Efectivo') {
      await client.query("UPDATE cash_registers SET cash_sales = cash_sales + $1 WHERE id = $2", [total, activeRegister.id]);
    } else if (payment_method === 'Tarjeta') {
      await client.query("UPDATE cash_registers SET card_sales = card_sales + $1 WHERE id = $2", [total, activeRegister.id]);
    } else if (payment_method === 'Yape/Plin') {
      await client.query("UPDATE cash_registers SET transfer_sales = transfer_sales + $1 WHERE id = $2", [total, activeRegister.id]);
    } else if (payment_method === 'Pago Mixto') {
      await client.query("UPDATE cash_registers SET cash_sales = cash_sales + $1, transfer_sales = transfer_sales + $2 WHERE id = $3", [mixedCashAmt, mixedOtherAmt, activeRegister.id]);
    } else if (payment_method === 'Fiado') {
      await client.query("UPDATE cash_registers SET fiado_sales = fiado_sales + $1 WHERE id = $2", [total, activeRegister.id]);
    }

    await client.query('COMMIT');

    // Transmisión WebSocket en Tiempo Real a Todas las Cajas
    io.emit('products_changed');
    io.emit('sales_changed');
    io.emit('cash_register_changed');
    if (payment_method === 'Fiado') io.emit('customers_changed');

    res.json({ success: true, receipt_code, saleId, total, payment_method, sellerName });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error procesando venta:', err.message);
    res.status(500).json({ error: 'Error procesando la venta: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 6. MÓDULO FIADOS & ABONOS
// ==========================================
app.get('/api/fiados/:customerId', authMiddleware, async (req, res) => {
  const { customerId } = req.params;
  try {
    const result = await db.query(`
      SELECT id, customer_id, type, COALESCE(payment_method, 'Efectivo') AS payment_method, amount::float AS amount, balance_after::float AS balance_after, details, created_at 
      FROM fiado_payments WHERE customer_id = $1 ORDER BY id DESC
    `, [customerId]);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error consultando fiados:', err.message);
    res.status(500).json({ error: 'Error consultando fiados.' });
  }
});

app.post('/api/fiados/abono', authMiddleware, async (req, res) => {
  const { customer_id, amount, payment_method } = req.body;
  const abonoAmt = parseFloat(amount);
  const payMethod = payment_method || 'Efectivo';

  if (!customer_id || isNaN(abonoAmt) || abonoAmt <= 0) {
    return res.status(400).json({ error: 'Monto de abono válido es requerido.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const custRes = await client.query('SELECT debt::float, name FROM customers WHERE id = $1 FOR UPDATE', [customer_id]);
    const customer = custRes.rows[0];

    if (!customer) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    const newDebt = Math.round(Math.max(0, customer.debt - abonoAmt) * 100) / 100;
    await client.query('UPDATE customers SET debt = $1 WHERE id = $2', [newDebt, customer_id]);

    await client.query(`
      INSERT INTO fiado_payments (customer_id, user_id, user_name, type, payment_method, amount, details, balance_after)
      VALUES ($1, $2, $3, 'ABONO', $4, $5, $6, $7)
    `, [customer_id, req.user.id, req.user.name, payMethod, abonoAmt, `Abono / Pago en ${payMethod}`, newDebt]);

    let updateCashSql = "UPDATE cash_registers SET fiado_abonos = COALESCE(fiado_abonos, 0) + $1 WHERE status = 'abierta'";
    if (payMethod === 'Efectivo') {
      updateCashSql = "UPDATE cash_registers SET fiado_abonos = COALESCE(fiado_abonos, 0) + $1 WHERE status = 'abierta'";
    } else if (payMethod === 'Tarjeta') {
      updateCashSql = "UPDATE cash_registers SET card_sales = card_sales + $1 WHERE status = 'abierta'";
    } else if (payMethod === 'Yape/Plin') {
      updateCashSql = "UPDATE cash_registers SET transfer_sales = transfer_sales + $1 WHERE status = 'abierta'";
    }
    await client.query(updateCashSql, [abonoAmt]);

    await client.query('COMMIT');

    io.emit('customers_changed');
    io.emit('cash_register_changed');

    const abonoCode = `AB-${String(Date.now()).slice(-6)}`;
    res.json({
      success: true,
      message: `Abono de S/ ${abonoAmt.toFixed(2)} (${payMethod}) registrado correctamente por ${req.user.name}`,
      receipt_code: abonoCode,
      customer_name: customer.name,
      user_name: req.user.name,
      amount: abonoAmt,
      payment_method: payMethod,
      newDebt
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error registrando abono:', err.message);
    res.status(500).json({ error: 'Error al registrar abono.' });
  } finally {
    client.release();
  }
});

// ANULAR ABONO DE DEUDA (Solo Administrador)
app.post('/api/fiados/abono/:id/anular', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const paymentRes = await client.query('SELECT id, customer_id, type, amount::float, payment_method, details FROM fiado_payments WHERE id = $1 FOR UPDATE', [id]);
    const payment = paymentRes.rows[0];

    if (!payment || payment.type !== 'ABONO') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El registro no existe o no es un abono válido para anular.' });
    }

    if (payment.details && payment.details.includes('[ANULADO]')) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este abono ya se encuentra anulado.' });
    }

    const custRes = await client.query('SELECT debt::float, name FROM customers WHERE id = $1 FOR UPDATE', [payment.customer_id]);
    const customer = custRes.rows[0];
    if (!customer) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    // 1. Restaurar la deuda del cliente
    const restoredDebt = Math.round((customer.debt + payment.amount) * 100) / 100;
    await client.query('UPDATE customers SET debt = $1 WHERE id = $2', [restoredDebt, payment.customer_id]);

    // 2. Registrar el movimiento de anulación en el historial
    await client.query(`
      INSERT INTO fiado_payments (customer_id, user_id, user_name, type, payment_method, amount, details, balance_after)
      VALUES ($1, $2, $3, 'ANULACION_ABONO', $4, $5, $6, $7)
    `, [payment.customer_id, req.user.id, req.user.name, payment.payment_method, payment.amount, `Anulación de Abono #${payment.id}`, restoredDebt]);

    // 3. Revertir el dinero de la caja del turno si sigue abierta
    if (payment.payment_method === 'Efectivo') {
      await client.query("UPDATE cash_registers SET fiado_abonos = GREATEST(0, COALESCE(fiado_abonos, 0) - $1) WHERE status = 'abierta'", [payment.amount]);
    } else if (payment.payment_method === 'Tarjeta') {
      await client.query("UPDATE cash_registers SET card_sales = GREATEST(0, card_sales - $1) WHERE status = 'abierta'", [payment.amount]);
    } else if (payment.payment_method === 'Yape/Plin') {
      await client.query("UPDATE cash_registers SET transfer_sales = GREATEST(0, transfer_sales - $1) WHERE status = 'abierta'", [payment.amount]);
    }

    // 4. Marcar el abono original como anulado
    await client.query("UPDATE fiado_payments SET details = details || ' [ANULADO]' WHERE id = $1", [id]);

    await client.query('COMMIT');

    io.emit('customers_changed');
    io.emit('cash_register_changed');

    res.json({
      success: true,
      message: `Abono #${id} por S/ ${payment.amount.toFixed(2)} anulado correctamente. Deuda restaurada a S/ ${restoredDebt.toFixed(2)}`,
      restoredDebt
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error anulando abono:', err.message);
    res.status(500).json({ error: 'Error anulando abono: ' + err.message });
  } finally {
    client.release();
  }
});


// ==========================================
// 7. GESTIÓN DE USUARIOS Y ROLES (ADMIN ONLY)
// ==========================================
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, name, role, plain_password, created_at FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error obteniendo usuarios:', err.message);
    res.status(500).json({ error: 'Error al consultar usuarios.' });
  }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios (Usuario, Contraseña, Nombre, Rol).' });
  }

  try {
    const passHash = bcrypt.hashSync(password.trim(), 10);
    const plainPass = password.trim();
    const query = `
      INSERT INTO users (username, password, plain_password, name, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, name, role, plain_password, created_at
    `;
    const result = await db.query(query, [username.trim(), passHash, plainPass, name.trim(), role]);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('❌ Error creando usuario:', err.message);
    res.status(400).json({ error: 'El nombre de usuario ya existe o los datos son inválidos.' });
  }
});

app.put('/api/users/:id/password', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.trim().length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
  }

  try {
    const passHash = bcrypt.hashSync(newPassword.trim(), 10);
    const plainPass = newPassword.trim();
    await db.query('UPDATE users SET password = $1, plain_password = $2 WHERE id = $3', [passHash, plainPass, id]);
    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('❌ Error actualizando contraseña:', err.message);
    res.status(500).json({ error: 'Error al cambiar la contraseña del usuario.' });
  }
});

// ==========================================
// 8. CONFIGURACIÓN DEL NEGOCIO / BRANDING DE TICKETS
// ==========================================
app.get('/api/settings/company', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM company_settings WHERE id = 1');
    if (result.rows.length === 0) {
      return res.json({
        id: 1,
        name: 'VALE-VENTAS by VALETEC',
        ruc: '20123456789',
        address: 'Av. Principal 123 - Lima, Perú',
        phone: '987654321',
        ticket_footer: '¡Gracias por su preferencia! Vuelva pronto.'
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error obteniendo datos de la empresa:', err.message);
    res.status(500).json({ error: 'Error consultando datos de la empresa.' });
  }
});

app.put('/api/settings/company', authMiddleware, adminOnly, async (req, res) => {
  const { name, ruc, address, phone, ticket_footer } = req.body;
  if (!name || !ruc) {
    return res.status(400).json({ error: 'El Nombre del Negocio y el RUC son obligatorios.' });
  }

  try {
    const query = `
      INSERT INTO company_settings (id, name, ruc, address, phone, ticket_footer, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        ruc = EXCLUDED.ruc,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        ticket_footer = EXCLUDED.ticket_footer,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await db.query(query, [
      name.trim(),
      ruc.trim(),
      (address || '').trim(),
      (phone || '').trim(),
      (ticket_footer || '¡Gracias por su preferencia! Vuelva pronto.').trim()
    ]);

    const updated = result.rows[0];
    io.emit('settings_changed', updated);

    res.json({ success: true, message: 'Datos de la empresa actualizados correctamente', settings: updated });
  } catch (err) {
    console.error('❌ Error actualizando datos de la empresa:', err.message);
    res.status(500).json({ error: 'Error al actualizar configuración de la empresa.' });
  }
});

// ==========================================
// 9. COPIA DE SEGURIDAD (BACKUP) DE BASE DE DATOS EN 1 CLIC
// ==========================================
app.get('/api/backup/download', authMiddleware, adminOnly, async (req, res) => {
  try {
    console.log(`📦 Generando copia de seguridad solicitada por ${req.user.name}...`);
    const [
      settings,
      users,
      products,
      customers,
      sales,
      saleItems,
      cashRegisters,
      cashMovements,
      fiadoPayments,
      stockMovements
    ] = await Promise.all([
      db.query('SELECT * FROM company_settings'),
      db.query('SELECT id, username, name, role, plain_password, created_at FROM users'),
      db.query('SELECT * FROM products ORDER BY id ASC'),
      db.query('SELECT * FROM customers ORDER BY id ASC'),
      db.query('SELECT * FROM sales ORDER BY id ASC'),
      db.query('SELECT * FROM sale_items ORDER BY id ASC'),
      db.query('SELECT * FROM cash_registers ORDER BY id ASC'),
      db.query('SELECT * FROM cash_movements ORDER BY id ASC'),
      db.query('SELECT * FROM fiado_payments ORDER BY id ASC'),
      db.query('SELECT * FROM stock_movements ORDER BY id ASC')
    ]);

    const backupData = {
      system: 'VALEVENTAS POS by VT VALETEC',
      version: '2.0',
      exported_at: new Date().toISOString(),
      exported_by: {
        id: req.user.id,
        name: req.user.name,
        username: req.user.username
      },
      counts: {
        products: products.rows.length,
        customers: customers.rows.length,
        sales: sales.rows.length,
        cash_registers: cashRegisters.rows.length
      },
      data: {
        company_settings: settings.rows,
        users: users.rows,
        products: products.rows,
        customers: customers.rows,
        sales: sales.rows,
        sale_items: saleItems.rows,
        cash_registers: cashRegisters.rows,
        cash_movements: cashMovements.rows,
        fiado_payments: fiadoPayments.rows,
        stock_movements: stockMovements.rows
      }
    };

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const fileName = `valeventas_backup_${dateStr}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(backupData, null, 2));

  } catch (err) {
    console.error('❌ Error generando copia de seguridad:', err.message);
    res.status(500).json({ error: 'Error al generar la copia de seguridad: ' + err.message });
  }
});

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor VALEVENTAS (Anti-Fuerza Bruta + WebSockets Socket.io + PostgreSQL Enterprise) activo en http://localhost:${PORT}`);
});
