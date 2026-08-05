// State local del cliente
let PRODUCTS = [];
let CLIENTS = [];
let CART = [];
let activeCategory = 'Todos';
let selectedDocType = 'Ticket';
let selectedPaymentMethod = 'Efectivo';
let currentActiveCustomerForFiado = null;
let currentUserRole = localStorage.getItem('user-role') || 'Admin';
let salesDataCache = []; // Caché de ventas para el selector de roles

// ==========================================
// INICIALIZACIÓN
// ==========================================
async function init() {
  await loadDashboard();
  await loadProducts();
  await loadCustomers();
  await loadSalesHistory();
  await loadUsers();
}

function switchTab(tabId) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
  
  const targetView = document.getElementById('view-' + tabId);
  if (targetView) targetView.classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.className = 'nav-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white font-semibold transition-all';
  });

  const activeBtn = document.getElementById('btn-tab-' + tabId);
  if (activeBtn) {
    activeBtn.className = 'nav-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-600 text-white font-bold transition-all shadow-md';
  }

  // Recargar datos frescos al cambiar de pestaña
  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'inventory') renderInventoryTable();
  if (tabId === 'crm') renderCRMTable();
  if (tabId === 'fiados') renderFiadosTable();
  if (tabId === 'reports') loadSalesHistory();
  if (tabId === 'users') loadUsers();
}

// ==========================================
// API FETCHERS
// ==========================================
async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    const data = await res.json();

    document.getElementById('dash-sales').innerText = `S/ ${(data.todaySales || 0).toFixed(2)}`;
    document.getElementById('dash-tickets').innerText = `${data.todayTickets || 0} Tickets`;
    document.getElementById('dash-total-fiado').innerText = `S/ ${(data.totalFiadosDebt || 0).toFixed(2)}`;
    document.getElementById('dash-top-product').innerText = data.topProduct || 'N/A';
  } catch (err) {
    console.error('Error cargando dashboard:', err);
  }
}

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    PRODUCTS = await res.json();
    renderCategoryFilters();
    renderProducts();
    renderInventoryTable();
  } catch (err) {
    console.error('Error cargando productos:', err);
  }
}

async function loadCustomers() {
  try {
    const res = await fetch('/api/customers');
    CLIENTS = await res.json();
    populateCustomerDropdown();
    renderCRMTable();
    renderFiadosTable();
  } catch (err) {
    console.error('Error cargando clientes:', err);
  }
}

async function loadSalesHistory() {
  try {
    const res = await fetch('/api/sales');
    const sales = await res.json();
    salesDataCache = sales;
    renderSalesHistoryTable(sales);
  } catch (err) {
    console.error('Error cargando historial de ventas:', err);
  }
}

async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const users = await res.json();
    renderUsersTable(users);
  } catch (err) {
    console.error('Error cargando usuarios:', err);
  }
}

// ==========================================
// 1. PUNTO DE VENTA (POS)
// ==========================================
function renderCategoryFilters() {
  const categories = ['Todos', ...new Set(PRODUCTS.map(p => p.category))];
  const container = document.getElementById('category-filters');
  
  container.innerHTML = categories.map(cat => `
    <button onclick="setCategory('${cat}')" class="px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
      activeCategory === cat ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }">
      ${cat}
    </button>
  `).join('');
}

function setCategory(cat) {
  activeCategory = cat;
  renderCategoryFilters();
  renderProducts();
}

