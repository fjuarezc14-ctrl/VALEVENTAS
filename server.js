const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8090;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. DASHBOARD & MÉTRICAS
// ==========================================
app.get('/api/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const querySales = `
    SELECT 
      COALESCE(SUM(total), 0) AS totalSales,
      COUNT(id) AS ticketsCount
    FROM sales
    WHERE DATE(created_at) = DATE('now', 'localtime')
  `;

  const queryFiados = `SELECT COALESCE(SUM(debt), 0) AS totalDebt FROM customers`;

  const queryTopProduct = `
    SELECT product_name, SUM(quantity) as totalQty 
    FROM sale_items 
    GROUP BY product_name 
    ORDER BY totalQty DESC 
    LIMIT 1
  `;

  db.get(querySales, [], (err, salesRow) => {
    if (err) return res.status(500).json({ error: err.message });

    db.get(queryFiados, [], (err, fiadoRow) => {
      if (err) return res.status(500).json({ error: err.message });

      db.get(queryTopProduct, [], (err, topProdRow) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json({
          todaySales: salesRow ? salesRow.totalSales : 0,
          todayTickets: salesRow ? salesRow.ticketsCount : 0,
          totalFiadosDebt: fiadoRow ? fiadoRow.totalDebt : 0,
          topProduct: topProdRow ? topProdRow.product_name : 'N/A'
        });
      });
    });
  });
});

// ==========================================
// 2. PRODUCTOS (INVENTARIO)
// ==========================================
app.get('/api/products', (req, res) => {
  db.all('SELECT * FROM products ORDER BY name ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/products', (req, res) => {
  const { code, name, category, purchase_price, price, stock, min_stock } = req.body;
  if (!code || !name || !price) {
    return res.status(400).json({ error: 'Código, Nombre y Precio son requeridos.' });
  }

  const query = `
    INSERT INTO products (code, name, category, purchase_price, price, stock, min_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [code, name, category || 'Abarrotes', purchase_price || 0, price, stock || 0, min_stock || 5], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, code, name, category, price, stock });
  });
});

app.put('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const { code, name, category, purchase_price, price, stock, min_stock } = req.body;

  const query = `
    UPDATE products 
    SET code = ?, name = ?, category = ?, purchase_price = ?, price = ?, stock = ?, min_stock = ?
    WHERE id = ?
  `;

  db.run(query, [code, name, category, purchase_price, price, stock, min_stock, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Producto actualizado con éxito' });
  });
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM products WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Producto eliminado' });
  });
});

// ==========================================
// 3. CLIENTES & CRM
// ==========================================
app.get('/api/customers', (req, res) => {
  db.all('SELECT * FROM customers ORDER BY name ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/customers', (req, res) => {
  const { doc, name, phone, address } = req.body;
  if (!doc || !name) {
    return res.status(400).json({ error: 'Documento (DNI/RUC) y Nombre son requeridos.' });
  }

  const query = `INSERT INTO customers (doc, name, phone, address, debt) VALUES (?, ?, ?, ?, 0)`;
  db.run(query, [doc, name, phone || '', address || ''], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, doc, name, phone, address, debt: 0 });
  });
});

