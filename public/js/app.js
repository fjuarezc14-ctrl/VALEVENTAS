// ==========================================
// Cliente Frontend VALEVENTAS POS
// VT VALETEC Standard Application Logic + WebSockets Real-Time Sync & RBAC Audit
// ==========================================

// Estado local de la aplicación
let PRODUCTS = [];
let CLIENTS = [];
let CART = [];
let activeCategory = 'Todos';
let selectedDocType = 'Ticket';
let selectedPaymentMethod = 'Efectivo';
let currentActiveCustomerForFiado = null;
let currentUser = null;
let currentCashRegister = null;
let inventoryFilterStock = 'all';
let currentReportSales = [];
let currentPasswordUserId = null;
let socket = null;

// Helper de Headers con Token JWT
function getAuthHeaders() {
  const token = localStorage.getItem('valetec-token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
}

// ==========================================
// INICIALIZACIÓN Y CONFIGURACIÓN GENERAL
// ==========================================
async function init() {
  setupKeyboardShortcuts();
  initWebSockets();

  const token = localStorage.getItem('valetec-token');
  if (token) {
    try {
      const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        updateUserUI();
      } else {
        logout();
        return;
      }
    } catch (err) {
      console.error('Error autenticando token:', err);
      logout();
      return;
    }
  } else {
    openLoginModal();
  }

  await loadDashboard();
  await loadProducts();
  await loadCustomers();
  await loadSalesHistory();
  await loadUsers();
  await loadCurrentCashRegister();
  
  focusSearchInput();
}

function initWebSockets() {
  if (typeof io !== 'undefined') {
    socket = io();

    socket.on('connect', () => {
      console.log('⚡ Conectado a Servidor WebSocket POS Multicaja');
    });

    socket.on('products_changed', async () => {
      console.log('⚡ Sincronización en tiempo real: Productos / Stock actualizados.');
      await loadProducts();
      await loadDashboard();
    });

    socket.on('cash_register_changed', async () => {
      console.log('⚡ Sincronización en tiempo real: Estado de caja actualizado.');
      await loadCurrentCashRegister();
    });

    socket.on('sales_changed', async () => {
      console.log('⚡ Sincronización en tiempo real: Ventas / Historial actualizado.');
      await loadSalesHistory();
      await loadDashboard();
    });

    socket.on('customers_changed', async () => {
      console.log('⚡ Sincronización en tiempo real: Clientes / Deudas actualizadas.');
      await loadCustomers();
      await loadDashboard();
    });
  }
}

function updateUserUI() {
  if (currentUser) {
    document.getElementById('user-display-name').innerText = currentUser.name;
    document.getElementById('user-display-role').innerText = `Rol: ${currentUser.role}`;
    document.getElementById('user-avatar').innerText = currentUser.name.substring(0, 2).toUpperCase();

    const isAdmin = currentUser.role === 'Admin';

    // Aplicar ocultamiento estricto a todos los elementos con clase admin-only
    document.querySelectorAll('.admin-only').forEach(el => {
      if (isAdmin) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    // Re-renderizar tablas para asegurar que las filas dinámicas respeten el rol
    renderInventoryTable();
    renderSalesHistoryTable(currentReportSales);

    const loginModal = document.getElementById('modal-login');
    loginModal.classList.add('opacity-0');
    setTimeout(() => {
      loginModal.classList.add('hidden');
      loginModal.classList.remove('opacity-0');
    }, 200);

  } else {
    openLoginModal();
  }
}

function openLoginModal() {
  const loginModal = document.getElementById('modal-login');
  loginModal.classList.remove('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

    localStorage.setItem('valetec-token', data.token);
    currentUser = data.user;
    updateUserUI();
    playBeep('success');

    await loadProducts();
    await loadSalesHistory();
    await loadCurrentCashRegister();
    await loadUsers();
    focusSearchInput();

  } catch (err) {
    playBeep('error');
    alert('❌ ' + err.message);
  }
}

function logout() {
  localStorage.removeItem('valetec-token');
  currentUser = null;
  openLoginModal();
}

function focusSearchInput() {
  setTimeout(() => {
    const searchInput = document.getElementById('search-input');
    const isModalOpen = document.querySelector('.modal:not(.hidden), div[id^="modal-"]:not(.hidden)');
    if (searchInput && !isModalOpen) {
      searchInput.focus();
    }
  }, 100);
}

function switchTab(tabId) {
  // Validación de seguridad para navegación por tabs
  if (tabId === 'users' && (!currentUser || currentUser.role !== 'Admin')) {
    alert('⚠️ Acceso denegado. Solo los usuarios con rol Administrador pueden ingresar al Control de Acceso.');
    switchTab('pos');
    return;
  }

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

  if (tabId === 'pos') focusSearchInput();
  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'inventory') renderInventoryTable();
  if (tabId === 'crm') renderCRMTable();
  if (tabId === 'fiados') renderFiadosTable();
  if (tabId === 'reports') loadSalesHistory();
  if (tabId === 'users') loadUsers();
}

// ==========================================
// SINTETIZADOR DE AUDIO (BEEP WEB AUDIO API)
// ==========================================
function playBeep(type = 'success') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch (e) {}
}

// ==========================================
// ATAJOS DE TECLADO GLOBALES
// ==========================================
function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      switchTab('pos');
      focusSearchInput();
      return;
    }
    if (e.key === 'F4') {
      e.preventDefault();
      if (CART.length > 0) {
        openPaymentModal();
      } else {
        playBeep('error');
        alert('⚠️ El carrito está vacío.');
      }
      return;
    }
    if (e.key === 'F9') {
      e.preventDefault();
      clearCart();
      return;
    }
    if (e.key === 'Escape') {
      closePaymentModal();
      closeProductModal();
      closeCustomerModal();
      closeFiadoModal();
      closeReceiptModal();
      closeOpenRegisterModal();
      closeCloseRegisterModal();
      closeUserModal();
      closePasswordModal();
      closeEditSaleModal();
      focusSearchInput();
      return;
    }
  });

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('keydown', handleSearchKeyDown);
  }
}