function renderProducts() {
  const query = document.getElementById('search-input').value.toLowerCase().trim();
  const grid = document.getElementById('product-grid');

  const filtered = PRODUCTS.filter(p => {
    const matchCat = activeCategory === 'Todos' || p.category === activeCategory;
    const matchSearch = p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query);
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-center py-12 text-slate-400 font-bold">No se encontraron productos en inventario</div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => `
    <div onclick="addToCart(${p.id})" class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group">
      <div>
        <div class="flex justify-between items-start mb-2">
          <span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-md truncate max-w-[100px]">${p.category}</span>
          <span class="text-[10px] font-mono text-slate-400">#${p.code}</span>
        </div>
        <h3 class="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors line-clamp-2">${p.name}</h3>
      </div>
      <div class="mt-4 flex justify-between items-end pt-2 border-t border-slate-100">
        <div>
          <p class="text-[10px] text-slate-400 font-bold uppercase">Stock: ${p.stock}</p>
          <p class="text-base font-black text-blue-600">S/ ${p.price.toFixed(2)}</p>
        </div>
        <button class="w-8 h-8 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold group-hover:bg-blue-600 group-hover:text-white transition-all">
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function addToCart(productId) {
  const prod = PRODUCTS.find(p => p.id === productId);
  if (!prod) return;

  if (prod.stock <= 0) {
    alert(`⚠️ El producto "${prod.name}" no tiene stock disponible.`);
    return;
  }

  const existing = CART.find(item => item.product.id === productId);
  if (existing) {
    if (existing.quantity >= prod.stock) {
      alert(`⚠️ No puede agregar más de ${prod.stock} unidades de "${prod.name}".`);
      return;
    }
    existing.quantity += 1;
  } else {
    CART.push({ product: prod, quantity: 1 });
  }

  renderCart();
}

function updateCartQty(productId, delta) {
  const item = CART.find(i => i.product.id === productId);
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) {
    CART = CART.filter(i => i.product.id !== productId);
  }
  renderCart();
}

function clearCart() {
  CART = [];
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-items');

  if (CART.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-400 space-y-2">
        <i class="fa-solid fa-cart-shopping text-3xl opacity-30"></i>
        <p class="text-xs font-bold">El carrito está vacío</p>
      </div>
    `;
    document.getElementById('summary-subtotal').innerText = 'S/ 0.00';
    document.getElementById('summary-tax').innerText = 'S/ 0.00';
    document.getElementById('summary-total').innerText = 'S/ 0.00';
    document.getElementById('btn-pay').disabled = true;
    return;
  }

  let total = 0;
  container.innerHTML = CART.map(i => {
    const itemSubtotal = i.product.price * i.quantity;
    total += itemSubtotal;
    return `
      <div class="py-3 flex justify-between items-center gap-2">
        <div class="flex-1 min-w-0">
          <p class="font-bold text-xs text-slate-800 truncate">${i.product.name}</p>
          <p class="text-[10px] text-slate-400">S/ ${i.product.price.toFixed(2)} c/u</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="updateCartQty(${i.product.id}, -1)" class="w-6 h-6 bg-slate-100 text-slate-600 rounded-md font-bold text-xs hover:bg-slate-200">-</button>
          <span class="font-bold text-xs text-slate-800 w-4 text-center">${i.quantity}</span>
          <button onclick="updateCartQty(${i.product.id}, 1)" class="w-6 h-6 bg-slate-100 text-slate-600 rounded-md font-bold text-xs hover:bg-slate-200">+</button>
        </div>
        <span class="font-black text-xs text-slate-900 w-16 text-right">S/ ${itemSubtotal.toFixed(2)}</span>
      </div>
    `;
  }).join('');

  const subtotal = total / 1.18;
  const tax = total - subtotal;

  document.getElementById('summary-subtotal').innerText = `S/ ${subtotal.toFixed(2)}`;
  document.getElementById('summary-tax').innerText = `S/ ${tax.toFixed(2)}`;
  document.getElementById('summary-total').innerText = `S/ ${total.toFixed(2)}`;
  document.getElementById('btn-pay').disabled = false;
}

// ==========================================
// MODAL COBRAR / COBRO
// ==========================================
function populateCustomerDropdown() {
  const select = document.getElementById('modal-select-customer');
  select.innerHTML = '<option value="">Público General</option>' + 
    CLIENTS.map(c => `<option value="${c.id}">${c.name} (${c.doc}) ${c.debt > 0 ? '- Deuda: S/ ' + c.debt.toFixed(2) : ''}</option>`).join('');
}

function openPaymentModal() {
  let total = CART.reduce((sum, i) => sum + (i.product.price * i.quantity), 0);
  document.getElementById('modal-pay-total').innerText = `S/ ${total.toFixed(2)}`;
  document.getElementById('input-paid-amount').value = total.toFixed(2);
  calculateChange();
  document.getElementById('modal-payment').classList.remove('hidden');
}

function closePaymentModal() {
  document.getElementById('modal-payment').classList.add('hidden');
}

function selectDocType(type) {
  selectedDocType = type;
  document.querySelectorAll('.doc-btn').forEach(b => {
    b.className = 'doc-btn bg-white border border-slate-300 text-slate-600 font-bold py-2 rounded-lg text-xs hover:bg-slate-100';
  });
  document.getElementById('doc-' + type).className = 'doc-btn active bg-blue-600 text-white font-bold py-2 rounded-lg text-xs shadow-md';
}

function selectPaymentMethod(method) {
  selectedPaymentMethod = method;
  document.querySelectorAll('.pay-method-btn').forEach(b => {
    b.className = 'pay-method-btn bg-slate-50 border border-slate-200 text-slate-600 font-bold p-2.5 rounded-xl text-xs flex flex-col items-center gap-1 hover:bg-slate-100';
  });

  const btnMap = {
    'Efectivo': 'pay-cash',
    'Tarjeta': 'pay-card',
    'Yape/Plin': 'pay-transfer',
    'Fiado': 'pay-fiado'
  };

  const selectedBtn = document.getElementById(btnMap[method]);
  if (selectedBtn) {
    selectedBtn.className = 'pay-method-btn active bg-blue-50 border-2 border-blue-500 text-blue-900 font-bold p-2.5 rounded-xl text-xs flex flex-col items-center gap-1 shadow-sm';
  }
}

function calculateChange() {
  let total = CART.reduce((sum, i) => sum + (i.product.price * i.quantity), 0);
  const paid = parseFloat(document.getElementById('input-paid-amount').value) || 0;
  const change = paid - total;
  document.getElementById('modal-pay-change').innerText = `S/ ${(change > 0 ? change : 0).toFixed(2)}`;
}

async function processFinalSale() {
  const customerId = document.getElementById('modal-select-customer').value;
  const customerObj = CLIENTS.find(c => String(c.id) === String(customerId));
  const customerName = customerObj ? customerObj.name : 'Público General';

  if (selectedPaymentMethod === 'Fiado' && !customerId) {
    alert('⚠️ Para vender al FIADO debe seleccionar un cliente registrado.');
    return;
  }

  let total = CART.reduce((sum, i) => sum + (i.product.price * i.quantity), 0);
  const paidAmount = parseFloat(document.getElementById('input-paid-amount').value) || total;
  const changeAmount = paidAmount > total ? paidAmount - total : 0;

  const payload = {
    doc_type: selectedDocType,
    customer_id: customerId ? parseInt(customerId) : null,
    customer_name: customerName,
    payment_method: selectedPaymentMethod,
    paid_amount: paidAmount,
    change_amount: changeAmount,
    items: CART.map(i => ({
      product_id: i.product.id,
      product_name: i.product.name,
      quantity: i.quantity,
      unit_price: i.product.price
    }))
  };

  try {
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar venta');

    // Renderizar Recibo de Impresión
    document.getElementById('rec-title').innerText = selectedDocType === 'Ticket' ? 'TICKET DE VENTA' : selectedDocType.toUpperCase() + ' ELECTRÓNICA';
    document.getElementById('rec-id').innerText = data.receipt_code;
    document.getElementById('rec-customer').innerText = 'Cliente: ' + customerName;
    document.getElementById('rec-date').innerText = new Date().toLocaleString();
    document.getElementById('rec-total').innerText = `S/ ${total.toFixed(2)}`;
    document.getElementById('rec-method').innerText = selectedPaymentMethod;
    document.getElementById('rec-paid').innerText = selectedPaymentMethod === 'Fiado' ? 'S/ 0.00 (FIADO)' : `S/ ${paidAmount.toFixed(2)}`;
    document.getElementById('rec-change').innerText = `S/ ${changeAmount.toFixed(2)}`;

    document.getElementById('rec-items').innerHTML = CART.map(i => `
      <div class="flex justify-between items-start">
        <span class="pr-2">${i.quantity}x ${i.product.name}</span>
        <span class="whitespace-nowrap">S/ ${(i.product.price * i.quantity).toFixed(2)}</span>
      </div>
    `).join('');

    closePaymentModal();
    document.getElementById('modal-receipt').classList.remove('hidden');

    // Recargar datos globales del servidor
    clearCart();
    await loadProducts();
    await loadCustomers();
    await loadDashboard();

  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
}

function closeReceiptModal() {
  document.getElementById('modal-receipt').classList.add('hidden');
}

// ==========================================
// 2. INVENTARIO (CRUD PRODUCTOS)
// ==========================================
function renderInventoryTable() {
  const query = (document.getElementById('inventory-search')?.value || '').toLowerCase().trim();
  const tbody = document.getElementById('inventory-table-body');
  
  const filtered = PRODUCTS.filter(p => p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query));

  tbody.innerHTML = filtered.map(p => `
    <tr class="hover:bg-slate-50">
      <td class="p-4 font-mono text-xs text-slate-500">${p.code}</td>
      <td class="p-4 font-bold text-slate-800">${p.name}</td>
      <td class="p-4"><span class="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs">${p.category}</span></td>
      <td class="p-4 text-slate-500">S/ ${(p.purchase_price || 0).toFixed(2)}</td>
      <td class="p-4 font-bold text-slate-900">S/ ${p.price.toFixed(2)}</td>
      <td class="p-4"><span class="${p.stock < 10 ? 'text-rose-600 bg-rose-100' : 'text-emerald-600 bg-emerald-100'} px-2 py-1 rounded font-bold text-xs">${p.stock} und.</span></td>
      <td class="p-4 text-center space-x-2">
        <button onclick="deleteProduct(${p.id})" class="text-rose-400 hover:text-rose-600 font-bold text-xs"><i class="fa-solid fa-trash mr-1"></i>Eliminar</button>
      </td>
    </tr>
  `).join('');
}

function openProductModal() {
  document.getElementById('form-product').reset();
  document.getElementById('modal-product').classList.remove('hidden');
}

function closeProductModal() {
  document.getElementById('modal-product').classList.add('hidden');
}

async function saveProduct(e) {
  e.preventDefault();
  const payload = {
    code: document.getElementById('prod-code').value.trim(),
    name: document.getElementById('prod-name').value.trim(),
    category: document.getElementById('prod-category').value,
    purchase_price: parseFloat(document.getElementById('prod-purchase').value) || 0,
    price: parseFloat(document.getElementById('prod-price').value),
    stock: parseInt(document.getElementById('prod-stock').value) || 0
  };

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Error al registrar producto');

    closeProductModal();
    await loadProducts();
    alert('✅ Producto guardado correctamente en inventario.');
  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
}

async function deleteProduct(id) {
  if (!confirm('¿Está seguro de eliminar este producto del inventario?')) return;
  try {
    await fetch(`/api/products/${id}`, { method: 'DELETE' });
    await loadProducts();
  } catch (err) {
    alert('❌ Error eliminando producto');
  }
}

// ==========================================
// 3. CRM & FIADOS
// ==========================================
function renderCRMTable() {
  const tbody = document.getElementById('crm-table-body');
  tbody.innerHTML = CLIENTS.map(c => `
    <tr class="hover:bg-slate-50">
      <td class="p-4 font-mono text-xs text-slate-600">${c.doc}</td>
      <td class="p-4 font-bold text-slate-800">${c.name}</td>
      <td class="p-4">${c.phone || '-'}</td>
      <td class="p-4 text-xs text-slate-500">${c.address || '-'}</td>
      <td class="p-4">
        <span class="${c.debt > 0 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-emerald-100 text-emerald-700'} px-2.5 py-1 rounded text-xs font-bold">
          ${c.debt > 0 ? 'Deuda: S/ ' + c.debt.toFixed(2) : 'Sin Deuda'}
        </span>
      </td>
      <td class="p-4 text-center">
        <button onclick="switchTab('fiados'); openFiadoModal(${c.id})" class="text-amber-600 hover:text-amber-800 font-bold text-xs"><i class="fa-solid fa-hand-holding-dollar mr-1"></i>Ver Estado Deuda</button>
      </td>
    </tr>
  `).join('');
}

function renderFiadosTable() {
  const query = (document.getElementById('fiado-search-input')?.value || '').toLowerCase().trim();
  const tbody = document.getElementById('fiados-table-body');

  const filtered = CLIENTS.filter(c => c.name.toLowerCase().includes(query) || c.doc.toLowerCase().includes(query));

  tbody.innerHTML = filtered.map(c => `
    <tr class="hover:bg-slate-50">
      <td class="p-4 font-mono text-xs text-slate-500">${c.doc}</td>
      <td class="p-4 font-bold text-slate-800">${c.name}</td>
      <td class="p-4 text-slate-500">${c.phone || '-'}</td>
      <td class="p-4 text-right font-black ${c.debt > 0 ? 'text-amber-600' : 'text-slate-400'}">S/ ${c.debt.toFixed(2)}</td>
      <td class="p-4 text-center">
        <button onclick="openFiadoModal(${c.id})" class="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">
          <i class="fa-solid fa-file-invoice-dollar mr-1"></i>Ver / Registrar Abono
        </button>
      </td>
    </tr>
  `).join('');
}

function openCustomerModal() {
  document.getElementById('form-customer').reset();
  document.getElementById('modal-customer').classList.remove('hidden');
}

function closeCustomerModal() {
  document.getElementById('modal-customer').classList.add('hidden');
}

async function saveCustomer(e) {
  e.preventDefault();
  const payload = {
    doc: document.getElementById('cust-doc').value.trim(),
    name: document.getElementById('cust-name').value.trim(),
    phone: document.getElementById('cust-phone').value.trim()
  };

  try {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Error al registrar cliente');

    closeCustomerModal();
    await loadCustomers();
    alert('✅ Cliente registrado con éxito.');
  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
}

async function openFiadoModal(customerId) {
  currentActiveCustomerForFiado = CLIENTS.find(c => c.id === customerId);
  if (!currentActiveCustomerForFiado) return;

  document.getElementById('fiado-modal-client-info').innerText = `Cliente: ${currentActiveCustomerForFiado.name} (DNI/RUC: ${currentActiveCustomerForFiado.doc})`;
  document.getElementById('fiado-modal-balance').innerText = `S/ ${currentActiveCustomerForFiado.debt.toFixed(2)}`;
  document.getElementById('input-abono-amount').value = '';

  try {
    const res = await fetch(`/api/fiados/${customerId}`);
    const records = await res.json();

    const historyTbody = document.getElementById('fiado-modal-history');
    if (records.length === 0) {
      historyTbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">Sin historial de fiados ni abonos.</td></tr>`;
    } else {
      historyTbody.innerHTML = records.map(r => `
        <tr class="hover:bg-slate-50">
          <td class="p-3 text-slate-400 text-[11px]">${new Date(r.created_at).toLocaleString()}</td>
          <td class="p-3"><span class="${r.type === 'ABONO' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} px-2 py-0.5 rounded font-bold text-[10px]">${r.type}</span></td>
          <td class="p-3 text-slate-700">${r.details || '-'}</td>
          <td class="p-3 text-right font-bold ${r.type === 'ABONO' ? 'text-emerald-600' : 'text-slate-800'}">S/ ${r.amount.toFixed(2)}</td>
          <td class="p-3 text-right font-black text-slate-900">S/ ${r.balance_after.toFixed(2)}</td>
        </tr>
      `).join('');
    }

    document.getElementById('modal-fiado-detail').classList.remove('hidden');
  } catch (err) {
    alert('❌ Error cargando historial de fiados');
  }
}