// ==========================================
// 4. VENTAS & POS
// ==========================================
app.get('/api/sales', (req, res) => {
  const query = `
    SELECT id, receipt_code, doc_type, customer_name, payment_method, total, status, created_at
    FROM sales
    ORDER BY id DESC
    LIMIT 100
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ANULAR VENTA - El admin puede anular una venta (no elimina, marca como anulada y devuelve stock)
app.put('/api/sales/:id/anular', (req, res) => {
  const { id } = req.params;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.get("SELECT id, receipt_code, total, customer_id, payment_method, status FROM sales WHERE id = ?", [id], (err, sale) => {
      if (err) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: err.message });
      }

      if (!sale) {
        db.run("ROLLBACK");
        return res.status(404).json({ error: 'Venta no encontrada.' });
      }

      if (sale.status === 'anulada') {
        db.run("ROLLBACK");
        return res.status(400).json({ error: 'Esta venta ya fue anulada.' });
      }

      db.all("SELECT product_id, product_name, quantity FROM sale_items WHERE sale_id = ?", [id], (err, items) => {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        const stockStmt = db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
        items.forEach(item => {
          if (item.product_id) {
            stockStmt.run([item.quantity, item.product_id]);
          }
        });
        stockStmt.finalize();

        if (sale.payment_method === 'Fiado' && sale.customer_id) {
          db.get("SELECT debt FROM customers WHERE id = ?", [sale.customer_id], (err, custRow) => {
            const currentDebt = custRow ? custRow.debt : 0;
            const newDebt = Math.max(0, currentDebt - sale.total);

            db.run("UPDATE customers SET debt = ? WHERE id = ?", [newDebt, sale.customer_id]);

            const details = items.map(i => i.quantity + 'x ' + i.product_name).join(', ');
            db.run(`
              INSERT INTO fiado_records (customer_id, type, amount, details, balance_after)
              VALUES (?, 'ANULACION', ?, ?, ?)
            `, [sale.customer_id, sale.total, 'Anulación venta #' + id + ': ' + details, newDebt]);

            finishAnulation();
          });
        } else {
          finishAnulation();
        }

        function finishAnulation() {
          db.run("UPDATE sales SET status = 'anulada' WHERE id = ?", [id], function(err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: err.message });
            }

            db.run("COMMIT");
            res.json({
              success: true,
              message: sale.payment_method === 'Fiado'
                ? 'Venta anulada y stock restaurado. Deuda reducida en S/ ' + sale.total.toFixed(2)
                : 'Venta anulada y stock restaurado.',
              receipt_code: sale.receipt_code
            });
          });
        }
      });
    });
  });
});

app.post('/api/sales', (req, res) => {
  const { doc_type, customer_id, customer_name, payment_method, items, paid_amount, change_amount } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'El carrito no puede estar vacío.' });
  }

  // Calcular total
  let total = 0;
  items.forEach(i => {
    total += i.quantity * i.unit_price;
  });

  const subtotal = total / 1.18;
  const tax = total - subtotal;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // VALIDAR STOCK ANTES DE PROCESAR (Punto 3) - Dentro de la transacción
    const productIds = items.filter(i => i.product_id).map(i => i.product_id);
    if (productIds.length > 0) {
      const placeholders = productIds.map(() => '?').join(',');
      db.all(`SELECT id, name, stock FROM products WHERE id IN (${placeholders})`, productIds, function(err, rows) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        const stockMap = new Map(rows.map(r => [r.id, r]));

        for (const item of items) {
          if (item.product_id) {
            const product = stockMap.get(item.product_id);
            if (!product) {
              db.run("ROLLBACK");
              return res.status(404).json({ error: `Producto no encontrado: ${item.product_name}` });
            }
            if (product.stock < item.quantity) {
              db.run("ROLLBACK");
              return res.status(400).json({ error: `Stock insuficiente para ${product.name}. Disponible: ${product.stock}, Solicitado: ${item.quantity}` });
            }
          }
        }

        // Stock OK, proceder con la venta
        continueSale();
      });
    } else {
      continueSale();
    }

    function continueSale() {
      // Generar correlativo seguro (Punto 2)
      const prefijo = doc_type === 'Factura' ? 'F' : (doc_type === 'Boleta' ? 'B' : 'T');

      db.run(`
        INSERT OR REPLACE INTO counters (doc_type, last_number) 
        VALUES (?, COALESCE((SELECT last_number + 1 FROM counters WHERE doc_type = ?), 1))
      `, [doc_type || 'Ticket', doc_type || 'Ticket'], function(err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        db.get("SELECT last_number FROM counters WHERE doc_type = ?", [doc_type || 'Ticket'], function(err, counterRow) {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }

          const nextNum = counterRow ? counterRow.last_number : 1;
          const receipt_code = `${prefijo}001-${String(nextNum).padStart(6, '0')}`;

          const saleQuery = `
            INSERT INTO sales (receipt_code, doc_type, customer_id, customer_name, payment_method, subtotal, tax, total, paid_amount, change_amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(saleQuery, [
            receipt_code,
            doc_type || 'Ticket',
            customer_id || null,
            customer_name || 'Público General',
            payment_method,
            subtotal,
            tax,
            total,
            paid_amount || total,
            change_amount || 0
          ], function(err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: err.message });
            }

            const saleId = this.lastID;

            const itemStmt = db.prepare(`
              INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal)
              VALUES (?, ?, ?, ?, ?, ?)
            `);

            const stockStmt = db.prepare(`
              UPDATE products SET stock = stock - ? WHERE id = ?
            `);

            items.forEach(item => {
              const itemSubtotal = item.quantity * item.unit_price;
              itemStmt.run([saleId, item.product_id, item.product_name, item.quantity, item.unit_price, itemSubtotal]);
              if (item.product_id) {
                stockStmt.run([item.quantity, item.product_id]);
              }
            });

            itemStmt.finalize();
            stockStmt.finalize();

            // REGISTRAR FIADO SI CORRESPONDE
            if (payment_method === 'Fiado' && customer_id) {
              db.get("SELECT debt FROM customers WHERE id = ?", [customer_id], (err, custRow) => {
                const currentDebt = custRow ? custRow.debt : 0;
                const newDebt = currentDebt + total;
                const details = items.map(i => `${i.quantity}x ${i.product_name}`).join(', ');

                db.run("UPDATE customers SET debt = ? WHERE id = ?", [newDebt, customer_id]);

                db.run(`
                  INSERT INTO fiado_records (customer_id, type, amount, details, balance_after)
                  VALUES (?, 'COMPRA_FIADA', ?, ?, ?)
                `, [customer_id, total, details, newDebt]);

                db.run("COMMIT");
                res.json({ success: true, receipt_code, saleId, total, payment_method });
              });
            } else {
              db.run("COMMIT");
              res.json({ success: true, receipt_code, saleId, total, payment_method });
            }
          });
        });
      });
    }
  });
});