// ==========================================
// MÓDULO DE CAJA DIARIA (ARQUEO Z)
// ==========================================
async function loadCurrentCashRegister() {
  try {
    const res = await fetch('/api/cash-register/current', { headers: getAuthHeaders() });
    currentCashRegister = await res.json();

    const banner = document.getElementById('cash-register-banner');
    if (currentCashRegister) {
      const initial = parseFloat(currentCashRegister.opening_amount) || 0;
      const cashSales = parseFloat(currentCashRegister.cash_sales) || 0;
      const abonos = parseFloat(currentCashRegister.fiado_abonos) || 0;
      const retiros = parseFloat(currentCashRegister.total_withdrawals) || 0;
      const totalExpected = currentCashRegister.expected_cash !== undefined ? currentCashRegister.expected_cash : (initial + cashSales + abonos - retiros);
      const isAdmin = currentUser && currentUser.role === 'Admin';

      banner.innerHTML = `
        <div class="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl flex items-center justify-between text-xs font-bold text-emerald-900 flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Caja Abierta por ${currentCashRegister.user_name} (Fondo: S/ ${initial.toFixed(2)})</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-slate-600">Efectivo en Caja: <strong class="text-emerald-700 text-sm">S/ ${totalExpected.toFixed(2)}</strong></span>
            ${isAdmin ? `
              <button onclick="openWithdrawalModal()" class="bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold shadow-sm flex items-center gap-1">
                <i class="fa-solid fa-money-bill-transfer"></i> Retiro de Efectivo
              </button>
            ` : ''}
            <button onclick="openCloseCashRegisterModal()" class="bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold shadow-sm">
              <i class="fa-solid fa-lock mr-1"></i>Cierre Z de Caja
            </button>
          </div>
        </div>
      `;
    } else {
      banner.innerHTML = `
        <div class="bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl flex items-center justify-between text-xs font-bold text-amber-900">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation text-amber-600 text-sm"></i>
            <span>No hay caja abierta para el turno actual.</span>
          </div>
          <button onclick="openOpenRegisterModal()" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg text-xs font-bold shadow-sm">
            <i class="fa-solid fa-key mr-1"></i>Abrir Caja
          </button>
        </div>
      `;
    }
  } catch (err) {
    console.error('Error cargando caja actual:', err);
  }
}

function openOpenRegisterModal() {
  document.getElementById('input-opening-amount').value = '100.00';
  document.getElementById('modal-open-register').classList.remove('hidden');
}

function closeOpenRegisterModal() {
  document.getElementById('modal-open-register').classList.add('hidden');
}

async function processOpenCashRegister(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('input-opening-amount').value) || 0;

  try {
    const res = await fetch('/api/cash-register/open', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ opening_amount: amount })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error abriendo caja');

    closeOpenRegisterModal();
    playBeep('success');
    await loadCurrentCashRegister();
  } catch (err) {
    playBeep('error');
    alert('❌ ' + err.message);
  }
}

function openWithdrawalModal() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede realizar retiros de efectivo.');
    return;
  }
  if (!currentCashRegister) {
    alert('⚠️ Debe haber una caja abierta para registrar un retiro.');
    return;
  }
  document.getElementById('form-withdrawal').reset();
  document.getElementById('modal-withdrawal').classList.remove('hidden');
}

function closeWithdrawalModal() {
  document.getElementById('modal-withdrawal').classList.add('hidden');
}

