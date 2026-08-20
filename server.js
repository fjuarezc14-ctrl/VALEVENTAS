// ==========================================
// Servidor Backend API VALEVENTAS (Express + WebSockets Socket.io + PostgreSQL + JWT Auth + RBAC)
// VT VALETEC Standard Enterprise Server
// ==========================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
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
// 0. AUTENTICACIÓN (LOGIN & VERIFICACIÓN)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
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
app.get('/api/dashboard', async (req, res) => {
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
app.get('/api/customers', async (req, res) => {
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
    res.status(500).json({ error: 'Error al registrar cliente.' });
  }
});

// ==========================================
// 4. MÓDULO DE CIERRE DE CAJA DIARIO (ARQUEO Z)
// ==========================================
app.get('/api/cash-register/current', async (req, res) => {
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
    res.json(result.rows[0] || null);
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

app.post('/api/cash-register/close', authMiddleware, async (req, res) => {
  const { actual_cash, notes } = req.body;
  const actualAmt = parseFloat(actual_cash) || 0;

  try {
    const activeRes = await db.query("SELECT * FROM cash_registers WHERE status = 'abierta' ORDER BY id DESC LIMIT 1");
    const activeRegister = activeRes.rows[0];

    if (!activeRegister) {
      return res.status(400).json({ error: 'No hay ninguna caja abierta para cerrar.' });
    }

    const expectedCash = parseFloat(activeRegister.opening_amount) + parseFloat(activeRegister.cash_sales);
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
app.get('/api/sales', async (req, res) => {
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
        s.customer_name, 
        s.payment_method, 
        s.user_id,
        COALESCE(s.user_name, 'Administrador Principal') AS user_name,
        s.cash_register_id,
        s.total::float AS total,
        s.subtotal::float AS subtotal,
        s.tax::float AS tax,
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
    let breakdown = { cash: 0, card: 0, transfer: 0, fiado: 0 };

    sales.forEach(s => {
      totalSales += s.total;
      totalProfit += s.profit;

      if (s.payment_method === 'Efectivo') breakdown.cash += s.total;
      else if (s.payment_method === 'Tarjeta') breakdown.card += s.total;
      else if (s.payment_method === 'Yape/Plin') breakdown.transfer += s.total;
      else if (s.payment_method === 'Fiado') breakdown.fiado += s.total;
    });

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
      sales
    });

  } catch (err) {
    console.error('❌ Error filtrando ventas:', err.message);
    res.status(500).json({ error: 'Error al consultar reporte de ventas.' });
  }
});

// ANULAR VENTA (Solo Administrador)
app.put('/api/sales/:id/anular', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const saleRes = await client.query('SELECT id, receipt_code, total::float, customer_id, payment_method, status FROM sales WHERE id = $1 FOR UPDATE', [id]);
    const sale = saleRes.rows[0];

    if (!sale || sale.status === 'anulada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Venta no encontrada o ya anulada.' });
    }

    const itemsRes = await client.query('SELECT product_id, product_name, quantity FROM sale_items WHERE sale_id = $1', [id]);
    for (const item of itemsRes.rows) {
      if (item.product_id) {
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
      }
    }

    if (sale.payment_method === 'Fiado' && sale.customer_id) {
      const custRes = await client.query('SELECT debt::float FROM customers WHERE id = $1 FOR UPDATE', [sale.customer_id]);
      const newDebt = Math.max(0, custRes.rows[0].debt - sale.total);
      await client.query('UPDATE customers SET debt = $1 WHERE id = $2', [newDebt, sale.customer_id]);
      await client.query(`
        INSERT INTO fiado_payments (customer_id, type, amount, details, balance_after)
        VALUES ($1, 'ANULACION', $2, $3, $4)
      `, [sale.customer_id, sale.total, 'Anulación de venta #' + id, newDebt]);
    }

    await client.query("UPDATE sales SET status = 'anulada' WHERE id = $1", [id]);
    await client.query('COMMIT');

    // Notificar actualización en tiempo real a todos los terminales POS
    io.emit('products_changed');
    io.emit('sales_changed');
    io.emit('cash_register_changed');

    res.json({ success: true, message: 'Venta anulada correctamente', receipt_code: sale.receipt_code });

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

    let total = 0;
    items.forEach(i => { total += i.quantity * i.unit_price; });

    const subtotal = total / 1.18;
    const tax = total - subtotal;

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

    // 2. Correlativo de Ticket
    const prefix = doc_type === 'Factura' ? 'F' : (doc_type === 'Boleta' ? 'B' : 'T');
    const countRes = await client.query('SELECT COUNT(id) FROM sales WHERE doc_type = $1', [doc_type || 'Ticket']);
    const nextNum = parseInt(countRes.rows[0].count) + 1;
    const receipt_code = `${prefix}001-${String(nextNum).padStart(6, '0')}`;

    // 3. Insertar Venta con auditoría de vendedor y caja
    const sellerId = req.user.id;
    const sellerName = req.user.name;

    const saleInsertRes = await client.query(`
      INSERT INTO sales (receipt_code, doc_type, customer_id, customer_name, payment_method, subtotal, tax, total, paid_amount, change_amount, user_id, user_name, cash_register_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [receipt_code, doc_type || 'Ticket', customer_id || null, customer_name || 'Público General', payment_method, subtotal, tax, total, paid_amount || total, change_amount || 0, sellerId, sellerName, activeRegister.id]);

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
      }
    }

    // 5. Fiado
    if (payment_method === 'Fiado' && customer_id) {
      const custRes = await client.query('SELECT debt::float FROM customers WHERE id = $1 FOR UPDATE', [customer_id]);
      const newDebt = (custRes.rows[0] ? custRes.rows[0].debt : 0) + total;
      const details = items.map(i => `${i.quantity}x ${i.product_name}`).join(', ');

      await client.query('UPDATE customers SET debt = $1 WHERE id = $2', [customer_id, newDebt]);
      await client.query(`
        INSERT INTO fiado_payments (customer_id, type, amount, details, balance_after)
        VALUES ($1, 'COMPRA_FIADA', $2, $3, $4)
      `, [customer_id, total, details, newDebt]);
    }

    // 6. Acumular venta en la caja abierta del turno
    if (payment_method === 'Efectivo') {
      await client.query("UPDATE cash_registers SET cash_sales = cash_sales + $1 WHERE id = $2", [total, activeRegister.id]);
    } else if (payment_method === 'Tarjeta') {
      await client.query("UPDATE cash_registers SET card_sales = card_sales + $1 WHERE id = $2", [total, activeRegister.id]);
    } else if (payment_method === 'Yape/Plin') {
      await client.query("UPDATE cash_registers SET transfer_sales = transfer_sales + $1 WHERE id = $2", [total, activeRegister.id]);
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
    res.status(500).json({ error: 'Error procesando la venta.' });
  } finally {
    client.release();
  }
});

// ==========================================
// 6. MÓDULO FIADOS & ABONOS
// ==========================================
app.get('/api/fiados/:customerId', async (req, res) => {
  const { customerId } = req.params;
  try {
    const result = await db.query(`
      SELECT id, customer_id, type, amount::float AS amount, balance_after::float AS balance_after, details, created_at 
      FROM fiado_payments WHERE customer_id = $1 ORDER BY id DESC
    `, [customerId]);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error consultando fiados:', err.message);
    res.status(500).json({ error: 'Error consultando fiados.' });
  }
});

app.post('/api/fiados/abono', authMiddleware, async (req, res) => {
  const { customer_id, amount } = req.body;
  const abonoAmt = parseFloat(amount);

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

    const newDebt = Math.max(0, customer.debt - abonoAmt);
    await client.query('UPDATE customers SET debt = $1 WHERE id = $2', [newDebt, customer_id]);

    await client.query(`
      INSERT INTO fiado_payments (customer_id, type, amount, details, balance_after)
      VALUES ($1, 'ABONO', $2, 'Abono / Pago en efectivo', $3)
    `, [customer_id, abonoAmt, newDebt]);

    await client.query("UPDATE cash_registers SET cash_sales = cash_sales + $1 WHERE status = 'abierta'", [abonoAmt]);

    await client.query('COMMIT');

    io.emit('customers_changed');
    io.emit('cash_register_changed');

    res.json({ success: true, message: `Abono de S/ ${abonoAmt.toFixed(2)} registrado correctamente`, newDebt });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error registrando abono:', err.message);
    res.status(500).json({ error: 'Error al registrar abono.' });
  } finally {
    client.release();
  }
});

// ==========================================
// 7. GESTIÓN DE USUARIOS Y ROLES (ADMIN ONLY)
// ==========================================
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, name, role, created_at FROM users ORDER BY id ASC');
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
    const query = `
      INSERT INTO users (username, password, name, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, name, role, created_at
    `;
    const result = await db.query(query, [username.trim(), passHash, name.trim(), role]);
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
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [passHash, id]);
    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('❌ Error actualizando contraseña:', err.message);
    res.status(500).json({ error: 'Error al cambiar la contraseña del usuario.' });
  }
});

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor VALEVENTAS (WebSockets Socket.io + PostgreSQL Enterprise + JWT Auth) activo en http://localhost:${PORT}`);
});