// ==========================================
// 5. MÓDULO FIADOS & ABONOS
// ==========================================
app.get('/api/fiados/:customerId', (req, res) => {
  const { customerId } = req.params;
  db.all('SELECT * FROM fiado_records WHERE customer_id = ? ORDER BY id DESC', [customerId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/fiados/abono', (req, res) => {
  const { customer_id, amount } = req.body;
  const abonoAmt = parseFloat(amount);

  if (!customer_id || isNaN(abonoAmt) || abonoAmt <= 0) {
    return res.status(400).json({ error: 'Monto de abono válido es requerido.' });
  }

  db.get('SELECT debt, name FROM customers WHERE id = ?', [customer_id], (err, customer) => {
    if (err || !customer) return res.status(404).json({ error: 'Cliente no encontrado.' });

    const newDebt = Math.max(0, customer.debt - abonoAmt);

    db.run('UPDATE customers SET debt = ? WHERE id = ?', [newDebt, customer_id], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      db.run(`
        INSERT INTO fiado_records (customer_id, type, amount, details, balance_after)
        VALUES (?, 'ABONO', ?, 'Abono / Pago en efectivo', ?)
      `, [customer_id, abonoAmt, newDebt], function(err) {
        if (err) return res.status(500).json({ error: err.message });

        res.json({
          success: true,
          message: `Abono de S/ ${abonoAmt.toFixed(2)} registrado correctamente`,
          newDebt
        });
      });
    });
  });
});

// ==========================================
// 6. USUARIOS
// ==========================================
app.get('/api/users', (req, res) => {
  db.all('SELECT id, username, name, role, created_at FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Captura de rutas no encontradas -> index.html (SPA Fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor VALEVENTAS activo en http://localhost:${PORT}`);
});