async function saveWithdrawal(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede realizar retiros de efectivo.');
    return;
  }

  const amount = parseFloat(document.getElementById('withdrawal-amount').value);
  const reason = document.getElementById('withdrawal-reason').value.trim();

  try {
    const res = await fetch('/api/cash-register/movement', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ amount, reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar el retiro');

    closeWithdrawalModal();
    playBeep('success');
    alert('✅ ' + data.message);
    await loadCurrentCashRegister();
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

async function openCloseCashRegisterModal() {
  if (!currentCashRegister) return;

  const initial = parseFloat(currentCashRegister.opening_amount) || 0;
  const cashSales = parseFloat(currentCashRegister.cash_sales) || 0;
  const abonos = parseFloat(currentCashRegister.fiado_abonos) || 0;
  const retiros = parseFloat(currentCashRegister.total_withdrawals) || 0;
  const expectedCash = currentCashRegister.expected_cash !== undefined ? currentCashRegister.expected_cash : (initial + cashSales + abonos - retiros);

  document.getElementById('close-opening-amount').innerText = `S/ ${initial.toFixed(2)}`;
  document.getElementById('close-cash-sales').innerText = `S/ ${cashSales.toFixed(2)}`;
  if (document.getElementById('close-fiado-abonos')) document.getElementById('close-fiado-abonos').innerText = `S/ ${abonos.toFixed(2)}`;
  if (document.getElementById('close-withdrawals')) document.getElementById('close-withdrawals').innerText = `S/ ${retiros.toFixed(2)}`;
  document.getElementById('close-card-sales').innerText = `S/ ${(parseFloat(currentCashRegister.card_sales) || 0).toFixed(2)}`;
  document.getElementById('close-transfer-sales').innerText = `S/ ${(parseFloat(currentCashRegister.transfer_sales) || 0).toFixed(2)}`;
  document.getElementById('close-fiado-sales').innerText = `S/ ${(parseFloat(currentCashRegister.fiado_sales) || 0).toFixed(2)}`;
  document.getElementById('close-expected-cash').innerText = `S/ ${expectedCash.toFixed(2)}`;
  document.getElementById('input-actual-cash').value = expectedCash.toFixed(2);
  calculateCashDifference();

  // Renderizar abonos del turno activo para el cajero
  const abonosList = currentCashRegister.shift_abonos || [];
  const abonosTotal = abonosList.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
  if (document.getElementById('close-shift-abonos-total')) {
    document.getElementById('close-shift-abonos-total').innerText = `S/ ${abonosTotal.toFixed(2)}`;
  }
  const listEl = document.getElementById('close-shift-abonos-list');
  if (listEl) {
    if (abonosList.length === 0) {
      listEl.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-slate-400 text-xs">Sin abonos cobrados en este turno.</td></tr>`;
    } else {
      listEl.innerHTML = abonosList.map(a => `
        <tr class="hover:bg-slate-50">
          <td class="p-2 text-slate-400 text-[10px]">${new Date(a.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
          <td class="p-2 font-bold text-slate-800">${a.customer_name}</td>
          <td class="p-2 text-slate-600">${a.user_name}</td>
          <td class="p-2 text-right font-black text-emerald-600">S/ ${a.amount.toFixed(2)}</td>
        </tr>
      `).join('');
    }
  }

  document.getElementById('modal-close-register').classList.remove('hidden');
}

function closeCloseRegisterModal() {
  document.getElementById('modal-close-register').classList.add('hidden');
}

function calculateCashDifference() {
  if (!currentCashRegister) return;
  const initial = parseFloat(currentCashRegister.opening_amount) || 0;
  const cashSales = parseFloat(currentCashRegister.cash_sales) || 0;
  const abonos = parseFloat(currentCashRegister.fiado_abonos) || 0;
  const retiros = parseFloat(currentCashRegister.total_withdrawals) || 0;
  const expectedCash = currentCashRegister.expected_cash !== undefined ? currentCashRegister.expected_cash : (initial + cashSales + abonos - retiros);
  const actualCash = parseFloat(document.getElementById('input-actual-cash').value) || 0;
  const diff = actualCash - expectedCash;

  const diffEl = document.getElementById('close-difference');
  if (diff === 0) {
    diffEl.className = 'font-black text-emerald-600 text-sm';
    diffEl.innerText = 'S/ 0.00 (Cuadre Exacto)';
  } else if (diff > 0) {
    diffEl.className = 'font-black text-blue-600 text-sm';
    diffEl.innerText = `+ S/ ${diff.toFixed(2)} (Sobrante)`;
  } else {
    diffEl.className = 'font-black text-rose-600 text-sm';
    diffEl.innerText = `- S/ ${Math.abs(diff).toFixed(2)} (Faltante)`;
  }
}

async function processCloseCashRegister(e) {
  e.preventDefault();
  const actual_cash = parseFloat(document.getElementById('input-actual-cash').value) || 0;
  const notes = document.getElementById('input-close-notes').value.trim();

  try {
    const res = await fetch('/api/cash-register/close', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ actual_cash, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error cerrando caja');

    closeCloseRegisterModal();
    playBeep('success');
    alert('✅ Cierre de Caja Z realizado con éxito.');
    await loadCurrentCashRegister();
  } catch (err) {
    playBeep('error');
    alert('❌ ' + err.message);
  }
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

    const lowStockAlert = document.getElementById('dash-low-stock-alert');
    if (data.lowStockCount > 0) {
      lowStockAlert.classList.remove('hidden');
      document.getElementById('dash-low-stock-count').innerText = `${data.lowStockCount} Productos con Stock Crítico`;
    } else {
      lowStockAlert.classList.add('hidden');
    }

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
  const startDate = document.getElementById('rep-start-date')?.value || '';
  const endDate = document.getElementById('rep-end-date')?.value || '';
  const paymentMethod = document.getElementById('rep-payment-method')?.value || 'Todos';
  const docType = document.getElementById('rep-doc-type')?.value || 'Todos';
  const searchQuery = document.getElementById('rep-search-input')?.value || '';

  let url = `/api/sales?paymentMethod=${encodeURIComponent(paymentMethod)}&docType=${encodeURIComponent(docType)}`;
  if (startDate) url += `&startDate=${startDate}`;
  if (endDate) url += `&endDate=${endDate}`;
  if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    
    currentReportSales = data.sales || [];
    currentReportAbonos = data.abonos || [];

    document.getElementById('rep-total-sales').innerText = `S/ ${(data.summary.totalSales || 0).toFixed(2)}`;
    document.getElementById('rep-net-profit').innerText = `S/ ${(data.summary.totalProfit || 0).toFixed(2)}`;
    document.getElementById('rep-tickets-count').innerText = `${data.summary.ticketsCount || 0} Tickets`;
    document.getElementById('rep-avg-ticket').innerText = `S/ ${(data.summary.averageTicket || 0).toFixed(2)}`;

    // Desglose de Métodos de Pago
    const bd = data.summary.breakdown || { cash: 0, card: 0, transfer: 0, fiado: 0, fiadoAbonos: 0 };
    document.getElementById('rep-breakdown-cash').innerText = `S/ ${bd.cash.toFixed(2)}`;
    document.getElementById('rep-breakdown-card').innerText = `S/ ${bd.card.toFixed(2)}`;
    document.getElementById('rep-breakdown-transfer').innerText = `S/ ${bd.transfer.toFixed(2)}`;
    document.getElementById('rep-breakdown-fiado').innerText = `S/ ${bd.fiado.toFixed(2)}`;
    if (document.getElementById('rep-breakdown-abono')) {
      document.getElementById('rep-breakdown-abono').innerText = `S/ ${(bd.fiadoAbonos || 0).toFixed(2)}`;
    }

    renderSalesHistoryTable(currentReportSales, currentReportAbonos);
  } catch (err) {
    console.error('Error cargando historial de ventas:', err);
  }
}

function setReportPreset(preset) {
  const startEl = document.getElementById('rep-start-date');
  const endEl = document.getElementById('rep-end-date');
  const today = new Date();
  
  const formatDate = (d) => d.toISOString().split('T')[0];

  if (preset === 'today') {
    startEl.value = formatDate(today);
    endEl.value = formatDate(today);
  } else if (preset === 'week') {
    const firstDay = new Date(today.setDate(today.getDate() - today.getDay() + 1));
    startEl.value = formatDate(firstDay);
    endEl.value = formatDate(new Date());
  } else if (preset === 'month') {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    startEl.value = formatDate(firstDay);
    endEl.value = formatDate(new Date());
  } else if (preset === 'all') {
    startEl.value = '';
    endEl.value = '';
  }

  loadSalesHistory();
}

function exportSalesToCSV() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede exportar reportes.');
    return;
  }

  if (!currentReportSales || currentReportSales.length === 0) {
    alert('⚠️ No hay datos de ventas para exportar con los filtros actuales.');
    return;
  }

  const headers = ['N° Comprobante', 'Fecha', 'Cliente', 'Vendedor', 'Tipo Comprobante', 'Método Pago', 'Total (S/)', 'Ganancia (S/)', 'Estado'];
  const rows = currentReportSales.map(s => [
    `"${s.receipt_code}"`,
    `"${new Date(s.created_at).toLocaleString()}"`,
    `"${s.customer_name}"`,
    `"${s.user_name || 'Sistema'}"`,
    `"${s.doc_type}"`,
    `"${s.payment_method}"`,
    s.total.toFixed(2),
    s.profit.toFixed(2),
    `"${s.status}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Reporte_Ventas_VALEVENTAS_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function loadUsers() {
  if (!currentUser || currentUser.role !== 'Admin') return;

  try {
    const res = await fetch('/api/users', { headers: getAuthHeaders() });
    if (res.ok) {
      const users = await res.json();
      renderUsersTable(users);
    }
  } catch (err) {
    console.error('Error cargando usuarios:', err);
  }
}

// ==========================================
// 1. PUNTO DE VENTA (POS & ESCÁNER)
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
  focusSearchInput();
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

  grid.innerHTML = filtered.map(p => {
    const isLowStock = p.stock <= (p.min_stock || 5);
    return `
      <div onclick="addToCart(${p.id})" class="bg-white p-4 rounded-2xl border ${isLowStock ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'} shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group relative">
        ${isLowStock ? `<span class="absolute -top-2 -right-2 bg-rose-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-sm">Bajo Stock</span>` : ''}
        <div>
          <div class="flex justify-between items-start mb-2">
            <span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-md truncate max-w-[100px]">${p.category}</span>
            <span class="text-[10px] font-mono text-slate-400">#${p.code}</span>
          </div>
          <h3 class="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors line-clamp-2">${p.name}</h3>
        </div>
        <div class="mt-4 flex justify-between items-end pt-2 border-t border-slate-100">
          <div>
            <p class="text-[10px] ${isLowStock ? 'text-rose-600 font-black' : 'text-slate-400 font-bold'} uppercase">Stock: ${p.stock}</p>
            <p class="text-base font-black text-blue-600">S/ ${p.price.toFixed(2)}</p>
          </div>
          <button class="w-8 h-8 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold group-hover:bg-blue-600 group-hover:text-white transition-all">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function handleSearchKeyDown(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();

  const inputVal = document.getElementById('search-input').value.trim();
  if (!inputVal) return;

  let quantityToAdd = 1;
  let codeQuery = inputVal;

  if (inputVal.includes('*')) {
    const parts = inputVal.split('*');
    const parsedQty = parseInt(parts[0]);
    if (!isNaN(parsedQty) && parsedQty > 0 && parts[1]) {
      quantityToAdd = parsedQty;
      codeQuery = parts[1].trim();
    }
  }

  const targetQuery = codeQuery.toLowerCase();
  let found = PRODUCTS.find(p => p.code.toLowerCase() === targetQuery);
  
  if (!found) {
    found = PRODUCTS.find(p => p.name.toLowerCase() === targetQuery);
  }

  if (!found) {
    const filtered = PRODUCTS.filter(p => p.name.toLowerCase().includes(targetQuery) || p.code.toLowerCase().includes(targetQuery));
    if (filtered.length === 1) {
      found = filtered[0];
    }
  }

  if (found) {
    addToCartMultiple(found.id, quantityToAdd);
    document.getElementById('search-input').value = '';
    renderProducts();
  } else {
    playBeep('error');
    alert(`⚠️ Producto no encontrado para: "${codeQuery}"`);
  }
}

function addToCart(productId) {
  addToCartMultiple(productId, 1);
}

function addToCartMultiple(productId, quantity) {
  const prod = PRODUCTS.find(p => p.id === productId);
  if (!prod) return;

  if (prod.stock <= 0) {
    playBeep('error');
    alert(`⚠️ El producto "${prod.name}" no tiene stock disponible.`);
    return;
  }

  const existing = CART.find(item => item.product.id === productId);
  const currentQtyInCart = existing ? existing.quantity : 0;

  if (currentQtyInCart + quantity > prod.stock) {
    playBeep('error');
    alert(`⚠️ No puede agregar más de ${prod.stock} unidades de "${prod.name}".`);
    return;
  }

  if (existing) {
    existing.quantity += quantity;
  } else {
    CART.push({ product: prod, quantity });
  }

  playBeep('success');
  renderCart();
  focusSearchInput();
}

function updateCartQty(productId, delta) {
  const item = CART.find(i => i.product.id === productId);
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) {
    CART = CART.filter(i => i.product.id !== productId);
  }
  renderCart();
  focusSearchInput();
}

function removeFromCart(productId) {
  CART = CART.filter(i => i.product.id !== productId);
  playBeep('success');
  renderCart();
  focusSearchInput();
}

function clearCart() {
  CART = [];
  renderCart();
  focusSearchInput();
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
      <div class="py-3 flex justify-between items-center gap-2 border-b border-slate-100 last:border-0">
        <div class="flex-1 min-w-0">
          <p class="font-bold text-xs text-slate-800 truncate">${i.product.name}</p>
          <p class="text-[10px] text-slate-400">S/ ${i.product.price.toFixed(2)} c/u</p>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="updateCartQty(${i.product.id}, -1)" class="w-6 h-6 bg-slate-100 text-slate-600 rounded-md font-bold text-xs hover:bg-slate-200">-</button>
          <span class="font-bold text-xs text-slate-800 w-5 text-center">${i.quantity}</span>
          <button onclick="updateCartQty(${i.product.id}, 1)" class="w-6 h-6 bg-slate-100 text-slate-600 rounded-md font-bold text-xs hover:bg-slate-200">+</button>
        </div>
        <span class="font-black text-xs text-slate-900 w-14 text-right">S/ ${itemSubtotal.toFixed(2)}</span>
        <button onclick="removeFromCart(${i.product.id})" class="w-6 h-6 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-md flex items-center justify-center transition-colors" title="Quitar del carrito">
          <i class="fa-solid fa-xmark text-xs font-bold"></i>
        </button>
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
// MODAL COBRAR / PAGO
// ==========================================
function populateCustomerDropdown() {
  const select = document.getElementById('modal-select-customer');
  const editSelect = document.getElementById('edit-sale-customer');

  const optionsHTML = '<option value="">Público General</option>' + 
    CLIENTS.map(c => `<option value="${c.id}">${c.name} (${c.doc}) ${c.debt > 0 ? '- Deuda: S/ ' + c.debt.toFixed(2) : ''}</option>`).join('');

  if (select) select.innerHTML = optionsHTML;
  if (editSelect) editSelect.innerHTML = optionsHTML;
}

function openPaymentModal() {
  if (!currentCashRegister) {
    playBeep('error');
    alert('⚠️ Debe abrir la caja diaria antes de realizar ventas.');
    openOpenRegisterModal();
    return;
  }

  let total = CART.reduce((sum, i) => sum + (i.product.price * i.quantity), 0);
  document.getElementById('modal-pay-total').innerText = `S/ ${total.toFixed(2)}`;
  document.getElementById('input-paid-amount').value = total.toFixed(2);
  calculateChange();
  document.getElementById('modal-payment').classList.remove('hidden');
  
  setTimeout(() => {
    const inputPaid = document.getElementById('input-paid-amount');
    if (inputPaid) {
      inputPaid.focus();
      inputPaid.select();
    }
  }, 100);
}

function closePaymentModal() {
  document.getElementById('modal-payment').classList.add('hidden');
  focusSearchInput();
}

function selectDocType(type) {
  selectedDocType = type;
  document.querySelectorAll('.doc-btn').forEach(b => {
    b.className = 'doc-btn bg-white border border-slate-300 text-slate-600 font-bold py-2 rounded-lg text-xs hover:bg-slate-100';
  });
  const btn = document.getElementById('doc-' + type);
  if (btn) btn.className = 'doc-btn active bg-blue-600 text-white font-bold py-2 rounded-lg text-xs shadow-md';

  const boletaBox = document.getElementById('doc-fields-boleta');
  const facturaBox = document.getElementById('doc-fields-factura');
  if (boletaBox) boletaBox.classList.toggle('hidden', type !== 'Boleta');
  if (facturaBox) facturaBox.classList.toggle('hidden', type !== 'Factura');

  onPaymentCustomerChange();
}

function onPaymentCustomerChange() {
  const customerId = document.getElementById('modal-select-customer').value;
  const customerObj = CLIENTS.find(c => String(c.id) === String(customerId));

  if (customerObj) {
    if (selectedDocType === 'Boleta') {
      const dniEl = document.getElementById('boleta-dni');
      const nameEl = document.getElementById('boleta-name');
      if (dniEl) dniEl.value = customerObj.doc || '';
      if (nameEl) nameEl.value = customerObj.name || '';
    } else if (selectedDocType === 'Factura') {
      const rucEl = document.getElementById('factura-ruc');
      const razonEl = document.getElementById('factura-razon');
      if (rucEl) rucEl.value = customerObj.doc || '';
      if (razonEl) razonEl.value = customerObj.name || '';
    }
  }
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

function setQuickCash(amount) {
  let total = CART.reduce((sum, i) => sum + (i.product.price * i.quantity), 0);
  const paidVal = amount === 'exact' ? total : amount;
  document.getElementById('input-paid-amount').value = paidVal.toFixed(2);
  calculateChange();
}

function calculateChange() {
  let total = CART.reduce((sum, i) => sum + (i.product.price * i.quantity), 0);
  const paid = parseFloat(document.getElementById('input-paid-amount').value) || 0;
  const change = paid - total;
  document.getElementById('modal-pay-change').innerText = `S/ ${(change > 0 ? change : 0).toFixed(2)}`;
}

async function processFinalSale() {
  let customerId = document.getElementById('modal-select-customer').value;
  let customerObj = CLIENTS.find(c => String(c.id) === String(customerId));
  let customerName = customerObj ? customerObj.name : 'Público General';

  // Manejo dinámico para Boleta
  if (selectedDocType === 'Boleta') {
    const dni = (document.getElementById('boleta-dni')?.value || '').trim();
    const name = (document.getElementById('boleta-name')?.value || '').trim();
    if (name) {
      customerName = dni ? `${name} (DNI: ${dni})` : name;
    }
  }

  // Manejo dinámico para Factura
  if (selectedDocType === 'Factura') {
    const ruc = (document.getElementById('factura-ruc')?.value || '').trim();
    const razon = (document.getElementById('factura-razon')?.value || '').trim();
    if (!razon && !customerObj) {
      playBeep('error');
      alert('⚠️ Para emitir una Factura debe ingresar la Razón Social y RUC (11 dígitos) o seleccionar un cliente.');
      return;
    }
    if (razon) {
      customerName = ruc ? `${razon} (RUC: ${ruc})` : razon;
    }
  }

  // Si seleccionó FIADO
  if (selectedPaymentMethod === 'Fiado') {
    if (!customerId) {
      // Intentar auto-registrar cliente si se ingresaron datos manuales
      let docInput = '';
      let nameInput = '';
      if (selectedDocType === 'Factura') {
        docInput = (document.getElementById('factura-ruc')?.value || '').trim();
        nameInput = (document.getElementById('factura-razon')?.value || '').trim();
      } else {
        docInput = (document.getElementById('boleta-dni')?.value || '').trim();
        nameInput = (document.getElementById('boleta-name')?.value || '').trim();
      }

      if (!docInput || !nameInput) {
        playBeep('error');
        alert('⚠️ Para vender al FIADO debe seleccionar un cliente registrado de la lista o ingresar su DNI/RUC y Nombre / Razón Social.');
        return;
      }

      try {
        const custRes = await fetch('/api/customers', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ doc: docInput, name: nameInput, phone: '' })
        });
        const newCust = await custRes.json();
        if (custRes.ok && newCust.id) {
          customerId = String(newCust.id);
          customerName = newCust.name;
          await loadCustomers();
        } else {
          throw new Error(newCust.error || 'Error al auto-registrar el cliente');
        }
      } catch (e) {
        playBeep('error');
        alert('⚠️ ' + e.message);
        return;
      }
    }
  }

  let total = CART.reduce((sum, i) => sum + (i.product.price * i.quantity), 0);
  const paidAmount = parseFloat(document.getElementById('input-paid-amount').value) || total;
  const changeAmount = paidAmount > total ? paidAmount - total : 0;

  // Confirmación previa al cobro
  const confirmMsg = `¿Confirmar cobro por S/ ${total.toFixed(2)}?\n\n- Comprobante: ${selectedDocType}\n- Método: ${selectedPaymentMethod}\n- Cliente: ${customerName}`;
  if (!confirm(confirmMsg)) return;

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
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar venta');

    playBeep('success');

    // Renderizar Recibo de Impresión Térmica
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

    clearCart();
    await loadProducts();
    await loadCustomers();
    await loadDashboard();
    await loadCurrentCashRegister();

  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

function closeReceiptModal() {
  document.getElementById('modal-receipt').classList.add('hidden');
  focusSearchInput();
}

// ==========================================
// 2. INVENTARIO (CRUD & ALERTAS CRÍTICAS)
// ==========================================
function setInventoryFilter(filter) {
  inventoryFilterStock = filter;
  document.querySelectorAll('.inv-filter-btn').forEach(b => b.classList.remove('bg-blue-600', 'text-white'));
  const btn = document.getElementById('inv-filter-' + filter);
  if (btn) btn.classList.add('bg-blue-600', 'text-white');
  renderInventoryTable();
}

function renderInventoryTable() {
  const query = (document.getElementById('inventory-search')?.value || '').toLowerCase().trim();
  const tbody = document.getElementById('inventory-table-body');
  const isAdmin = currentUser && currentUser.role === 'Admin';
  
  const filtered = PRODUCTS.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query);
    const isLow = p.stock <= (p.min_stock || 5);
    const matchStock = inventoryFilterStock === 'all' || (inventoryFilterStock === 'low' && isLow);
    return matchQuery && matchStock;
  });

  tbody.innerHTML = filtered.map(p => {
    const isLow = p.stock <= (p.min_stock || 5);
    return `
      <tr class="hover:bg-slate-50 ${isLow ? 'bg-amber-50/40' : ''}">
        <td class="p-4 font-mono text-xs text-slate-500">${p.code}</td>
        <td class="p-4 font-bold text-slate-800">
          ${p.name}
          ${isLow ? '<span class="ml-2 bg-rose-100 text-rose-700 text-[9px] font-black px-2 py-0.5 rounded">Stock Crítico</span>' : ''}
        </td>
        <td class="p-4"><span class="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs">${p.category}</span></td>
        <td class="p-4 text-slate-500">S/ ${(p.purchase_price || 0).toFixed(2)}</td>
        <td class="p-4 font-bold text-slate-900">S/ ${p.price.toFixed(2)}</td>
        <td class="p-4"><span class="${isLow ? 'text-rose-600 bg-rose-100 border border-rose-200' : 'text-emerald-600 bg-emerald-100'} px-2.5 py-1 rounded font-bold text-xs">${p.stock} und.</span></td>
        <td class="p-4 text-center space-x-2">
          <button onclick="openStockIntakeModal(${p.id})" class="bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold px-2.5 py-1.5 rounded-lg text-xs transition-colors" title="Registrar ingreso de stock por Guía o Factura">
            <i class="fa-solid fa-boxes-packing mr-1"></i>+ Ingresar Stock
          </button>
          ${isAdmin ? `
            <button onclick="deleteProduct(${p.id})" class="text-rose-400 hover:text-rose-600 font-bold text-xs ml-2"><i class="fa-solid fa-trash mr-1"></i>Eliminar</button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function openStockIntakeModal(productId) {
  const prod = PRODUCTS.find(p => p.id === productId);
  if (!prod) return;

  document.getElementById('form-stock-intake').reset();
  document.getElementById('stock-intake-prod-id').value = prod.id;
  document.getElementById('stock-intake-prod-name').value = `${prod.name} (Stock Actual: ${prod.stock} unds.)`;
  document.getElementById('modal-stock-intake').classList.remove('hidden');
}

function closeStockIntakeModal() {
  document.getElementById('modal-stock-intake').classList.add('hidden');
  focusSearchInput();
}

async function saveStockIntake(e) {
  e.preventDefault();
  const prodId = document.getElementById('stock-intake-prod-id').value;
  const quantity = document.getElementById('stock-intake-qty').value;
  const doc_type = document.getElementById('stock-intake-doc-type').value;
  const doc_number = document.getElementById('stock-intake-doc-number').value.trim();
  const new_purchase_price = document.getElementById('stock-intake-new-purchase').value;
  const new_price = document.getElementById('stock-intake-new-price').value;
  const supplier_notes = document.getElementById('stock-intake-notes').value.trim();

  try {
    const res = await fetch(`/api/products/${prodId}/stock`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ quantity, doc_type, doc_number, supplier_notes, new_purchase_price, new_price })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error registrando ingreso de stock');

    closeStockIntakeModal();
    await loadProducts();
    await loadDashboard();
    playBeep('success');
    alert('✅ ' + data.message);
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

function openProductModal() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede registrar o modificar productos.');
    return;
  }
  document.getElementById('form-product').reset();
  document.getElementById('modal-product').classList.remove('hidden');
}

function closeProductModal() {
  document.getElementById('modal-product').classList.add('hidden');
  focusSearchInput();
}

async function saveProduct(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Permiso denegado.');
    return;
  }

  const payload = {
    code: document.getElementById('prod-code').value.trim(),
    name: document.getElementById('prod-name').value.trim(),
    category: document.getElementById('prod-category').value,
    purchase_price: parseFloat(document.getElementById('prod-purchase').value) || 0,
    price: parseFloat(document.getElementById('prod-price').value),
    stock: parseInt(document.getElementById('prod-stock').value) || 0,
    min_stock: parseInt(document.getElementById('prod-min-stock').value) || 5
  };

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Error al registrar producto');
    }

    closeProductModal();
    await loadProducts();
    await loadDashboard();
    playBeep('success');
    alert('✅ Producto guardado correctamente.');
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