function closeFiadoModal() {
  document.getElementById('modal-fiado-detail').classList.add('hidden');
}

async function processAbono() {
  if (!currentActiveCustomerForFiado) return;
  const amount = parseFloat(document.getElementById('input-abono-amount').value);
  if (!amount || amount <= 0) {
    alert('⚠️ Ingrese un monto de abono válido.');
    return;
  }

  try {
    const res = await fetch('/api/fiados/abono', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: currentActiveCustomerForFiado.id, amount })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error registrando abono');

    alert(`✅ ${data.message}`);
    await loadCustomers();
    await loadDashboard();
    openFiadoModal(currentActiveCustomerForFiado.id);
  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
}

// ==========================================
// 4. REPORTES & HISTORIAL DE VENTAS
// ==========================================
function renderSalesHistoryTable(sales) {
  const tbody = document.getElementById('history-table-body');
  if (sales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No hay ventas registradas aún.</td></tr>`;
    return;
  }

  const colSpan = currentUserRole === 'Admin' ? 7 : 6;

  tbody.innerHTML = sales.map(s => `
    <tr class="hover:bg-slate-50 ${s.status === 'anulada' ? 'bg-slate-100/50 opacity-70' : ''}">
      <td class="p-4 font-bold text-slate-800">${s.receipt_code}</td>
      <td class="p-4 text-slate-500 text-xs">${new Date(s.created_at).toLocaleString()}</td>
      <td class="p-4 text-slate-800 text-xs">${s.customer_name}</td>
      <td class="p-4"><span class="bg-slate-100 text-slate-600 px-2 py-1 rounded text-[10px] font-bold uppercase">${s.doc_type}</span></td>
      <td class="p-4"><span class="${s.payment_method === 'Fiado' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'} px-2 py-1 rounded text-[10px] font-bold uppercase">${s.payment_method}</span></td>
      <td class="p-4 text-right font-black text-slate-900">S/ ${s.total.toFixed(2)}</td>
      ${currentUserRole === 'Admin' ? `
        <td class="p-4 text-center">
          ${s.status === 'anulada' 
            ? '<span class="bg-rose-100 text-rose-700 px-2 py-1 rounded text-[10px] font-bold">Anulada</span>'
            : `<button onclick="anularVenta(${s.id})" class="bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-800 font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors">
                 <i class="fa-solid fa-trash mr-1"></i>Anular
               </button>`
          }
        </td>
      ` : ''}
    </tr>
  `).join('');
}

async function anularVenta(saleId) {
  if (!confirm('¿Está seguro de anular esta venta?\n\nSe devolverá el stock y, si era a FIADO, se reducirá la deuda del cliente.')) return;

  try {
    const res = await fetch(`/api/sales/${saleId}/anular`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error anulando venta');

    alert('✅ ' + data.message);
    await loadSalesHistory();
    await loadDashboard();
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

// ==========================================
// 5. CONTROL DE ACCESO (Rol)
// ==========================================
function switchRole(role) {
  currentUserRole = role;
  localStorage.setItem('user-role', role);

  document.querySelectorAll('.role-btn').forEach(b => {
    b.classList.remove('bg-blue-600', 'text-white');
    b.classList.add('bg-slate-700', 'text-slate-300');
  });

  const btn = document.getElementById('role-' + role);
  if (btn) {
    btn.classList.remove('bg-slate-700', 'text-slate-300');
    btn.classList.add('bg-blue-600', 'text-white');
  }

  if (role === 'Admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  } else {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
  }

  renderSalesHistoryTable(salesDataCache || []);
}

// ==========================================
// 5. USUARIOS
// ==========================================
function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = users.map(u => `
    <tr class="hover:bg-slate-50">
      <td class="p-4 font-bold text-slate-800">${u.username}</td>
      <td class="p-4 text-slate-700">${u.name}</td>
      <td class="p-4"><span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-bold">${u.role}</span></td>
      <td class="p-4 text-center"><span class="text-emerald-600 bg-emerald-100 px-2 py-1 rounded text-xs font-bold">Activo</span></td>
    </tr>
  `).join('');
}

window.onload = init;