async function deleteProduct(id) {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede eliminar productos.');
    return;
  }
  if (!confirm('¿Está seguro de eliminar este producto del inventario?')) return;

  try {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Error eliminando producto');
    await loadProducts();
    await loadDashboard();
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
  focusSearchInput();
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
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Error al registrar cliente');

    closeCustomerModal();
    await loadCustomers();
    playBeep('success');
    alert('✅ Cliente registrado con éxito.');
  } catch (err) {
    playBeep('error');
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
  focusSearchInput();
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
      headers: getAuthHeaders(),
      body: JSON.stringify({ customer_id: currentActiveCustomerForFiado.id, amount })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error registrando abono');

    playBeep('success');
    closeFiadoModal();

    // Renderizar Recibo Térmico de Abono
    document.getElementById('rec-title').innerText = 'COMPROBANTE DE ABONO DE DEUDA';
    document.getElementById('rec-id').innerText = data.receipt_code || `AB-${String(Date.now()).slice(-6)}`;
    document.getElementById('rec-customer').innerText = 'Cliente: ' + (data.customer_name || currentActiveCustomerForFiado.name);
    document.getElementById('rec-date').innerText = new Date().toLocaleString();
    document.getElementById('rec-total').innerText = `S/ ${amount.toFixed(2)}`;
    document.getElementById('rec-method').innerText = 'Abono en Efectivo';
    document.getElementById('rec-paid').innerText = `S/ ${amount.toFixed(2)}`;
    document.getElementById('rec-change').innerText = `S/ ${(data.newDebt || 0).toFixed(2)}`;

    document.getElementById('rec-items').innerHTML = `
      <div class="py-2 space-y-1">
        <p class="font-bold text-xs text-slate-800">PAGO / ABONO A CUENTA FIADO</p>
        <p class="text-[10px] text-slate-500">Cajero que Cobró: ${data.user_name || (currentUser ? currentUser.name : 'Sistema')}</p>
        <p class="text-xs text-emerald-600 font-black pt-1">Monto Cobrado: S/ ${amount.toFixed(2)}</p>
        <p class="text-xs text-slate-800 font-bold">Saldo Deuda Restante: S/ ${(data.newDebt || 0).toFixed(2)}</p>
      </div>
    `;

    document.getElementById('modal-receipt').classList.remove('hidden');

    await loadCustomers();
    await loadDashboard();
    await loadCurrentCashRegister();
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

// ==========================================
// 4. REPORTES & HISTORIAL DE VENTAS CON EDITAR/ANULAR POR ADMIN
// ==========================================
function renderSalesHistoryTable(sales = [], abonos = []) {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  const isAdmin = currentUser && currentUser.role === 'Admin';
  const combined = [];

  sales.forEach(s => {
    combined.push({
      id: s.id,
      code: s.receipt_code,
      date: new Date(s.created_at),
      customer: s.customer_name,
      user: s.user_name || 'Sistema',
      docType: s.doc_type,
      paymentMethod: s.payment_method,
      amount: s.total,
      profit: s.profit || 0,
      status: s.status,
      isAbono: false
    });
  });

  abonos.forEach(a => {
    combined.push({
      id: a.id,
      code: `AB-${String(a.id).padStart(5, '0')}`,
      date: new Date(a.created_at),
      customer: `${a.customer_name} ${a.customer_doc && a.customer_doc !== '-' ? '(DNI/RUC: ' + a.customer_doc + ')' : ''}`,
      user: a.user_name || 'Sistema',
      docType: 'RECIBO ABONO',
      paymentMethod: 'Efectivo (Abono)',
      amount: a.amount,
      profit: 0,
      status: 'completada',
      isAbono: true
    });
  });

  combined.sort((a, b) => b.date - a.date);

  if (combined.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-400">No hay ventas ni abonos registrados en el período seleccionado.</td></tr>`;
    return;
  }

  tbody.innerHTML = combined.map(item => `
    <tr class="hover:bg-slate-50 ${item.status === 'anulada' ? 'bg-slate-100/50 opacity-70' : (item.isAbono ? 'bg-emerald-50/40' : '')}">
      <td class="p-4 font-bold ${item.isAbono ? 'text-emerald-700 font-mono' : 'text-slate-800'}">${item.code}</td>
      <td class="p-4 text-slate-500 text-xs">${item.date.toLocaleString()}</td>
      <td class="p-4 text-slate-800 text-xs font-semibold">${item.customer}</td>
      <td class="p-4 text-slate-700 text-xs font-bold"><i class="fa-solid fa-user-tag text-blue-500 mr-1"></i>${item.user}</td>
      <td class="p-4"><span class="${item.isAbono ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'} px-2 py-1 rounded text-[10px] font-bold uppercase">${item.docType}</span></td>
      <td class="p-4"><span class="${item.isAbono ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : (item.paymentMethod === 'Fiado' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')} px-2 py-1 rounded text-[10px] font-bold uppercase">${item.paymentMethod}</span></td>
      <td class="p-4 text-right font-black ${item.isAbono ? 'text-emerald-600' : 'text-slate-900'}">S/ ${item.amount.toFixed(2)}</td>
      ${isAdmin ? `<td class="p-4 text-right font-bold text-emerald-600">${item.isAbono ? '-' : 'S/ ' + item.profit.toFixed(2)}</td>` : ''}
      ${isAdmin ? `
        <td class="p-4 text-center space-x-1">
          ${item.isAbono ? '<span class="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded">Abono Cobrado</span>' : (
            item.status === 'anulada' 
              ? '<span class="bg-rose-100 text-rose-700 px-2 py-1 rounded text-[10px] font-bold">Anulada</span>'
              : `
                 <button onclick="openEditSaleModal(${item.id})" class="bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold px-2.5 py-1.5 rounded-lg text-xs transition-colors" title="Editar datos de venta">
                   <i class="fa-solid fa-pen-to-square mr-1"></i>Editar
                 </button>
                 <button onclick="anularVenta(${item.id})" class="bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-2.5 py-1.5 rounded-lg text-xs transition-colors" title="Anular venta">
                   <i class="fa-solid fa-trash mr-1"></i>Anular
                 </button>
                `
          )}
        </td>
      ` : ''}
    </tr>
  `).join('');
}

function openEditSaleModal(saleId) {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede editar ventas.');
    return;
  }

  const sale = currentReportSales.find(s => s.id === saleId);
  if (!sale) return;

  document.getElementById('edit-sale-id').value = sale.id;
  document.getElementById('edit-sale-code').innerText = `#${sale.receipt_code}`;
  document.getElementById('edit-sale-doctype').value = sale.doc_type;
  document.getElementById('edit-sale-payment').value = sale.payment_method;
  document.getElementById('edit-sale-customer').value = sale.customer_id || '';

  document.getElementById('modal-edit-sale').classList.remove('hidden');
}

function closeEditSaleModal() {
  document.getElementById('modal-edit-sale').classList.add('hidden');
}

async function processSaveEditSale(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Permiso denegado.');
    return;
  }

  const saleId = document.getElementById('edit-sale-id').value;
  const doc_type = document.getElementById('edit-sale-doctype').value;
  const payment_method = document.getElementById('edit-sale-payment').value;
  const customer_id = document.getElementById('edit-sale-customer').value;

  const customerObj = CLIENTS.find(c => String(c.id) === String(customer_id));
  const customer_name = customerObj ? customerObj.name : 'Público General';

  try {
    const res = await fetch(`/api/sales/${saleId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        doc_type,
        payment_method,
        customer_id: customer_id ? parseInt(customer_id) : null,
        customer_name
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error editando venta');

    closeEditSaleModal();
    playBeep('success');
    alert('✅ Venta actualizada correctamente por Administrador.');
    await loadSalesHistory();
    await loadCustomers();
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

async function anularVenta(saleId) {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede anular ventas.');
    return;
  }
  if (!confirm('¿Está seguro de anular esta venta?\n\nSe devolverá el stock y, si era a FIADO, se reducirá la deuda del cliente.')) return;

  try {
    const res = await fetch(`/api/sales/${saleId}/anular`, { method: 'PUT', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error anulando venta');

    playBeep('success');
    alert('✅ ' + data.message);
    await loadSalesHistory();
    await loadDashboard();
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

// ==========================================
// 5. GESTIÓN DE USUARIOS Y ROLES (ADMIN ONLY)
// ==========================================
function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;

  tbody.innerHTML = users.map(u => `
    <tr class="hover:bg-slate-50">
      <td class="p-4 font-mono font-bold text-slate-800">${u.username}</td>
      <td class="p-4 text-slate-700">${u.name}</td>
      <td class="p-4"><span class="${u.role === 'Admin' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'} px-2.5 py-1 rounded text-xs font-bold">${u.role}</span></td>
      <td class="p-4 text-center"><span class="text-emerald-600 bg-emerald-100 px-2 py-1 rounded text-xs font-bold">Activo</span></td>
      <td class="p-4 text-center space-x-2">
        <button onclick="openPasswordModal(${u.id}, '${u.username}')" class="text-blue-600 hover:text-blue-800 font-bold text-xs bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
          <i class="fa-solid fa-key mr-1"></i>Cambiar Clave
        </button>
      </td>
    </tr>
  `).join('');
}

function openUserModal() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede gestionar usuarios.');
    return;
  }
  document.getElementById('form-user').reset();
  document.getElementById('modal-user').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('modal-user').classList.add('hidden');
}

async function saveUser(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Permiso denegado.');
    return;
  }

  const payload = {
    username: document.getElementById('user-username').value.trim(),
    password: document.getElementById('user-password').value.trim(),
    name: document.getElementById('user-name').value.trim(),
    role: document.getElementById('user-role').value
  };

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar usuario');

    closeUserModal();
    await loadUsers();
    playBeep('success');
    alert('✅ Usuario registrado con éxito.');
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

function openPasswordModal(userId, username) {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Permiso denegado.');
    return;
  }
  currentPasswordUserId = userId;
  document.getElementById('password-user-title').innerText = `Cambiar Contraseña para: ${username}`;
  document.getElementById('input-new-password').value = '';
  document.getElementById('modal-password').classList.remove('hidden');
}

function closePasswordModal() {
  document.getElementById('modal-password').classList.add('hidden');
}

async function processChangePassword(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Permiso denegado.');
    return;
  }
  if (!currentPasswordUserId) return;

  const newPassword = document.getElementById('input-new-password').value.trim();

  try {
    const res = await fetch(`/api/users/${currentPasswordUserId}/password`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error actualizando contraseña');

    closePasswordModal();
    playBeep('success');
    alert('✅ Contraseña actualizada correctamente.');
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

window.onload = init;
