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
let fiadoFilter = 'debt';
let currentReportSales = [];
let currentReportAbonos = [];
let currentPasswordUserId = null;
let socket = null;
let COMPANY_SETTINGS = {
  name: 'VALE-VENTAS by VALETEC',
  ruc: '20123456789',
  address: 'Av. Principal 123 - Lima, Perú',
  phone: '987654321',
  ticket_footer: '¡Gracias por su preferencia! Vuelva pronto.'
};

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
  if (!token) {
    logout();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    if (!res.ok) {
      logout();
      return;
    }
    const data = await res.json();
    currentUser = data.user;
    updateUserUI();
    await loadInitialData();
  } catch (err) {
    console.error('Error autenticando token:', err);
    logout();
  }
}

async function loadInitialData() {
  await loadCompanySettings();
  await loadCategories();
  await loadProducts();
  await loadCustomers();
  await loadCurrentCashRegister();
  if (currentUser && currentUser.role === 'Admin') {
    await loadDashboard();
    await loadSalesHistory();
    await loadUsers();
  }
  focusSearchInput();
}

function initWebSockets() {
  if (typeof io !== 'undefined') {
    socket = io();

    socket.on('connect', () => {
      console.log('⚡ Conectado a Servidor WebSocket POS Multicaja');
    });

    socket.on('categories_changed', async () => {
      console.log('⚡ Sincronización en tiempo real: Categorías actualizadas.');
      await loadCategories();
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

    socket.on('settings_changed', (settings) => {
      console.log('⚡ Sincronización en tiempo real: Datos del negocio actualizados.');
      COMPANY_SETTINGS = settings;
      applyCompanySettingsToUI();
    });
  }
}

function updateUserUI() {
  if (currentUser) {
    document.getElementById('user-display-name').innerText = currentUser.name;
    document.getElementById('user-display-role').innerText = `Rol: ${currentUser.role}`;
    document.getElementById('user-avatar').innerText = currentUser.name.substring(0, 2).toUpperCase();

    const isAdmin = currentUser.role === 'Admin';

    // Aplicar ocultamiento estricto a todos los elementos con clase admin-only (excepto secciones de vista)
    document.querySelectorAll('.admin-only:not(.view-section)').forEach(el => {
      if (isAdmin) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    // Si el usuario es Cajero y está en una vista administrativa o no permitida, enviarlo a Punto de Venta
    if (!isAdmin) {
      const activeSection = document.querySelector('.view-section:not(.hidden)');
      if (!activeSection || activeSection.id === 'view-dashboard' || activeSection.id === 'view-reports' || activeSection.id === 'view-users' || activeSection.id === 'view-company') {
        switchTab('pos');
      }
    }

    // Re-renderizar tablas para asegurar que las filas dinámicas respeten el rol
    renderInventoryTable();
    renderFiadosTable();
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
  if (loginModal) {
    loginModal.classList.remove('hidden');
    loginModal.classList.remove('opacity-0');
  }
  const userInput = document.getElementById('login-username');
  const passInput = document.getElementById('login-password');
  const passIcon = document.getElementById('icon-login-pass');
  if (userInput) userInput.value = '';
  if (passInput) {
    passInput.value = '';
    passInput.type = 'password';
  }
  if (passIcon) {
    passIcon.className = 'fa-solid fa-eye text-xs';
  }
  if (userInput) setTimeout(() => userInput.focus(), 150);
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
    
    // Limpiar campos del login para que no permanezcan en memoria/DOM
    const passInput = document.getElementById('login-password');
    if (passInput) {
      passInput.value = '';
      passInput.type = 'password';
    }
    const passIcon = document.getElementById('icon-login-pass');
    if (passIcon) passIcon.className = 'fa-solid fa-eye text-xs';

    updateUserUI();
    playBeep('success');

    await loadInitialData();

  } catch (err) {
    playBeep('error');
    alert('❌ ' + err.message);
  }
}

function logout() {
  localStorage.removeItem('valetec-token');
  currentUser = null;
  const userInput = document.getElementById('login-username');
  const passInput = document.getElementById('login-password');
  const passIcon = document.getElementById('icon-login-pass');
  if (userInput) userInput.value = '';
  if (passInput) {
    passInput.value = '';
    passInput.type = 'password';
  }
  if (passIcon) {
    passIcon.className = 'fa-solid fa-eye text-xs';
  }
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

// ==========================================
// CONTROL DE RESPONSIVIDAD MÓVIL Y MENU DRAWER
// ==========================================
function toggleMobileSidebar() {
  const sidebar = document.getElementById('main-sidebar');
  const backdrop = document.getElementById('mobile-sidebar-backdrop');
  if (!sidebar) return;
  const isClosed = sidebar.classList.contains('-translate-x-full');
  if (isClosed) {
    sidebar.classList.remove('-translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('main-sidebar');
  const backdrop = document.getElementById('mobile-sidebar-backdrop');
  if (sidebar) sidebar.classList.add('-translate-x-full');
  if (backdrop) backdrop.classList.add('hidden');
}

function switchTab(tabId) {
  // Validación de seguridad para navegación por tabs
  const adminTabs = ['dashboard', 'reports', 'users', 'company'];
  if (adminTabs.includes(tabId) && (!currentUser || currentUser.role !== 'Admin')) {
    alert('⚠️ Acceso restringido. Esta sección es exclusiva para el Administrador.');
    switchTab('pos');
    return;
  }

  const tabTitles = {
    dashboard: 'Dashboard',
    pos: 'Punto Venta',
    inventory: 'Inventario',
    crm: 'Clientes',
    fiados: 'Fiados',
    reports: 'Reportes',
    users: 'Usuarios',
    company: 'Mi Empresa'
  };
  const titleEl = document.getElementById('mobile-current-tab-title');
  if (titleEl && tabTitles[tabId]) titleEl.innerText = tabTitles[tabId];

  closeMobileSidebar();

  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));

  const targetView = document.getElementById('view-' + tabId);
  if (targetView) targetView.classList.remove('hidden');

  const isAdmin = currentUser && currentUser.role === 'Admin';

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('bg-blue-600', 'text-white', 'font-bold', 'shadow-md');
    btn.classList.add('text-slate-400', 'hover:bg-slate-800', 'hover:text-white', 'font-semibold');
  });

  const activeBtn = document.getElementById('btn-tab-' + tabId);
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-400', 'hover:bg-slate-800');
    activeBtn.classList.add('bg-blue-600', 'text-white', 'font-bold', 'shadow-md');
  }

  // Mantener ocultos de forma permanente y estricta los elementos administrativos para el rol Cajero
  document.querySelectorAll('.admin-only:not(.view-section)').forEach(el => {
    if (isAdmin) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  if (tabId === 'pos') focusSearchInput();
  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'inventory') renderInventoryTable();
  if (tabId === 'crm') renderCRMTable();
  if (tabId === 'fiados') {
    loadCustomers().then(() => renderFiadosTable());
  }
  if (tabId === 'reports') {
    loadSalesHistory();
    populateShiftUsersDropdown();
    loadShiftsHistory();
  }
  if (tabId === 'users') loadUsers();
  if (tabId === 'company') populateCompanySettingsView();
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
  } catch (e) { }
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
      closeKardexModal();
      closeWithdrawalModal();
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
          <td class="p-2 text-slate-400 text-[10px]">${new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
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
    await loadCurrentCashRegister();

    // Renderizar e invocar impresión del Ticket Térmico de Cierre Z
    renderCierreZReceipt(data.register);

  } catch (err) {
    playBeep('error');
    alert('❌ ' + err.message);
  }
}

function renderCierreZReceipt(reg) {
  if (!reg) return;
  applyCompanySettingsToCierreZ();

  const openDate = reg.opened_at ? new Date(reg.opened_at).toLocaleString() : '--';
  const closeDate = reg.closed_at ? new Date(reg.closed_at).toLocaleString() : new Date().toLocaleString();

  const opening = parseFloat(reg.opening_amount) || 0;
  const cashSales = parseFloat(reg.cash_sales) || 0;
  const fiadoAbonos = parseFloat(reg.fiado_abonos) || 0;
  const withdrawals = parseFloat(reg.total_withdrawals) || 0;
  const cardSales = parseFloat(reg.card_sales) || 0;
  const transferSales = parseFloat(reg.transfer_sales) || 0;
  const fiadoSales = parseFloat(reg.fiado_sales) || 0;
  const totalSales = cashSales + cardSales + transferSales + fiadoSales;

  const expected = parseFloat(reg.expected_cash) || (opening + cashSales + fiadoAbonos - withdrawals);
  const actual = parseFloat(reg.actual_cash) || 0;
  const diff = parseFloat(reg.difference) !== undefined ? parseFloat(reg.difference) : (actual - expected);

  document.getElementById('z-register-id').innerText = `TURNO / CAJA #${String(reg.id).padStart(4, '0')}`;
  document.getElementById('z-user-name').innerText = reg.user_name || (currentUser ? currentUser.name : 'Cajero');
  document.getElementById('z-opened-at').innerText = openDate;
  document.getElementById('z-closed-at').innerText = closeDate;

  document.getElementById('z-opening-amount').innerText = `S/ ${opening.toFixed(2)}`;
  document.getElementById('z-cash-sales').innerText = `S/ ${cashSales.toFixed(2)}`;
  document.getElementById('z-fiado-abonos').innerText = `S/ ${fiadoAbonos.toFixed(2)}`;
  document.getElementById('z-withdrawals').innerText = `S/ ${withdrawals.toFixed(2)}`;

  document.getElementById('z-card-sales').innerText = `S/ ${cardSales.toFixed(2)}`;
  document.getElementById('z-transfer-sales').innerText = `S/ ${transferSales.toFixed(2)}`;
  document.getElementById('z-fiado-sales').innerText = `S/ ${fiadoSales.toFixed(2)}`;
  document.getElementById('z-total-sales').innerText = `S/ ${totalSales.toFixed(2)}`;

  document.getElementById('z-expected-cash').innerText = `S/ ${expected.toFixed(2)}`;
  document.getElementById('z-actual-cash').innerText = `S/ ${actual.toFixed(2)}`;

  const diffEl = document.getElementById('z-difference');
  if (diff === 0) {
    diffEl.className = 'font-black text-emerald-700';
    diffEl.innerText = 'S/ 0.00 (Cuadre Exacto)';
  } else if (diff > 0) {
    diffEl.className = 'font-black text-blue-700';
    diffEl.innerText = `+ S/ ${diff.toFixed(2)} (Sobrante)`;
  } else {
    diffEl.className = 'font-black text-rose-700';
    diffEl.innerText = `- S/ ${Math.abs(diff).toFixed(2)} (Faltante)`;
  }

  document.getElementById('z-notes').innerText = reg.notes && reg.notes.trim() ? reg.notes.trim() : 'Sin observaciones';

  document.getElementById('modal-cierre-z-receipt').classList.remove('hidden');
}

function closeCierreZModal() {
  document.getElementById('modal-cierre-z-receipt').classList.add('hidden');
  focusSearchInput();
}

// ==========================================
// API FETCHERS
// ==========================================
async function loadDashboard() {
  if (!currentUser || currentUser.role !== 'Admin') return;
  try {
    const res = await fetch('/api/dashboard', { headers: getAuthHeaders() });
    if (!res.ok) return;
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
    const res = await fetch('/api/products', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    PRODUCTS = Array.isArray(data) ? data : [];
    renderCategoryFilters();
    renderProducts();
    renderInventoryTable();
  } catch (err) {
    console.error('Error cargando productos:', err);
  }
}

async function loadCustomers() {
  try {
    const res = await fetch('/api/customers', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    CLIENTS = Array.isArray(data) ? data : [];
    populateCustomerDropdown();
    renderCRMTable();
    renderFiadosTable();
  } catch (err) {
    console.error('Error cargando clientes:', err);
  }
}

async function loadSalesHistory() {
  if (!currentUser || currentUser.role !== 'Admin') return;
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
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.summary) return;

    currentReportSales = Array.isArray(data.sales) ? data.sales : [];
    currentReportAbonos = Array.isArray(data.abonos) ? data.abonos : [];

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

// ==========================================
// EXPORTACIÓN PROFESIONAL DE REPORTES (EXCEL .XLSX Y PDF OFICIAL)
// ==========================================
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 300);
}

function getReportTransactionsToExport() {
  const combined = [];
  (currentReportSales || []).forEach(s => {
    combined.push({
      id: s.id,
      code: s.receipt_code,
      date: new Date(s.created_at),
      customer: s.customer_name || 'Público General',
      doc: s.customer_doc || '-',
      user: s.user_name || 'Sistema',
      docType: s.doc_type || 'Ticket',
      paymentMethod: s.payment_method || 'Efectivo',
      amount: parseFloat(s.total) || 0,
      profit: parseFloat(s.profit) || 0,
      status: s.status || 'completada',
      isAbono: false
    });
  });

  (currentReportAbonos || []).forEach(a => {
    combined.push({
      id: a.id,
      code: `AB-${String(a.id).padStart(5, '0')}`,
      date: new Date(a.created_at),
      customer: a.customer_name || 'Cliente Registrado',
      doc: a.customer_doc || '-',
      user: a.user_name || 'Sistema',
      docType: 'RECIBO ABONO',
      paymentMethod: 'Efectivo (Abono)',
      amount: parseFloat(a.amount) || 0,
      profit: 0,
      status: 'completada',
      isAbono: true
    });
  });

  combined.sort((a, b) => b.date - a.date);

  const query = (document.getElementById('rep-search-input')?.value || '').toLowerCase().trim();
  return query
    ? combined.filter(item =>
        (item.code && item.code.toLowerCase().includes(query)) ||
        (item.customer && item.customer.toLowerCase().includes(query)) ||
        (item.user && item.user.toLowerCase().includes(query)) ||
        (item.docType && item.docType.toLowerCase().includes(query)) ||
        (item.paymentMethod && item.paymentMethod.toLowerCase().includes(query))
      )
    : combined;
}

function getReportFilterText() {
  const sDate = document.getElementById('rep-start-date')?.value || 'Inicio';
  const eDate = document.getElementById('rep-end-date')?.value || 'Hoy';
  const pMethod = document.getElementById('rep-payment-method')?.value || 'Todos';
  const dType = document.getElementById('rep-doc-type')?.value || 'Todos';
  return `Fechas: ${sDate} al ${eDate} | Método: ${pMethod} | Comprobante: ${dType}`;
}

async function exportSalesReportToExcel() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede exportar reportes.');
    return;
  }

  const transactions = getReportTransactionsToExport();
  if (!transactions || transactions.length === 0) {
    alert('⚠️ No hay transacciones de ventas para exportar con los filtros actuales.');
    return;
  }

  if (typeof ExcelJS === 'undefined') {
    alert('⚠️ La librería de Excel aún no ha cargado. Por favor, refresque la página.');
    return;
  }

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VALEVENTAS POS by VT VALETEC';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Reporte de Ventas', {
      views: [{ showGridLines: true }]
    });

    const companyName = COMPANY_SETTINGS?.name || 'VALEVENTAS';
    const companyRuc = COMPANY_SETTINGS?.ruc || '20123456789';
    const companyAddr = COMPANY_SETTINGS?.address || 'Av. Principal 123 - Lima, Perú';
    const companyPhone = COMPANY_SETTINGS?.phone || '987654321';

    // 1. BANNER INSTITUCIONAL DE CABECERA
    sheet.mergeCells('A1:J1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'VALEVENTAS POS - REPORTE EJECUTIVO DE VENTAS Y COMPROBANTES';
    titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 36;

    sheet.mergeCells('A2:J2');
    const subCell = sheet.getCell('A2');
    subCell.value = `${companyName} | RUC: ${companyRuc} | Dirección: ${companyAddr} | Teléfono: ${companyPhone}`;
    subCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF38BDF8' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(2).height = 22;

    sheet.mergeCells('A3:J3');
    const metaCell = sheet.getCell('A3');
    metaCell.value = `Emisión: ${new Date().toLocaleString()} | Generado por: ${currentUser.name} (${currentUser.username}) | Filtros: ${getReportFilterText()}`;
    metaCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFE2E8F0' } };
    metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(3).height = 20;

    sheet.getRow(4).height = 10;

    // 2. TARJETAS DE INDICADORES FINANCIEROS (KPIS)
    let totalVentas = 0;
    let totalGanancia = 0;
    const breakdown = { cash: 0, card: 0, transfer: 0, fiado: 0, abono: 0, cortesia: 0, mixto: 0 };

    transactions.forEach(t => {
      if (t.status !== 'anulada') {
        totalVentas += t.amount;
        totalGanancia += t.profit;

        if (t.isAbono) breakdown.abono += t.amount;
        else if (t.paymentMethod === 'Efectivo') breakdown.cash += t.amount;
        else if (t.paymentMethod === 'Tarjeta') breakdown.card += t.amount;
        else if (t.paymentMethod === 'Yape/Plin') breakdown.transfer += t.amount;
        else if (t.paymentMethod === 'Fiado') breakdown.fiado += t.amount;
        else if (t.paymentMethod === 'Cortesia') breakdown.cortesia += t.amount;
        else if (t.paymentMethod === 'Pago Mixto') breakdown.mixto += t.amount;
      }
    });

    const totalTickets = transactions.length;
    const avgTicket = totalTickets > 0 ? (totalVentas / totalTickets) : 0;

    const styleKpiCard = (headerRange, valueRange, title, value, isCurrency, headerColor, textColor, bgColor) => {
      sheet.mergeCells(headerRange);
      const hCell = sheet.getCell(headerRange.split(':')[0]);
      hCell.value = title;
      hCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } };
      hCell.alignment = { vertical: 'middle', horizontal: 'center' };

      sheet.mergeCells(valueRange);
      const vCell = sheet.getCell(valueRange.split(':')[0]);
      vCell.value = value;
      vCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: textColor } };
      vCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      vCell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (isCurrency) vCell.numFmt = '[$S/ ]#,##0.00';
      else vCell.numFmt = '#,##0';
    };

    sheet.getRow(5).height = 18;
    sheet.getRow(6).height = 28;

    styleKpiCard('A5:B5', 'A6:B6', 'VENTAS TOTALES', totalVentas, true, 'FF1E40AF', 'FF1E40AF', 'FFEFF6FF');
    styleKpiCard('C5:D5', 'C6:D6', 'GANANCIA NETA ESTIMADA', totalGanancia, true, 'FF065F46', 'FF065F46', 'FFECFDF5');
    styleKpiCard('E5:G5', 'E6:G6', 'TOTAL TRANSACCIONES', totalTickets, false, 'FF374151', 'FF111827', 'FFF3F4F6');
    styleKpiCard('H5:J5', 'H6:J6', 'TICKET PROMEDIO', avgTicket, true, 'FF6B21A8', 'FF6B21A8', 'FFFAF5FF');

    sheet.getRow(7).height = 12;

    // 3. TABLA DE RECAUDACIÓN POR MÉTODO DE PAGO
    sheet.mergeCells('A8:D8');
    const recTitle = sheet.getCell('A8');
    recTitle.value = 'RESUMEN DE RECAUDACIÓN POR MÉTODO DE PAGO';
    recTitle.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    recTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    recTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    sheet.getRow(8).height = 20;

    sheet.mergeCells('A9:B9');
    sheet.getCell('A9').value = 'Método de Pago';
    sheet.getCell('C9').value = 'Monto Total';
    sheet.getCell('D9').value = '% Participación';
    ['A9', 'B9', 'C9', 'D9'].forEach(pos => {
      const c = sheet.getCell(pos);
      c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF475569' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      c.alignment = { vertical: 'middle', horizontal: pos === 'C9' || pos === 'D9' ? 'right' : 'left' };
    });
    sheet.getRow(9).height = 18;

    const paymentRows = [
      ['💵 Efectivo en Ventas', breakdown.cash],
      ['💳 Tarjeta Débito / Crédito', breakdown.card],
      ['📱 Transferencias (Yape / Plin)', breakdown.transfer],
      ['🤝 Ventas al Fiado (Por Cobrar)', breakdown.fiado],
      ['💰 Cobranzas y Abonos Fiado', breakdown.abono],
      ['🎁 Salidas por Cortesía', breakdown.cortesia]
    ];

    paymentRows.forEach((row, idx) => {
      const rowNum = 10 + idx;
      sheet.mergeCells(`A${rowNum}:B${rowNum}`);
      const mLabel = sheet.getCell(`A${rowNum}`);
      mLabel.value = row[0];
      mLabel.font = { name: 'Calibri', size: 9 };

      const mAmt = sheet.getCell(`C${rowNum}`);
      mAmt.value = row[1];
      mAmt.numFmt = '[$S/ ]#,##0.00';
      mAmt.font = { name: 'Calibri', size: 9, bold: true };
      mAmt.alignment = { horizontal: 'right' };

      const mPct = sheet.getCell(`D${rowNum}`);
      mPct.value = totalVentas > 0 ? (row[1] / totalVentas) : 0;
      mPct.numFmt = '0.0%';
      mPct.font = { name: 'Calibri', size: 9, color: { argb: 'FF64748B' } };
      mPct.alignment = { horizontal: 'right' };

      sheet.getRow(rowNum).height = 18;
    });

    sheet.getRow(16).height = 12;

    // 4. TABLA PRINCIPAL DE TRANSACCIONES
    sheet.mergeCells('A17:J17');
    const tHeadTitle = sheet.getCell('A17');
    tHeadTitle.value = 'DETALLE INDIVIDUAL DE VENTAS Y COMPROBANTES EMITIDOS';
    tHeadTitle.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    tHeadTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    tHeadTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    sheet.getRow(17).height = 22;

    const headers = [
      'N° Comprobante',
      'Fecha / Hora',
      'Cliente',
      'Doc. Identidad',
      'Vendedor / Cajero',
      'Tipo Comprobante',
      'Método de Pago',
      'Monto Total (S/)',
      'Ganancia Neta (S/)',
      'Estado'
    ];

    const headerRow = sheet.getRow(18);
    headerRow.values = headers;
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF475569' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FF475569' } },
        right: { style: 'thin', color: { argb: 'FF475569' } }
      };
    });

    // Filas de datos
    transactions.forEach((t, i) => {
      const rowIdx = 19 + i;
      const row = sheet.getRow(rowIdx);
      row.values = [
        t.code,
        t.date.toLocaleString(),
        t.customer,
        t.doc,
        t.user,
        t.docType,
        t.paymentMethod,
        t.amount,
        t.profit,
        t.status.toUpperCase()
      ];

      const isEven = i % 2 === 0;
      const rowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Calibri', size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        if (colNum === 1) {
          cell.alignment = { horizontal: 'center' };
          cell.font = { name: 'Calibri', size: 9, bold: true };
        } else if (colNum === 2 || colNum === 4 || colNum === 6 || colNum === 7) {
          cell.alignment = { horizontal: 'center' };
        } else if (colNum === 3 || colNum === 5) {
          cell.alignment = { horizontal: 'left' };
        } else if (colNum === 8) {
          cell.alignment = { horizontal: 'right' };
          cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF1E40AF' } };
          cell.numFmt = '[$S/ ]#,##0.00';
        } else if (colNum === 9) {
          cell.alignment = { horizontal: 'right' };
          cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF065F46' } };
          cell.numFmt = '[$S/ ]#,##0.00';
        } else if (colNum === 10) {
          cell.alignment = { horizontal: 'center' };
          const isOk = t.status !== 'anulada';
          cell.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: isOk ? 'FF059669' : 'FFE11D48' } };
        }
      });
      row.height = 20;
    });

    // 5. FILA DE TOTALES GENERALES
    const lastRowIdx = 19 + transactions.length;
    sheet.mergeCells(`A${lastRowIdx}:G${lastRowIdx}`);
    const totLabel = sheet.getCell(`A${lastRowIdx}`);
    totLabel.value = 'TOTALES CONSOLIDADOS';
    totLabel.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    totLabel.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    totLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    const totSalesCell = sheet.getCell(`H${lastRowIdx}`);
    totSalesCell.value = { formula: `SUM(H19:H${lastRowIdx - 1})` };
    totSalesCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E40AF' } };
    totSalesCell.alignment = { vertical: 'middle', horizontal: 'right' };
    totSalesCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    totSalesCell.numFmt = '[$S/ ]#,##0.00';
    totSalesCell.border = { bottom: { style: 'double', color: { argb: 'FF0F172A' } } };

    const totProfitCell = sheet.getCell(`I${lastRowIdx}`);
    totProfitCell.value = { formula: `SUM(I19:I${lastRowIdx - 1})` };
    totProfitCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF065F46' } };
    totProfitCell.alignment = { vertical: 'middle', horizontal: 'right' };
    totProfitCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    totProfitCell.numFmt = '[$S/ ]#,##0.00';
    totProfitCell.border = { bottom: { style: 'double', color: { argb: 'FF0F172A' } } };

    const totStatusCell = sheet.getCell(`J${lastRowIdx}`);
    totStatusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    sheet.getRow(lastRowIdx).height = 24;

    sheet.columns = [
      { width: 18 }, // A: Comprobante
      { width: 22 }, // B: Fecha/Hora
      { width: 30 }, // C: Cliente
      { width: 16 }, // D: Doc
      { width: 22 }, // E: Vendedor
      { width: 18 }, // F: Tipo
      { width: 22 }, // G: Método Pago
      { width: 18 }, // H: Total S/
      { width: 18 }, // I: Ganancia S/
      { width: 15 }  // J: Estado
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const filename = `Reporte_Ventas_${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    downloadBlob(blob, filename);

    playBeep('success');
  } catch (err) {
    console.error('Error generando Excel:', err);
    playBeep('error');
    alert('❌ Error generando archivo Excel: ' + err.message);
  }
}

async function exportSalesReportToPDF() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede exportar reportes.');
    return;
  }

  const transactions = getReportTransactionsToExport();
  if (!transactions || transactions.length === 0) {
    alert('⚠️ No hay transacciones de ventas para exportar con los filtros actuales.');
    return;
  }

  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('⚠️ La librería de PDF aún no ha cargado. Por favor, refresque la página.');
    return;
  }

  try {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const companyName = COMPANY_SETTINGS?.name || 'VALEVENTAS';
    const companyRuc = COMPANY_SETTINGS?.ruc || '20123456789';
    const companyAddr = COMPANY_SETTINGS?.address || 'Av. Principal 123 - Lima, Perú';
    const companyPhone = COMPANY_SETTINGS?.phone || '987654321';

    // 1. Barra superior decorativa
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageWidth, 8, 'F');

    // 2. Encabezado corporativo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(companyName, 40, 36);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`RUC: ${companyRuc}  |  ${companyAddr}  |  Telf: ${companyPhone}`, 40, 49);

    // Título derecho
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 41, 59);
    doc.text('REPORTE OFICIAL DE VENTAS Y COMPROBANTES', pageWidth - 40, 34, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generado: ${new Date().toLocaleString()}  |  Usuario: ${currentUser.name}`, pageWidth - 40, 47, { align: 'right' });

    // 3. Tarjetas de KPIs (Resumen)
    let totalVentas = 0;
    let totalGanancia = 0;
    transactions.forEach(t => {
      if (t.status !== 'anulada') {
        totalVentas += t.amount;
        totalGanancia += t.profit;
      }
    });
    const avgTicket = transactions.length > 0 ? (totalVentas / transactions.length) : 0;

    const kpiCards = [
      { label: 'VENTAS TOTALES', val: `S/ ${totalVentas.toFixed(2)}`, color: [30, 64, 175], bg: [239, 246, 255] },
      { label: 'GANANCIA ESTIMADA', val: `S/ ${totalGanancia.toFixed(2)}`, color: [6, 95, 70], bg: [236, 253, 245] },
      { label: 'N° TRANSACCIONES', val: `${transactions.length}`, color: [55, 65, 81], bg: [243, 244, 246] },
      { label: 'TICKET PROMEDIO', val: `S/ ${avgTicket.toFixed(2)}`, color: [107, 33, 168], bg: [250, 245, 255] }
    ];

    const cardWidth = (pageWidth - 80 - 30) / 4;
    const cardY = 62;
    const cardH = 38;

    kpiCards.forEach((c, i) => {
      const x = 40 + i * (cardWidth + 10);
      doc.setFillColor(c.bg[0], c.bg[1], c.bg[2]);
      doc.roundedRect(x, cardY, cardWidth, cardH, 5, 5, 'F');
      doc.setDrawColor(c.color[0], c.color[1], c.color[2]);
      doc.setLineWidth(0.8);
      doc.roundedRect(x, cardY, cardWidth, cardH, 5, 5, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(c.color[0], c.color[1], c.color[2]);
      doc.text(c.label, x + cardWidth / 2, cardY + 13, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text(c.val, x + cardWidth / 2, cardY + 30, { align: 'center' });
    });

    // Línea de filtros
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`Parámetros de filtrado: ${getReportFilterText()}`, 40, 114);

    // 4. Tabla de Transacciones con autoTable
    const tableHeaders = [
      ['N° Comprobante', 'Fecha / Hora', 'Cliente', 'Doc. Identidad', 'Vendedor', 'Tipo', 'Método Pago', 'Total (S/)', 'Ganancia (S/)', 'Estado']
    ];

    const tableData = transactions.map(t => [
      t.code,
      t.date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      t.customer.length > 25 ? t.customer.substring(0, 23) + '...' : t.customer,
      t.doc,
      t.user,
      t.docType,
      t.paymentMethod,
      `S/ ${t.amount.toFixed(2)}`,
      `S/ ${t.profit.toFixed(2)}`,
      t.status.toUpperCase()
    ]);

    const tableFoot = [
      [
        'TOTALES',
        '',
        '',
        '',
        '',
        '',
        '',
        `S/ ${totalVentas.toFixed(2)}`,
        `S/ ${totalGanancia.toFixed(2)}`,
        ''
      ]
    ];

    doc.autoTable({
      head: tableHeaders,
      body: tableData,
      foot: tableFoot,
      startY: 122,
      margin: { left: 40, right: 40, bottom: 35 },
      theme: 'striped',
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
        cellPadding: 4
      },
      bodyStyles: {
        fontSize: 7.5,
        cellPadding: 3.5,
        textColor: [51, 65, 85]
      },
      footStyles: {
        fillColor: [226, 232, 240],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 8.5,
        cellPadding: 4
      },
      columnStyles: {
        0: { halign: 'center', fontStyle: 'bold', cellWidth: 70 },
        1: { halign: 'center', cellWidth: 75 },
        2: { halign: 'left', cellWidth: 120 },
        3: { halign: 'center', cellWidth: 65 },
        4: { halign: 'left', cellWidth: 75 },
        5: { halign: 'center', cellWidth: 65 },
        6: { halign: 'center', cellWidth: 75 },
        7: { halign: 'right', fontStyle: 'bold', textColor: [30, 64, 175], cellWidth: 70 },
        8: { halign: 'right', fontStyle: 'bold', textColor: [6, 95, 70], cellWidth: 70 },
        9: { halign: 'center', fontStyle: 'bold', cellWidth: 65 }
      },
      didParseCell: function(data) {
        if (data.section === 'body' && data.column.index === 9) {
          const isOk = data.cell.raw !== 'ANULADA';
          data.cell.styles.textColor = isOk ? [5, 150, 105] : [225, 29, 72];
        }
      },
      didDrawPage: function(data) {
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `VALEVENTAS POS | Soluciones de Punto de Venta & Facturación by VT VALETEC`,
          40,
          pageHeight - 15
        );
        doc.text(
          `Página ${doc.internal.getCurrentPageInfo().pageNumber} de ${pageCount}`,
          pageWidth - 40,
          pageHeight - 15,
          { align: 'right' }
        );
      }
    });

    const filename = `Reporte_Ventas_${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
    playBeep('success');
  } catch (err) {
    console.error('Error generando PDF:', err);
    playBeep('error');
    alert('❌ Error generando PDF: ' + err.message);
  }
}

// Fallback / Alias
function exportSalesToCSV() {
  exportSalesReportToExcel();
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
  const container = document.getElementById('category-filters');
  if (!container) return;

  const catNames = (CATEGORIES && CATEGORIES.length > 0)
    ? CATEGORIES.map(c => c.name)
    : [...new Set(PRODUCTS.map(p => p.category))];

  const categories = ['Todos', ...new Set(catNames)];

  let html = categories.map(cat => `
    <button onclick="setCategory('${cat.replace(/'/g, "\\'")}')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${activeCategory === cat ? 'bg-slate-900 text-white shadow-md scale-105' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
      ${cat}
    </button>
  `).join('');

  if (currentUser && currentUser.role === 'Admin') {
    html += `
      <button onclick="openManageCategoriesModal()" class="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 text-indigo-700 border border-indigo-200 shadow-xs flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95 shrink-0" title="Crear o administrar categorías">
        <i class="fa-solid fa-tags text-indigo-600"></i> + Categoría
      </button>
    `;
  }

  container.innerHTML = html;
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
      <div onclick="addToCart(${p.id})" class="bg-white p-3 sm:p-4 rounded-2xl border ${isLowStock ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'} shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group relative">
        ${isLowStock ? `<span class="absolute -top-2 -right-2 bg-rose-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-sm">Bajo Stock</span>` : ''}
        <div>
          <div class="flex justify-between items-start mb-1.5 sm:mb-2">
            <span class="bg-slate-100 text-slate-600 text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-md truncate max-w-[80px] sm:max-w-[100px]">${p.category}</span>
            <span class="text-[9px] sm:text-[10px] font-mono text-slate-400">#${p.code}</span>
          </div>
          <h3 class="font-bold text-slate-800 text-xs sm:text-sm group-hover:text-blue-600 transition-colors line-clamp-2 leading-snug">${p.name}</h3>
        </div>
        <div class="mt-2.5 sm:mt-4 flex justify-between items-end pt-2 border-t border-slate-100">
          <div>
            <p class="text-[9px] sm:text-[10px] ${isLowStock ? 'text-rose-600 font-black' : 'text-slate-400 font-bold'} uppercase">Stock: ${p.stock}</p>
            <p class="text-sm sm:text-base font-black text-blue-600">S/ ${p.price.toFixed(2)}</p>
          </div>
          <button class="w-7 h-7 sm:w-8 sm:h-8 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold group-hover:bg-blue-600 group-hover:text-white transition-all text-xs sm:text-sm">
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

  if (delta > 0 && item.quantity + delta > item.product.stock) {
    playBeep('error');
    alert(`⚠️ Stock máximo alcanzado (${item.product.stock} unidades disponibles de "${item.product.name}").`);
    return;
  }

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

  const optionsHTML =
    '<option value="">Público General</option>' +
    CLIENTS.map(c => {
      const debt = Number(c.debt || 0);

      return `<option value="${c.id}">
        ${c.name} (${c.doc})${debt > 0 ? ` - Deuda: S/ ${debt.toFixed(2)}` : ''}
      </option>`;
    }).join('');

  if (select) select.innerHTML = optionsHTML;
  if (editSelect) editSelect.innerHTML = optionsHTML;

  renderCustomerSearchResults();
}

// ==========================================
// BUSCADOR INTERACTIVO DE CLIENTES EN POS
// ==========================================
function filterCustomerSearchResults() {
  const query = (document.getElementById('cust-search-input')?.value || '').toLowerCase().trim();
  const clearBtn = document.getElementById('btn-clear-cust-search');
  if (clearBtn) clearBtn.classList.toggle('hidden', query.length === 0);

  renderCustomerSearchResults(query);
  showCustomerSearchResults();
}

function showCustomerSearchResults() {
  const query = (document.getElementById('cust-search-input')?.value || '').toLowerCase().trim();
  renderCustomerSearchResults(query);
  const container = document.getElementById('cust-search-results');
  if (container) container.classList.remove('hidden');
}

function renderCustomerSearchResults(query = '') {
  const container = document.getElementById('cust-search-results');
  if (!container) return;

  const filtered = CLIENTS.filter(c =>
    c.name.toLowerCase().includes(query) || (c.doc && c.doc.toLowerCase().includes(query))
  );

  let html = `
    <div onclick="selectCustomerFromSearch('')" class="p-3 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-colors">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-users text-slate-400"></i>
        <span class="font-bold text-xs text-slate-800">Público General</span>
      </div>
      <span class="text-[10px] text-slate-400 font-bold bg-slate-100 px-2 py-0.5 rounded">Predeterminado</span>
    </div>
  `;

  if (filtered.length === 0 && query.length > 0) {
    html += `
      <div class="p-3 text-center text-slate-400 text-xs font-semibold">
        No se encontró ningún cliente con "${query}".
        <button type="button" onclick="openCustomerModal()" class="block mx-auto mt-1 text-blue-600 font-bold hover:underline">
          <i class="fa-solid fa-plus-circle mr-1"></i>+ Registrar como Nuevo Cliente
        </button>
      </div>
    `;
  } else {
    html += filtered.map(c => `
      <div onclick="selectCustomerFromSearch(${c.id})" class="p-3 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-colors">
        <div>
          <p class="font-bold text-xs text-slate-800">${c.name}</p>
          <p class="text-[10px] text-slate-400 font-mono">DNI/RUC: ${c.doc || 'Sin Doc'}</p>
        </div>
        ${c.debt > 0 ? `<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded">Deuda: S/ ${c.debt.toFixed(2)}</span>` : '<span class="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded">Sin Deuda</span>'}
      </div>
    `).join('');
  }

  container.innerHTML = html;
}

function selectCustomerFromSearch(customerId) {
  const select = document.getElementById('modal-select-customer');
  if (select) select.value = customerId ? String(customerId) : '';

  const customerObj = CLIENTS.find(c => String(c.id) === String(customerId));
  const badge = document.getElementById('cust-selected-badge');
  const badgeText = document.getElementById('cust-selected-text');
  const searchInput = document.getElementById('cust-search-input');
  const clearBtn = document.getElementById('btn-clear-cust-search');

  if (customerObj) {
    if (badgeText) badgeText.innerText = `${customerObj.name} (DNI/RUC: ${customerObj.doc}) ${customerObj.debt > 0 ? ' - Deuda: S/ ' + customerObj.debt.toFixed(2) : ''}`;
    if (badge) badge.classList.remove('hidden');
    if (searchInput) searchInput.value = customerObj.name;
    if (clearBtn) clearBtn.classList.remove('hidden');
  } else {
    if (badgeText) badgeText.innerText = 'Público General';
    if (badge) badge.classList.add('hidden');
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
  }

  const container = document.getElementById('cust-search-results');
  if (container) container.classList.add('hidden');

  onPaymentCustomerChange();
}

function clearCustomerSearch() {
  selectCustomerFromSearch('');
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
  selectPaymentMethod('Efectivo');
  if (document.getElementById('cortesia-reason')) document.getElementById('cortesia-reason').value = '';
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
    b.className = 'pay-method-btn bg-slate-50 border border-slate-200 text-slate-600 font-bold p-2 sm:p-2.5 rounded-xl text-[11px] sm:text-xs flex flex-col items-center gap-1 hover:bg-slate-100';
  });

  const btnMap = {
    'Efectivo': 'pay-cash',
    'Tarjeta': 'pay-card',
    'Yape/Plin': 'pay-transfer',
    'Pago Mixto': 'pay-mixed',
    'Fiado': 'pay-fiado',
    'Cortesia': 'pay-cortesia'
  };

  const selectedBtn = document.getElementById(btnMap[method]);
  if (selectedBtn) {
    selectedBtn.className = 'pay-method-btn active bg-blue-50 border-2 border-blue-500 text-blue-900 font-bold p-2 sm:p-2.5 rounded-xl text-[11px] sm:text-xs flex flex-col items-center gap-1 shadow-sm';
  }

  const mixedBox = document.getElementById('mixed-payment-box');
  if (mixedBox) mixedBox.classList.toggle('hidden', method !== 'Pago Mixto');

  const cortesiaBox = document.getElementById('cortesia-box');
  if (cortesiaBox) cortesiaBox.classList.toggle('hidden', method !== 'Cortesia');

  const cashCalcBox = document.getElementById('cash-calculation-box');
  if (cashCalcBox) cashCalcBox.classList.toggle('hidden', method === 'Cortesia');

  if (method === 'Pago Mixto') {
    let total = CART.reduce((sum, i) => sum + (i.product.price * i.quantity), 0);
    const half = (total / 2).toFixed(2);
    const cashInput = document.getElementById('mixed-cash-input');
    if (cashInput) cashInput.value = half;
    calculateMixedSplit();
  } else if (method === 'Cortesia') {
    const reasonInput = document.getElementById('cortesia-reason');
    if (reasonInput) setTimeout(() => reasonInput.focus(), 100);
  }
}

function calculateMixedSplit() {
  let total = CART.reduce((sum, i) => sum + (i.product.price * i.quantity), 0);
  const mixedCash = parseFloat(document.getElementById('mixed-cash-input')?.value) || 0;
  const mixedOther = Math.max(0, total - mixedCash);
  const otherInput = document.getElementById('mixed-other-input');
  if (otherInput) otherInput.value = mixedOther.toFixed(2);
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
        alert('⚠️ Para vender al FIADO debe seleccionar un cliente registrado de la lista o ingresar su DNI/RUC y Nombre.');
        showCustomerSearchResults();
        document.getElementById('cust-search-input')?.focus();
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
          selectCustomerFromSearch(newCust.id);
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
  let paidAmount = total;
  let changeAmount = 0;
  let cortesiaReason = '';

  if (selectedPaymentMethod === 'Cortesia') {
    cortesiaReason = (document.getElementById('cortesia-reason')?.value || '').trim() || 'Atención de Cortesía';
    paidAmount = 0;
    changeAmount = 0;
  } else {
    paidAmount = parseFloat(document.getElementById('input-paid-amount').value) || total;
    if (selectedPaymentMethod === 'Efectivo' && paidAmount < total) {
      playBeep('error');
      alert(`⚠️ El monto recibido (S/ ${paidAmount.toFixed(2)}) no puede ser menor al total a pagar (S/ ${total.toFixed(2)}).`);
      document.getElementById('input-paid-amount')?.focus();
      return;
    }
    changeAmount = paidAmount > total ? paidAmount - total : 0;
  }

  const mixedCash = selectedPaymentMethod === 'Pago Mixto' ? (parseFloat(document.getElementById('mixed-cash-input')?.value) || 0) : 0;
  const mixedOther = selectedPaymentMethod === 'Pago Mixto' ? Math.max(0, total - mixedCash) : 0;

  // Confirmación previa al cobro
  const confirmMsg = selectedPaymentMethod === 'Cortesia'
    ? `🎁 ¿Confirmar entrega en CORTESÍA?\n\n- Valor referencial: S/ ${total.toFixed(2)} (Cobro al cliente: S/ 0.00)\n- Motivo: ${cortesiaReason}\n- Se descontará el stock de inventario sin registrar dinero en caja.`
    : `¿Confirmar cobro por S/ ${total.toFixed(2)}?\n\n- Comprobante: ${selectedDocType}\n- Método: ${selectedPaymentMethod}${selectedPaymentMethod === 'Pago Mixto' ? ` (S/ ${mixedCash.toFixed(2)} Efec. + S/ ${mixedOther.toFixed(2)} Yape/Tarj)` : ''}\n- Cliente: ${customerName}`;
  if (!confirm(confirmMsg)) return;

  const payload = {
    doc_type: selectedDocType,
    customer_id: customerId ? parseInt(customerId) : null,
    customer_name: customerName,
    payment_method: selectedPaymentMethod,
    paid_amount: paidAmount,
    change_amount: changeAmount,
    mixed_cash: mixedCash,
    mixed_other: mixedOther,
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

    // Extraer documento del cliente si aplica
    let custDoc = '';
    if (selectedDocType === 'Boleta') {
      custDoc = (document.getElementById('boleta-dni')?.value || '').trim();
    } else if (selectedDocType === 'Factura') {
      custDoc = (document.getElementById('factura-ruc')?.value || '').trim();
    }
    if (!custDoc && customerObj && customerObj.doc) {
      custDoc = customerObj.doc;
    }

    renderTicketModal({
      docType: selectedDocType,
      receiptCode: data.receipt_code,
      customerName: customerName,
      customerDoc: custDoc,
      date: new Date(),
      sellerName: data.sellerName || (currentUser ? currentUser.name : ''),
      paymentMethod: selectedPaymentMethod,
      items: CART.map(i => ({
        product_name: i.product.name,
        quantity: i.quantity,
        unit_price: i.product.price,
        total_price: i.quantity * i.product.price
      })),
      total,
      paidAmount,
      changeAmount
    });

    closePaymentModal();

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

function renderTicketModal({
  docType = 'Ticket',
  receiptCode = 'T001-000000',
  customerName = 'Público General',
  customerDoc = '',
  date = new Date(),
  sellerName = '',
  paymentMethod = 'Efectivo',
  items = [],
  total = 0,
  paidAmount = 0,
  changeAmount = 0
}) {
  applyCompanySettingsToTicket();

  document.getElementById('rec-title').innerText = docType === 'Ticket' ? 'TICKET DE VENTA' : docType.toUpperCase() + ' ELECTRÓNICA';
  document.getElementById('rec-id').innerText = receiptCode;
  document.getElementById('rec-customer').innerText = 'Cliente: ' + (customerName || 'Público General');

  const docEl = document.getElementById('rec-customer-doc');
  if (docEl) {
    if (customerDoc && customerDoc !== '-') {
      docEl.classList.remove('hidden');
      docEl.innerText = (docType === 'Factura' ? 'RUC: ' : 'DNI/RUC: ') + customerDoc;
    } else {
      docEl.classList.add('hidden');
    }
  }

  const sellerEl = document.getElementById('rec-seller');
  if (sellerEl) {
    sellerEl.innerText = sellerName ? `Cajero: ${sellerName}` : (currentUser ? `Cajero: ${currentUser.name}` : '');
  }

  document.getElementById('rec-date').innerText = new Date(date).toLocaleString();

  // Desglose fiscal para Boletas y Facturas
  const taxBox = document.getElementById('rec-tax-breakdown');
  const totalLabel = document.getElementById('rec-total-label');
  const subtotal = total / 1.18;
  const tax = total - subtotal;

  if (docType === 'Boleta' || docType === 'Factura') {
    if (taxBox) taxBox.classList.remove('hidden');
    const subtotalEl = document.getElementById('rec-subtotal');
    const taxEl = document.getElementById('rec-tax');
    if (subtotalEl) subtotalEl.innerText = `S/ ${subtotal.toFixed(2)}`;
    if (taxEl) taxEl.innerText = `S/ ${tax.toFixed(2)}`;
    if (totalLabel) totalLabel.innerText = 'TOTAL A PAGAR:';
  } else {
    if (taxBox) taxBox.classList.add('hidden');
    if (totalLabel) totalLabel.innerText = 'TOTAL:';
  }

  document.getElementById('rec-total').innerText = paymentMethod === 'Cortesia' ? `S/ ${total.toFixed(2)} (CORTESÍA)` : `S/ ${total.toFixed(2)}`;
  document.getElementById('rec-method').innerText = paymentMethod === 'Cortesia' ? '🎁 Cortesía / Degustación' : paymentMethod;
  if (paymentMethod === 'Fiado') {
    document.getElementById('rec-paid').innerText = 'S/ 0.00 (FIADO)';
  } else if (paymentMethod === 'Cortesia') {
    document.getElementById('rec-paid').innerText = 'S/ 0.00 (CORTESÍA)';
    document.getElementById('rec-title').innerText = 'COMPROBANTE DE CORTESÍA';
  } else {
    document.getElementById('rec-paid').innerText = `S/ ${paidAmount.toFixed(2)}`;
  }
  document.getElementById('rec-change').innerText = `S/ ${changeAmount.toFixed(2)}`;

  // TABLA DETALLADA DE ÍTEMS VENDIDOS (CANT | DESCRIPCIÓN | P.UNIT | TOTAL)
  const itemsContainer = document.getElementById('rec-items');
  if (itemsContainer) {
    if (!items || items.length === 0) {
      itemsContainer.innerHTML = '<p class="text-center text-slate-400 py-2 text-[10px]">Sin productos registrados</p>';
    } else {
      itemsContainer.innerHTML = `
        <table class="w-full text-left text-[11px] leading-tight mb-1">
          <thead>
            <tr class="border-b border-slate-300 pb-1 text-[10px] font-black text-slate-700">
              <th class="py-1 w-8 text-center">CANT</th>
              <th class="py-1">DESCRIPCION</th>
              <th class="py-1 text-right w-12">P.U</th>
              <th class="py-1 text-right w-14">TOTAL</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-dotted divide-slate-200">
            ${items.map(i => {
        const qty = i.quantity || 1;
        const unit = Number(i.unit_price != null ? i.unit_price : (i.price != null ? i.price : (i.total_price ? i.total_price / qty : 0)));
        const rowTotal = Number(i.total_price != null ? i.total_price : (unit * qty));
        const name = i.product_name || i.name || 'Producto';
        return `
                <tr>
                  <td class="py-1 text-center font-bold align-top text-slate-800">${qty}</td>
                  <td class="py-1 pr-1 align-top break-words text-slate-700 font-medium">${name}</td>
                  <td class="py-1 text-right align-top text-slate-600">${unit.toFixed(2)}</td>
                  <td class="py-1 text-right font-bold align-top text-slate-900">${rowTotal.toFixed(2)}</td>
                </tr>
              `;
      }).join('')}
          </tbody>
        </table>
      `;
    }
  }

  document.getElementById('modal-receipt').classList.remove('hidden');
}

async function reprintTicket(saleId) {
  try {
    const res = await fetch(`/api/sales/${saleId}`, { headers: getAuthHeaders() });
    const sale = await res.json();
    if (!res.ok) throw new Error(sale.error || 'Error al obtener comprobante');

    renderTicketModal({
      docType: sale.doc_type,
      receiptCode: sale.receipt_code,
      customerName: sale.customer_name,
      customerDoc: sale.customer_doc,
      date: sale.created_at,
      sellerName: sale.user_name,
      paymentMethod: sale.payment_method,
      items: sale.items || [],
      total: sale.total,
      paidAmount: sale.paid_amount || sale.total,
      changeAmount: sale.change_amount || 0
    });
  } catch (err) {
    playBeep('error');
    alert('❌ Error al reimprimir ticket: ' + err.message);
  }
}

function reprintAbonoTicket(abonoId) {
  const abono = currentReportAbonos.find(a => a.id === abonoId);
  if (!abono) return;

  applyCompanySettingsToTicket();

  document.getElementById('rec-title').innerText = 'COMPROBANTE DE ABONO DE DEUDA';
  document.getElementById('rec-id').innerText = `AB-${String(abono.id).padStart(5, '0')}`;
  document.getElementById('rec-customer').innerText = 'Cliente: ' + (abono.customer_name || 'Cliente Registrado');

  const docEl = document.getElementById('rec-customer-doc');
  if (docEl) {
    if (abono.customer_doc && abono.customer_doc !== '-') {
      docEl.classList.remove('hidden');
      docEl.innerText = 'DNI/RUC: ' + abono.customer_doc;
    } else {
      docEl.classList.add('hidden');
    }
  }

  const sellerEl = document.getElementById('rec-seller');
  if (sellerEl) sellerEl.innerText = `Cajero: ${abono.user_name || 'Sistema'}`;

  document.getElementById('rec-date').innerText = new Date(abono.created_at).toLocaleString();

  const taxBox = document.getElementById('rec-tax-breakdown');
  if (taxBox) taxBox.classList.add('hidden');

  const totalLabel = document.getElementById('rec-total-label');
  if (totalLabel) totalLabel.innerText = 'TOTAL ABONADO:';

  document.getElementById('rec-total').innerText = `S/ ${abono.amount.toFixed(2)}`;
  document.getElementById('rec-method').innerText = 'Abono en Efectivo';
  document.getElementById('rec-paid').innerText = `S/ ${abono.amount.toFixed(2)}`;
  document.getElementById('rec-change').innerText = 'S/ 0.00';

  document.getElementById('rec-items').innerHTML = `
    <div class="flex justify-between items-start font-bold">
      <span>${abono.details || 'Abono a cuenta corriente (Fiado)'}</span>
      <span>S/ ${abono.amount.toFixed(2)}</span>
    </div>
  `;

  document.getElementById('modal-receipt').classList.remove('hidden');
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
  const catFilter = document.getElementById('inventory-category-filter')?.value || 'all';
  const tbody = document.getElementById('inventory-table-body');
  const isAdmin = currentUser && currentUser.role === 'Admin';

  const filtered = PRODUCTS.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query);
    const isLow = p.stock <= (p.min_stock || 5);
    const matchStock = inventoryFilterStock === 'all' || (inventoryFilterStock === 'low' && isLow);
    const matchCat = catFilter === 'all' || p.category === catFilter;
    return matchQuery && matchStock && matchCat;
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
        ${isAdmin ? `<td class="p-4 text-slate-500 font-mono">S/ ${(p.purchase_price || 0).toFixed(2)}</td>` : ''}
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
  const movement_type = document.getElementById('stock-intake-movement-type')?.value || 'INGRESO';

  try {
    const res = await fetch(`/api/products/${prodId}/stock`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ quantity, doc_type, doc_number, supplier_notes, new_purchase_price, new_price, movement_type })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error registrando movimiento de stock');

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

function openKardexModal() {
  document.getElementById('modal-kardex').classList.remove('hidden');
  loadKardexMovements();
}

function closeKardexModal() {
  document.getElementById('modal-kardex').classList.add('hidden');
}

async function loadKardexMovements() {
  const typeFilter = document.getElementById('kardex-type-filter')?.value || 'Todos';
  const tbody = document.getElementById('kardex-table-body');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400 font-bold">Cargando kardex...</td></tr>`;

  try {
    const res = await fetch(`/api/inventory/movements?type=${encodeURIComponent(typeFilter)}`, { headers: getAuthHeaders() });
    const records = await res.json();

    if (!res.ok) throw new Error(records.error || 'Error consultando kardex');

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Sin movimientos registrados para el filtro seleccionado.</td></tr>`;
      return;
    }

    const typeBadgeMap = {
      'VENTA': '<span class="bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold text-[10px]">🛒 VENTA (-)</span>',
      'INGRESO': '<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-[10px]">🟢 INGRESO (+)</span>',
      'INGRESO_INICIAL': '<span class="bg-teal-100 text-teal-800 px-2 py-0.5 rounded font-bold text-[10px]">📦 INIC. (+)</span>',
      'DEVOLUCION_VENTA': '<span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold text-[10px]">↩️ DEVOLUCIÓN (+)</span>',
      'MERMA': '<span class="bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold text-[10px]">🔴 MERMA (-)</span>',
      'CORTESIA': '<span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold text-[10px]">🔵 CORTESÍA (-)</span>',
      'SALIDA_INTERNA': '<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold text-[10px]">🟠 SALIDA INTERNA (-)</span>'
    };

    tbody.innerHTML = records.map(r => {
      const isDecrease = ['VENTA', 'MERMA', 'CORTESIA', 'SALIDA_INTERNA'].includes(r.type);
      return `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-slate-400 text-xs font-mono">${new Date(r.created_at).toLocaleString()}</td>
        <td class="p-3">${typeBadgeMap[r.type] || `<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-bold text-[10px]">${r.type}</span>`}</td>
        <td class="p-3 font-bold text-slate-800">${r.product_name}</td>
        <td class="p-3 text-center font-black ${isDecrease ? 'text-rose-600' : 'text-emerald-600'}">${isDecrease ? '-' : '+'}${r.quantity} unds</td>
        <td class="p-3 text-slate-600 font-medium">${r.doc_type} ${r.doc_number ? '<span class="font-mono text-xs font-bold text-slate-700">#' + r.doc_number + '</span>' : ''}</td>
        <td class="p-3 text-slate-700 font-bold"><i class="fa-solid fa-user-tag text-blue-500 mr-1"></i>${r.user_name}</td>
        <td class="p-3 text-slate-500 text-xs">${r.supplier_notes || '-'}</td>
      </tr>
    `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-500 font-bold">Error cargando kardex: ${err.message}</td></tr>`;
  }
}

// ==========================================
// MÓDULO MAESTRO DE CATEGORÍAS INDEPENDIENTES
// ==========================================
let CATEGORIES = [];

async function loadCategories() {
  try {
    const res = await fetch('/api/categories', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const cats = await res.json();
    CATEGORIES = Array.isArray(cats) ? cats : [];

    // 1. Actualizar badge con el total de categorías en el botón de Inventario
    const badge = document.getElementById('badge-categories-count');
    if (badge) badge.innerText = CATEGORIES.length;

    // 2. Actualizar selector de filtro de categorías en Inventario
    const invCatFilter = document.getElementById('inventory-category-filter');
    if (invCatFilter) {
      const curFilter = invCatFilter.value;
      invCatFilter.innerHTML = '<option value="all">📁 Todas las Categorías</option>' +
        CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
      if (curFilter && (curFilter === 'all' || CATEGORIES.some(c => c.name === curFilter))) {
        invCatFilter.value = curFilter;
      }
    }

    // 3. Actualizar selector en modal de creación/edición de producto
    const select = document.getElementById('prod-category');
    if (select) {
      const currentVal = select.value;
      if (CATEGORIES.length === 0) {
        select.innerHTML = '<option value="Abarrotes">Abarrotes</option>';
      } else {
        select.innerHTML = CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
      }
      if (currentVal && CATEGORIES.some(c => c.name === currentVal)) {
        select.value = currentVal;
      }
    }

    // 4. Actualizar barra de categorías en Punto de Venta (POS)
    renderCategoryFilters();

    // 5. Si el modal de administración está abierto, actualizar su lista
    const modalManage = document.getElementById('modal-manage-categories');
    if (modalManage && !modalManage.classList.contains('hidden')) {
      renderCategoriesList();
    }
  } catch (err) {
    console.error('Error cargando categorías:', err);
  }
}

function openManageCategoriesModal() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede gestionar el catálogo de categorías.');
    return;
  }
  const input = document.getElementById('new-category-input');
  if (input) input.value = '';
  renderCategoriesList();
  document.getElementById('modal-manage-categories')?.classList.remove('hidden');
  setTimeout(() => input?.focus(), 100);
}

function closeManageCategoriesModal() {
  document.getElementById('modal-manage-categories')?.classList.add('hidden');
}

function renderCategoriesList() {
  const container = document.getElementById('categories-manage-list');
  if (!container) return;

  if (!CATEGORIES || CATEGORIES.length === 0) {
    container.innerHTML = '<p class="text-center text-slate-400 py-6 text-xs font-semibold"><i class="fa-solid fa-tags text-2xl mb-2 text-slate-300 block"></i>No hay categorías registradas aún.</p>';
    return;
  }

  container.innerHTML = CATEGORIES.map(c => {
    const prodCount = PRODUCTS ? PRODUCTS.filter(p => p.category === c.name).length : 0;
    return `
      <div class="flex items-center justify-between p-3 bg-slate-50 hover:bg-indigo-50/50 rounded-2xl border border-slate-200 hover:border-indigo-200 transition-all shadow-xs">
        <div class="flex items-center gap-3">
          <span class="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-700 flex items-center justify-center font-bold text-xs shadow-inner">
            <i class="fa-solid fa-tag text-[11px]"></i>
          </span>
          <div>
            <p class="font-extrabold text-slate-800 text-xs">${c.name}</p>
            <p class="text-[10px] font-semibold text-slate-500 flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full ${prodCount > 0 ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
              ${prodCount} producto(s) en este rubro
            </p>
          </div>
        </div>
        <button type="button" onclick="deleteCategory(${c.id}, '${c.name.replace(/'/g, "\\'")}', ${prodCount})"
          class="w-8 h-8 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 flex items-center justify-center transition-all active:scale-95"
          title="Eliminar categoría">
          <i class="fa-solid fa-trash text-xs"></i>
        </button>
      </div>
    `;
  }).join('');
}

async function quickAddCategory(name) {
  if (!name) return;
  const existing = CATEGORIES.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    playBeep('error');
    alert(`ℹ️ La categoría "${name}" ya existe en el catálogo.`);
    return;
  }

  try {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar categoría');

    playBeep('success');
    await loadCategories();
    renderCategoriesList();

    const select = document.getElementById('prod-category');
    if (select) select.value = name;
  } catch (err) {
    playBeep('error');
    alert('⚠️ ' + err.message);
  }
}

async function handleCreateCategory(e) {
  e.preventDefault();
  const input = document.getElementById('new-category-input');
  const name = (input?.value || '').trim();
  if (!name) return;

  try {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar categoría');

    playBeep('success');
    input.value = '';
    await loadCategories();
    renderCategoriesList();

    // Seleccionar automáticamente en el formulario de producto
    const select = document.getElementById('prod-category');
    if (select) select.value = name;
  } catch (err) {
    playBeep('error');
    alert('⚠️ ' + err.message);
  }
}

async function deleteCategory(id, name, prodCount) {
  if (prodCount > 0) {
    alert(`⚠️ No se puede eliminar la categoría "${name}" porque tiene ${prodCount} producto(s) asignado(s). Modifica o reasigna los productos primero.`);
    return;
  }

  if (!confirm(`¿Eliminar la categoría "${name}"?`)) return;

  try {
    const res = await fetch(`/api/categories/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar categoría');

    playBeep('success');
    await loadCategories();
    renderCategoriesList();
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

// ==========================================
// PLANTILLAS DE PRODUCTOS RÁPIDOS Y AUTOCOMPLETADO
// ==========================================
const PRODUCT_PRESETS = [
  { code: '7750123001', name: 'Arroz Superior Costeño 1kg', category: 'Abarrotes', purchase_price: 3.80, price: 4.50, stock: 24, min_stock: 6 },
  { code: '7750123002', name: 'Aceite Vegetal Primor 1L', category: 'Abarrotes', purchase_price: 7.20, price: 8.90, stock: 20, min_stock: 5 },
  { code: '7750123003', name: 'Azúcar Rubia Cartavio 1kg', category: 'Abarrotes', purchase_price: 3.20, price: 4.00, stock: 30, min_stock: 8 },
  { code: '7750123004', name: 'Leche Evaporada Gloria Azul 400g', category: 'Lácteos', purchase_price: 3.60, price: 4.50, stock: 48, min_stock: 12 },
  { code: '7750123005', name: 'Gaseosa Coca Cola 500ml', category: 'Bebidas', purchase_price: 2.20, price: 3.00, stock: 36, min_stock: 10 },
  { code: '7750123006', name: 'Gaseosa Inca Kola 500ml', category: 'Bebidas', purchase_price: 2.20, price: 3.00, stock: 36, min_stock: 10 },
  { code: '7750123007', name: 'Gaseosa Coca Cola 1.5L', category: 'Bebidas', purchase_price: 5.50, price: 7.50, stock: 18, min_stock: 4 },
  { code: '7750123008', name: 'Gaseosa Inca Kola 1.5L', category: 'Bebidas', purchase_price: 5.50, price: 7.50, stock: 18, min_stock: 4 },
  { code: '7750123009', name: 'Agua San Mateo sin Gas 600ml', category: 'Bebidas', purchase_price: 1.20, price: 2.00, stock: 30, min_stock: 6 },
  { code: '7750123010', name: 'Atún Trozos en Aceite Fanny 170g', category: 'Abarrotes', purchase_price: 4.10, price: 5.50, stock: 24, min_stock: 6 },
  { code: '7750123011', name: 'Fideos Spaguetti Don Vittorio 500g', category: 'Abarrotes', purchase_price: 2.30, price: 3.20, stock: 30, min_stock: 6 },
  { code: '7750123012', name: 'Huevos Pardos Granja (1kg)', category: 'Abarrotes', purchase_price: 7.50, price: 9.50, stock: 15, min_stock: 3 },
  { code: '7750123013', name: 'Pan Francés Bolsa (10 unds)', category: 'Panadería', purchase_price: 2.00, price: 3.00, stock: 20, min_stock: 5 },
  { code: '7750123014', name: 'Detergente Bolívar Floral 800g', category: 'Limpieza', purchase_price: 6.80, price: 8.50, stock: 15, min_stock: 4 },
  { code: '7750123015', name: 'Jabón Bolívar Blanco 210g', category: 'Limpieza', purchase_price: 2.80, price: 3.80, stock: 24, min_stock: 6 },
  { code: '7750123016', name: 'Lejía Clorox Tradicional 930ml', category: 'Limpieza', purchase_price: 3.20, price: 4.50, stock: 20, min_stock: 5 },
  { code: '7750123017', name: 'Lavavajillas Ayudín Limón 450g', category: 'Limpieza', purchase_price: 4.20, price: 5.60, stock: 18, min_stock: 4 },
  { code: '7750123018', name: 'Papel Higiénico Suave Doble Hoja 4un', category: 'Limpieza', purchase_price: 4.80, price: 6.50, stock: 24, min_stock: 6 },
  { code: '7750123019', name: 'Galletas Soda Field Paquete 6un', category: 'Snacks', purchase_price: 2.80, price: 3.80, stock: 30, min_stock: 6 },
  { code: '7750123020', name: 'Chocolate Sublime Extragrande 40g', category: 'Snacks', purchase_price: 1.80, price: 2.50, stock: 40, min_stock: 10 },
  { code: '7750123021', name: 'Papas Lays Clásicas 160g', category: 'Snacks', purchase_price: 4.80, price: 6.50, stock: 15, min_stock: 4 },
  { code: '7750123022', name: 'Yogur Gloria Fresa 1L', category: 'Lácteos', purchase_price: 5.60, price: 7.20, stock: 16, min_stock: 4 },
  { code: '7750123023', name: 'Café Nescafé Tradicional 100g', category: 'Abarrotes', purchase_price: 9.80, price: 12.80, stock: 15, min_stock: 4 },
  { code: '7750123024', name: 'Cerveza Cusqueña Dorada 330ml', category: 'Bebidas', purchase_price: 4.20, price: 6.00, stock: 24, min_stock: 6 },
  { code: '7750123025', name: 'Cerveza Pilsen Callao 330ml', category: 'Bebidas', purchase_price: 3.80, price: 5.50, stock: 24, min_stock: 6 },
  { code: '7750123026', name: 'Crema Dental Kolynos 75ml', category: 'Cuidado Personal', purchase_price: 3.20, price: 4.50, stock: 20, min_stock: 5 },
  { code: '7750123027', name: 'Shampoo Head & Shoulders 375ml', category: 'Cuidado Personal', purchase_price: 14.50, price: 18.90, stock: 12, min_stock: 3 },
  { code: '7750123028', name: 'Pack Familiar: 2 Gaseosas 1.5L + Snack', category: 'Promociones/Combos', purchase_price: 13.50, price: 18.50, stock: 10, min_stock: 2 }
];

let currentPresetCategory = 'Todos';

function renderProductPresets(query = '') {
  const container = document.getElementById('product-presets-list');
  if (!container) return;

  const q = query.toLowerCase().trim();
  const filtered = PRODUCT_PRESETS.filter(p => {
    const matchCat = currentPresetCategory === 'Todos' || p.category === currentPresetCategory;
    const matchText = !q || p.name.toLowerCase().includes(q) || p.code.includes(q) || p.category.toLowerCase().includes(q);
    return matchCat && matchText;
  });

  const badge = document.getElementById('preset-count-badge');
  if (badge) badge.innerText = `${filtered.length} plantillas`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-slate-400">
        <i class="fa-solid fa-magnifying-glass text-2xl mb-1 text-slate-300"></i>
        <p class="text-xs font-semibold">No se encontraron plantillas coincidentes.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const isAlreadyRegistered = PRODUCTS && PRODUCTS.some(prod => prod.code === p.code);
    return `
      <div onclick='autofillProductForm(${JSON.stringify(p)})' class="group p-2.5 bg-white hover:bg-blue-50/70 border border-slate-200 hover:border-blue-400 rounded-xl cursor-pointer transition-all shadow-sm hover:shadow flex items-center justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-black text-slate-800 group-hover:text-blue-700 truncate leading-tight">${p.name}</span>
            <span class="text-[9px] bg-slate-100 group-hover:bg-blue-100 text-slate-600 group-hover:text-blue-800 px-1.5 py-0.5 rounded font-bold">${p.category}</span>
            ${isAlreadyRegistered ? '<span class="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded">En catálogo</span>' : ''}
          </div>
          <div class="flex items-center gap-3 mt-1 text-[10px] text-slate-500 font-mono">
            <span><i class="fa-solid fa-barcode text-slate-400 mr-0.5"></i>${p.code}</span>
            <span>Costo: <strong class="text-slate-700 font-sans">S/ ${p.purchase_price.toFixed(2)}</strong></span>
            <span>Venta: <strong class="text-emerald-700 font-sans font-bold">S/ ${p.price.toFixed(2)}</strong></span>
          </div>
        </div>
        <button type="button" class="shrink-0 bg-blue-50 group-hover:bg-blue-600 text-blue-600 group-hover:text-white w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-colors" title="Usar esta plantilla">
          <i class="fa-solid fa-arrow-left"></i>
        </button>
      </div>
    `;
  }).join('');
}

function filterProductPresets() {
  const q = document.getElementById('preset-search-input')?.value || '';
  renderProductPresets(q);
}

function setPresetCategoryFilter(cat) {
  currentPresetCategory = cat;
  document.querySelectorAll('.preset-chip').forEach(btn => {
    if (btn.innerText.trim() === cat) {
      btn.className = 'preset-chip bg-blue-600 text-white font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors';
    } else {
      btn.className = 'preset-chip bg-white hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors';
    }
  });
  filterProductPresets();
}

function autofillProductForm(preset) {
  if (!preset) return;

  // Si el código ya existe en los productos de la tienda, sugerir un SKU único basado en el código
  let finalCode = preset.code;
  if (PRODUCTS && PRODUCTS.some(p => p.code === finalCode)) {
    finalCode = generateUniqueSKU(preset.code);
  }

  document.getElementById('prod-code').value = finalCode;
  const catSelect = document.getElementById('prod-category');
  if (catSelect) {
    if (![...catSelect.options].some(o => o.value === preset.category)) {
      catSelect.add(new Option(preset.category, preset.category));
    }
    catSelect.value = preset.category;
  }
  document.getElementById('prod-stock').value = preset.stock || 10;
  document.getElementById('prod-purchase').value = (preset.purchase_price || 0).toFixed(2);
  document.getElementById('prod-price').value = (preset.price || 0).toFixed(2);
  document.getElementById('prod-min-stock').value = preset.min_stock || 5;

  // Notificación visual de autocompletado
  const alertEl = document.getElementById('autofill-alert');
  const alertText = document.getElementById('autofill-alert-text');
  if (alertEl && alertText) {
    alertText.innerHTML = `Plantilla aplicada: <strong>${preset.name}</strong>`;
    alertEl.classList.remove('hidden');
    clearTimeout(window._autofillAlertTimer);
    window._autofillAlertTimer = setTimeout(() => {
      alertEl.classList.add('hidden');
    }, 3500);
  }

  // Enfocar en precio de venta para revisión
  const priceInput = document.getElementById('prod-price');
  if (priceInput) {
    priceInput.focus();
    priceInput.select();
  }
}

function generateRandomSKU() {
  const randomNum = Math.floor(1000000 + Math.random() * 9000000);
  const sku = `775${randomNum}`;
  document.getElementById('prod-code').value = sku;
}

function generateUniqueSKU(baseCode = '') {
  let candidate = `${baseCode || '77501'}-${String(Math.floor(100 + Math.random() * 900))}`;
  let attempts = 0;
  while (PRODUCTS && PRODUCTS.some(p => p.code === candidate) && attempts < 20) {
    candidate = `${baseCode || '77501'}-${String(Math.floor(100 + Math.random() * 900))}`;
    attempts++;
  }
  return candidate;
}

function openProductModal() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede registrar o modificar productos.');
    return;
  }
  loadCategories();
  document.getElementById('form-product').reset();
  const alertEl = document.getElementById('autofill-alert');
  if (alertEl) alertEl.classList.add('hidden');
  const presetSearch = document.getElementById('preset-search-input');
  if (presetSearch) presetSearch.value = '';
  currentPresetCategory = 'Todos';
  document.querySelectorAll('.preset-chip').forEach(btn => {
    btn.className = btn.innerText.trim() === 'Todos' ? 'preset-chip bg-blue-600 text-white font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors' : 'preset-chip bg-white hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors';
  });
  renderProductPresets();
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

function setFiadoFilter(filter) {
  fiadoFilter = filter;
  document.querySelectorAll('.fiado-filter-btn').forEach(b => {
    b.classList.remove('bg-amber-600', 'text-white');
    b.classList.add('bg-slate-200', 'text-slate-700');
  });
  const activeBtn = document.getElementById('fiado-filter-' + filter);
  if (activeBtn) {
    activeBtn.classList.remove('bg-slate-200', 'text-slate-700');
    activeBtn.classList.add('bg-amber-600', 'text-white');
  }
  renderFiadosTable();
}

function renderFiadosTable() {
  const query = (document.getElementById('fiado-search-input')?.value || '').toLowerCase().trim();
  const tbody = document.getElementById('fiados-table-body');
  if (!tbody) return;

  const debtCount = CLIENTS.filter(c => (c.debt || 0) >= 0.01).length;
  const badge = document.getElementById('fiado-debt-count');
  if (badge) badge.innerText = debtCount;

  const filtered = CLIENTS.filter(c => {
    const matchQuery = c.name.toLowerCase().includes(query) || c.doc.toLowerCase().includes(query);
    const hasDebt = (c.debt || 0) >= 0.01;
    const matchDebt = fiadoFilter === 'all' || (fiadoFilter === 'debt' && hasDebt);
    return matchQuery && matchDebt;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">No se encontraron clientes ${fiadoFilter === 'debt' ? 'con saldos pendientes de pago' : 'registrados'}.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr class="hover:bg-slate-50">
      <td class="p-4 font-mono text-xs text-slate-500">${c.doc}</td>
      <td class="p-4 font-bold text-slate-800">${c.name}</td>
      <td class="p-4 text-slate-500">${c.phone || '-'}</td>
      <td class="p-4 text-right font-black ${(c.debt || 0) >= 0.01 ? 'text-amber-600' : 'text-slate-400'}">S/ ${(c.debt || 0).toFixed(2)}</td>
      <td class="p-4 text-center">
        <button onclick="openFiadoModal(${c.id})" class="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors">
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
    const newCust = await res.json();
    if (!res.ok) throw new Error(newCust.error || 'Error al registrar cliente');

    closeCustomerModal();
    await loadCustomers();
    if (newCust.id) {
      selectCustomerFromSearch(newCust.id);
    }
    playBeep('success');
    alert('✅ Cliente registrado con éxito y añadido a la cartera.');
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

function setFullAbonoAmount() {
  if (!currentActiveCustomerForFiado) return;
  document.getElementById('input-abono-amount').value = (currentActiveCustomerForFiado.debt || 0).toFixed(2);
}

async function openFiadoModal(customerId) {
  currentActiveCustomerForFiado = CLIENTS.find(c => c.id === customerId);
  if (!currentActiveCustomerForFiado) return;

  const isAdmin = currentUser && currentUser.role === 'Admin';
  document.getElementById('fiado-modal-client-info').innerText = `Cliente: ${currentActiveCustomerForFiado.name} (DNI/RUC: ${currentActiveCustomerForFiado.doc})`;
  document.getElementById('fiado-modal-balance').innerText = `S/ ${currentActiveCustomerForFiado.debt.toFixed(2)}`;
  document.getElementById('input-abono-amount').value = '';

  try {
    const res = await fetch(`/api/fiados/${customerId}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Error al consultar historial de fiados');
    }
    const records = await res.json();

    const historyTbody = document.getElementById('fiado-modal-history');
    if (!Array.isArray(records) || records.length === 0) {
      historyTbody.innerHTML = `<tr><td colspan="${isAdmin ? 6 : 5}" class="p-4 text-center text-slate-400">Sin historial de fiados ni abonos.</td></tr>`;
    } else {
      historyTbody.innerHTML = records.map(r => {
        const isAbono = r.type === 'ABONO';
        const isAnulado = r.details && r.details.includes('[ANULADO]');
        return `
        <tr class="hover:bg-slate-50 ${isAnulado ? 'bg-slate-100/50 opacity-60' : ''}">
          <td class="p-3 text-slate-400 text-[11px]">${new Date(r.created_at).toLocaleString()}</td>
          <td class="p-3">
            <span class="${isAbono ? 'bg-emerald-100 text-emerald-800' : (r.type === 'ANULACION_ABONO' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')} px-2 py-0.5 rounded font-bold text-[10px]">
              ${r.type}
            </span>
          </td>
          <td class="p-3 text-slate-700">${r.details || '-'} (${r.payment_method || 'Efectivo'})</td>
          <td class="p-3 text-right font-bold ${isAbono ? 'text-emerald-600' : (r.type === 'ANULACION_ABONO' ? 'text-rose-600' : 'text-slate-800')}">S/ ${r.amount.toFixed(2)}</td>
          <td class="p-3 text-right font-black text-slate-900">S/ ${r.balance_after.toFixed(2)}</td>
          ${isAdmin ? `
          <td class="p-3 text-center">
            ${isAbono && !isAnulado ? `
              <button onclick="anularAbono(${r.id}, ${customerId})" class="bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-2 py-1 rounded text-[10px] transition-colors" title="Anular este abono">
                <i class="fa-solid fa-trash mr-1"></i>Anular
              </button>
            ` : (isAnulado ? '<span class="text-[10px] font-bold text-slate-400">Anulado</span>' : '-')}
          </td>
          ` : ''}
        </tr>
      `;
      }).join('');
    }

    document.getElementById('modal-fiado-detail').classList.remove('hidden');
  } catch (err) {
    console.error('Error cargando historial de fiados:', err);
    alert('❌ Error cargando historial de fiados: ' + (err.message || ''));
  }
}

function closeFiadoModal() {
  document.getElementById('modal-fiado-detail').classList.add('hidden');
  focusSearchInput();
}

async function anularAbono(paymentId, customerId) {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede anular abonos.');
    return;
  }

  if (!confirm('⚠️ ¿Está seguro de anular este abono? Se restaurará la deuda del cliente y se ajustará el dinero en la caja del turno.')) {
    return;
  }

  try {
    const res = await fetch(`/api/fiados/abono/${paymentId}/anular`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error anulando abono');

    playBeep('success');
    alert('✅ ' + data.message);
    await loadCustomers();
    await loadCurrentCashRegister();
    await openFiadoModal(customerId);
  } catch (err) {
    playBeep('error');
    alert('❌ ' + err.message);
  }
}

async function processAbono() {
  if (!currentActiveCustomerForFiado) return;
  const amount = parseFloat(document.getElementById('input-abono-amount').value);
  const payment_method = document.getElementById('select-abono-method')?.value || 'Efectivo';

  if (!amount || amount <= 0) {
    alert('⚠️ Ingrese un monto de abono válido.');
    return;
  }

  if (amount > currentActiveCustomerForFiado.debt) {
    if (!confirm(`⚠️ El monto a abonar (S/ ${amount.toFixed(2)}) supera la deuda total actual (S/ ${currentActiveCustomerForFiado.debt.toFixed(2)}). ¿Desea continuar de todos modos?`)) {
      return;
    }
  }

  try {
    const res = await fetch('/api/fiados/abono', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ customer_id: currentActiveCustomerForFiado.id, amount, payment_method })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error registrando abono');

    playBeep('success');
    closeFiadoModal();
    await loadCustomers();
    await loadCurrentCashRegister();

    // Renderizar Recibo Térmico de Abono
    document.getElementById('rec-title').innerText = 'COMPROBANTE DE ABONO DE DEUDA';
    document.getElementById('rec-id').innerText = data.receipt_code || `AB-${String(Date.now()).slice(-6)}`;
    document.getElementById('rec-customer').innerText = 'Cliente: ' + (data.customer_name || currentActiveCustomerForFiado.name);
    document.getElementById('rec-date').innerText = new Date().toLocaleString();
    document.getElementById('rec-total').innerText = `S/ ${amount.toFixed(2)}`;
    document.getElementById('rec-method').innerText = `Abono en ${payment_method}`;
    document.getElementById('rec-paid').innerText = `S/ ${amount.toFixed(2)}`;
    document.getElementById('rec-change').innerText = `S/ ${(data.newDebt || 0).toFixed(2)}`;

    document.getElementById('rec-items').innerHTML = `
      <div class="flex justify-between items-start font-bold">
        <span>ABONO DE DEUDA (${payment_method})</span>
        <span>S/ ${amount.toFixed(2)}</span>
      </div>
      <div class="flex justify-between items-start text-slate-500 text-[10px]">
        <span>Saldo Pendiente Actual:</span>
        <span>S/ ${(data.newDebt || 0).toFixed(2)}</span>
      </div>
    `;

    document.getElementById('modal-receipt').classList.remove('hidden');
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

  const query = (document.getElementById('rep-search-input')?.value || '').toLowerCase().trim();
  const rowsToRender = query
    ? combined.filter(item =>
        (item.code && item.code.toLowerCase().includes(query)) ||
        (item.customer && item.customer.toLowerCase().includes(query)) ||
        (item.user && item.user.toLowerCase().includes(query)) ||
        (item.docType && item.docType.toLowerCase().includes(query)) ||
        (item.paymentMethod && item.paymentMethod.toLowerCase().includes(query))
      )
    : combined;

  if (rowsToRender.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-400 font-semibold">No hay ventas ni abonos coincidentes.</td></tr>`;
    return;
  }

  tbody.innerHTML = rowsToRender.map(item => `
    <tr class="hover:bg-slate-50 ${item.status === 'anulada' ? 'bg-slate-100/50 opacity-70' : (item.isAbono ? 'bg-emerald-50/40' : '')}">
      <td class="p-4 font-bold ${item.isAbono ? 'text-emerald-700 font-mono' : 'text-slate-800'}">${item.code}</td>
      <td class="p-4 text-slate-500 text-xs">${item.date.toLocaleString()}</td>
      <td class="p-4 text-slate-800 text-xs font-semibold">${item.customer}</td>
      <td class="p-4 text-slate-700 text-xs font-bold"><i class="fa-solid fa-user-tag text-blue-500 mr-1"></i>${item.user}</td>
      <td class="p-4"><span class="${item.isAbono ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'} px-2 py-1 rounded text-[10px] font-bold uppercase">${item.docType}</span></td>
      <td class="p-4"><span class="${item.isAbono ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : (item.paymentMethod === 'Fiado' ? 'bg-amber-100 text-amber-800' : (item.paymentMethod === 'Cortesia' ? 'bg-pink-100 text-pink-800 border border-pink-300' : 'bg-blue-100 text-blue-800'))} px-2 py-1 rounded text-[10px] font-bold uppercase">${item.paymentMethod}</span></td>
      <td class="p-4 text-right font-black ${item.isAbono ? 'text-emerald-600' : 'text-slate-900'}">S/ ${item.amount.toFixed(2)}</td>
      ${isAdmin ? `<td class="p-4 text-right font-bold text-emerald-600">${item.isAbono ? '-' : 'S/ ' + item.profit.toFixed(2)}</td>` : ''}
      <td class="p-4 text-center space-x-1 whitespace-nowrap">
        ${item.isAbono ? `
          <button onclick="reprintAbonoTicket(${item.id})" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold px-2.5 py-1.5 rounded-lg text-xs transition-colors shadow-sm" title="Reimprimir Recibo de Abono">
            <i class="fa-solid fa-print mr-1"></i>Reimprimir
          </button>
        ` : (
      item.status === 'anulada'
        ? `
               <span class="bg-rose-100 text-rose-700 px-2 py-1 rounded text-[10px] font-bold mr-1">Anulada</span>
               <button onclick="reprintTicket(${item.id})" class="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-2 py-1.5 rounded-lg text-xs transition-colors" title="Reimprimir Copia de Venta Anulada">
                 <i class="fa-solid fa-print mr-1"></i>Copia
               </button>
              `
        : `
               <button onclick="reprintTicket(${item.id})" class="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-2.5 py-1.5 rounded-lg text-xs transition-colors shadow-sm" title="Reimprimir Comprobante de Venta">
                 <i class="fa-solid fa-print mr-1"></i>Reimprimir
               </button>
               ${isAdmin ? `
                 <button onclick="openEditSaleModal(${item.id})" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg text-xs transition-colors" title="Editar datos de venta">
                   <i class="fa-solid fa-pen-to-square mr-1"></i>Editar
                 </button>
                 <button onclick="anularVenta(${item.id})" class="bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-2.5 py-1.5 rounded-lg text-xs transition-colors" title="Anular venta">
                   <i class="fa-solid fa-trash mr-1"></i>Anular
                 </button>
               ` : ''}
              `
    )}
      </td>
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
// ==========================================
// 5. GESTIÓN DE USUARIOS Y ROLES (ADMIN ONLY)
// ==========================================
function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;

  tbody.innerHTML = users.map(u => {
    return `
      <tr class="hover:bg-slate-50">
        <td class="p-3 sm:p-4 font-mono font-bold text-slate-800">${u.username}</td>
        <td class="p-3 sm:p-4 text-slate-700 font-medium">${u.name}</td>
        <td class="p-3 sm:p-4"><span class="${u.role === 'Admin' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'} px-2.5 py-1 rounded-lg text-xs font-bold">${u.role}</span></td>
        <td class="p-3 sm:p-4 text-center"><span class="text-emerald-600 bg-emerald-100 px-2.5 py-1 rounded-lg text-xs font-bold">Activo</span></td>
        <td class="p-3 sm:p-4 text-center space-x-2">
          <button onclick="openPasswordModal(${u.id}, '${u.username}')" class="text-blue-600 hover:text-blue-800 font-bold text-xs bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl border border-blue-200 shadow-sm transition-colors">
            <i class="fa-solid fa-key mr-1"></i>Modificar Clave
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleInputPasswordVisibility(inputId, iconId) {
  const inputEl = document.getElementById(inputId);
  const iconEl = document.getElementById(iconId);
  if (!inputEl || !iconEl) return;

  if (inputEl.type === 'password') {
    inputEl.type = 'text';
    iconEl.className = 'fa-solid fa-eye-slash text-xs text-blue-600';
  } else {
    inputEl.type = 'password';
    iconEl.className = 'fa-solid fa-eye text-xs text-slate-400';
  }
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
    await loadUsers();
    playBeep('success');
    alert('✅ Contraseña actualizada correctamente.');
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

// ==========================================
// 6. DATOS DE LA EMPRESA & BRANDING DE TICKETS
// ==========================================
async function loadCompanySettings() {
  try {
    const res = await fetch('/api/settings/company');
    if (res.ok) {
      COMPANY_SETTINGS = await res.json();
      applyCompanySettingsToUI();
    }
  } catch (e) {
    console.warn('No se pudo cargar la configuración de la empresa:', e);
  }
}

function applyCompanySettingsToUI() {
  applyCompanySettingsToTicket();
  applyCompanySettingsToCierreZ();
  populateCompanySettingsView();
}

function applyCompanySettingsToTicket() {
  if (!COMPANY_SETTINGS) return;
  const nameEl = document.getElementById('rec-company-name');
  if (nameEl) nameEl.innerText = COMPANY_SETTINGS.name || 'VALEVENTAS';
  const rucEl = document.getElementById('rec-company-ruc');
  if (rucEl) rucEl.innerText = 'RUC: ' + (COMPANY_SETTINGS.ruc || '20123456789');
  const addrEl = document.getElementById('rec-company-address');
  if (addrEl) addrEl.innerText = COMPANY_SETTINGS.address || '';
  const phoneEl = document.getElementById('rec-company-phone');
  if (phoneEl) phoneEl.innerText = COMPANY_SETTINGS.phone ? `Telf: ${COMPANY_SETTINGS.phone}` : '';
  const footerEl = document.getElementById('rec-footer-text');
  if (footerEl) {
    const text = COMPANY_SETTINGS.ticket_footer !== undefined ? COMPANY_SETTINGS.ticket_footer.trim() : '¡Gracias por su preferencia! Vuelva pronto.';
    footerEl.innerText = text;
    footerEl.style.display = text ? 'block' : 'none';
  }
}

function applyCompanySettingsToCierreZ() {
  if (!COMPANY_SETTINGS) return;
  const nameEl = document.getElementById('z-company-name');
  if (nameEl) nameEl.innerText = COMPANY_SETTINGS.name || 'VALEVENTAS';
  const addrEl = document.getElementById('z-company-address');
  if (addrEl) addrEl.innerText = COMPANY_SETTINGS.address || '';
  const rucEl = document.getElementById('z-company-ruc');
  if (rucEl) rucEl.innerText = 'RUC: ' + (COMPANY_SETTINGS.ruc || '20123456789');
}

function openCompanySettingsModal() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede modificar los datos del negocio.');
    return;
  }
  document.getElementById('setting-company-name').value = COMPANY_SETTINGS?.name || '';
  document.getElementById('setting-company-ruc').value = COMPANY_SETTINGS?.ruc || '';
  document.getElementById('setting-company-address').value = COMPANY_SETTINGS?.address || '';
  document.getElementById('setting-company-phone').value = COMPANY_SETTINGS?.phone || '';
  document.getElementById('setting-company-footer').value = COMPANY_SETTINGS?.ticket_footer || '';
  document.getElementById('modal-company-settings').classList.remove('hidden');
}

function closeCompanySettingsModal() {
  document.getElementById('modal-company-settings').classList.add('hidden');
  focusSearchInput();
}

async function saveCompanySettings(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Permiso denegado.');
    return;
  }

  const payload = {
    name: document.getElementById('setting-company-name').value.trim(),
    ruc: document.getElementById('setting-company-ruc').value.trim(),
    address: document.getElementById('setting-company-address').value.trim(),
    phone: document.getElementById('setting-company-phone').value.trim(),
    ticket_footer: document.getElementById('setting-company-footer').value.trim()
  };

  try {
    const res = await fetch('/api/settings/company', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error guardando datos');

    COMPANY_SETTINGS = data.settings;
    applyCompanySettingsToUI();
    closeCompanySettingsModal();
    playBeep('success');
    alert('✅ Datos del negocio y tickets guardados correctamente.');
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

function populateCompanySettingsView() {
  if (!COMPANY_SETTINGS) return;
  const nameInput = document.getElementById('setting-company-name-view');
  if (nameInput) nameInput.value = COMPANY_SETTINGS.name || '';
  const rucInput = document.getElementById('setting-company-ruc-view');
  if (rucInput) rucInput.value = COMPANY_SETTINGS.ruc || '';
  const addrInput = document.getElementById('setting-company-address-view');
  if (addrInput) addrInput.value = COMPANY_SETTINGS.address || '';
  const phoneInput = document.getElementById('setting-company-phone-view');
  if (phoneInput) phoneInput.value = COMPANY_SETTINGS.phone || '';
  const footerInput = document.getElementById('setting-company-footer-view');
  if (footerInput) footerInput.value = COMPANY_SETTINGS.ticket_footer || '';
  syncCompanyPreview();
}

function syncCompanyPreview() {
  const name = document.getElementById('setting-company-name-view')?.value.trim() || 'MI BODEGA';
  const ruc = document.getElementById('setting-company-ruc-view')?.value.trim() || '20123456789';
  const addr = document.getElementById('setting-company-address-view')?.value.trim() || 'Av. Principal 123';
  const phone = document.getElementById('setting-company-phone-view')?.value.trim() || '987654321';
  const footer = document.getElementById('setting-company-footer-view')?.value.trim() || '¡Gracias por su preferencia!';

  const pName = document.getElementById('prev-company-name');
  if (pName) pName.innerText = name;
  const pRuc = document.getElementById('prev-company-ruc');
  if (pRuc) pRuc.innerText = 'RUC: ' + ruc;
  const pAddr = document.getElementById('prev-company-address');
  if (pAddr) pAddr.innerText = addr;
  const pPhone = document.getElementById('prev-company-phone');
  if (pPhone) pPhone.innerText = phone ? `Telf: ${phone}` : '';
  const pFooter = document.getElementById('prev-company-footer');
  if (pFooter) pFooter.innerText = footer;
}

async function saveCompanySettingsFromView(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Permiso denegado. Solo administradores pueden modificar los datos del negocio.');
    return;
  }

  const payload = {
    name: document.getElementById('setting-company-name-view').value.trim(),
    ruc: document.getElementById('setting-company-ruc-view').value.trim(),
    address: document.getElementById('setting-company-address-view').value.trim(),
    phone: document.getElementById('setting-company-phone-view').value.trim(),
    ticket_footer: document.getElementById('setting-company-footer-view').value.trim()
  };

  try {
    const res = await fetch('/api/settings/company', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error guardando datos');

    COMPANY_SETTINGS = data.settings;
    applyCompanySettingsToUI();
    playBeep('success');
    alert('✅ Datos de la empresa y configuración de tickets actualizados correctamente.');
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

// ==========================================
// 7. COPIA DE SEGURIDAD (BACKUP) DE BASE DE DATOS EN 1 CLIC
// ==========================================
async function downloadBackup() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede descargar copias de seguridad.');
    return;
  }

  try {
    const res = await fetch('/api/backup/download', { headers: getAuthHeaders() });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Error al descargar copia de seguridad');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Extraer nombre del archivo si vino en cabeceras
    const disposition = res.headers.get('content-disposition');
    let filename = 'valeventas_backup.json';
    if (disposition && disposition.indexOf('filename=') !== -1) {
      const matches = /filename="([^"]+)"/.exec(disposition);
      if (matches && matches[1]) filename = matches[1];
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    playBeep('success');
    alert('✅ Copia de seguridad descargada exitosamente.');
  } catch (err) {
    playBeep('error');
    alert('❌ Error descargando backup: ' + err.message);
  }
}

// ==========================================
// CARGA MASIVA DE CATÁLOGO BASE PERUANO (EN 1 CLIC)
// ==========================================
async function confirmBulkCatalogLoad() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede realizar la carga inicial de catálogo.');
    return;
  }

  const existingCount = PRODUCTS ? PRODUCTS.length : 0;
  const msg = `📦 ¿Deseas cargar el Catálogo Base con ${PRODUCT_PRESETS.length} productos peruanos esenciales con stock inicial?\n\n- Categorías: Abarrotes, Bebidas, Lácteos, Limpieza, Snacks y Panadería.\n- Productos ya registrados en tu inventario (${existingCount}) no serán duplicados.\n- Podrás editar precios y stock en cualquier momento.`;

  if (!confirm(msg)) return;

  try {
    const res = await fetch('/api/products/bulk', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ products: PRODUCT_PRESETS })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar catálogo');

    playBeep('success');
    alert(data.message || '✅ Catálogo base cargado exitosamente.');
    await loadProducts();
  } catch (err) {
    playBeep('error');
    alert('❌ Error: ' + err.message);
  }
}

// ==========================================
// SUB-PESTAÑAS DE REPORTES: VENTAS VS TURNOS DE CAJA
// ==========================================
let currentShiftsHistory = [];

function switchReportSubTab(subTab) {
  const salesView = document.getElementById('rep-subview-sales');
  const shiftsView = document.getElementById('rep-subview-shifts');
  const btnSales = document.getElementById('btn-subtab-sales');
  const btnShifts = document.getElementById('btn-subtab-shifts');
  const btnExportExcel = document.getElementById('btn-export-sales-excel');
  const btnExportPdf = document.getElementById('btn-export-sales-pdf');

  if (subTab === 'sales') {
    salesView?.classList.remove('hidden');
    shiftsView?.classList.add('hidden');
    btnExportExcel?.classList.remove('hidden');
    btnExportPdf?.classList.remove('hidden');
    if (btnSales) btnSales.className = 'px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs shadow-sm flex items-center gap-2 transition-all';
    if (btnShifts) btnShifts.className = 'px-4 py-2 bg-white hover:bg-slate-100 text-slate-600 rounded-xl font-bold text-xs border border-slate-200 flex items-center gap-2 transition-all';
  } else {
    salesView?.classList.add('hidden');
    shiftsView?.classList.remove('hidden');
    btnExportExcel?.classList.add('hidden');
    btnExportPdf?.classList.add('hidden');
    if (btnShifts) btnShifts.className = 'px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs shadow-sm flex items-center gap-2 transition-all';
    if (btnSales) btnSales.className = 'px-4 py-2 bg-white hover:bg-slate-100 text-slate-600 rounded-xl font-bold text-xs border border-slate-200 flex items-center gap-2 transition-all';
    populateShiftUsersDropdown();
    loadShiftsHistory();
  }
}

async function populateShiftUsersDropdown() {
  const select = document.getElementById('shift-filter-user');
  if (!select) return;
  try {
    const res = await fetch('/api/users', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const users = await res.json();
    const currentVal = select.value;
    select.innerHTML = '<option value="Todos">Todos los Cajeros</option>' + users.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('');
    if (currentVal) select.value = currentVal;
  } catch (err) {
    console.error('Error cargando cajeros para filtro:', err);
  }
}

async function loadShiftsHistory() {
  const userId = document.getElementById('shift-filter-user')?.value || 'Todos';
  const startDate = document.getElementById('shift-start-date')?.value || '';
  const endDate = document.getElementById('shift-end-date')?.value || '';

  let url = `/api/cash-registers/history?userId=${encodeURIComponent(userId)}`;
  if (startDate) url += `&startDate=${startDate}`;
  if (endDate) url += `&endDate=${endDate}`;

  try {
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Error al obtener historial de turnos');
    const shifts = await res.json();
    currentShiftsHistory = Array.isArray(shifts) ? shifts : [];
    renderShiftsTable(currentShiftsHistory);
  } catch (err) {
    console.error('Error cargando turnos:', err);
    renderShiftsTable([]);
  }
}

function renderShiftsTable(shifts = []) {
  const tbody = document.getElementById('shifts-table-body');
  const countBadge = document.getElementById('shifts-count-badge');
  if (countBadge) countBadge.innerText = `${shifts.length} Turnos`;
  if (!tbody) return;

  if (shifts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="p-6 text-center text-slate-400 text-xs font-semibold">No se encontraron turnos con los filtros seleccionados.</td></tr>`;
    return;
  }

  tbody.innerHTML = shifts.map(s => {
    const openDate = s.opened_at ? new Date(s.opened_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '--';
    const closeDate = s.closed_at ? new Date(s.closed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Abierta actualmente';
    const initial = parseFloat(s.opening_amount) || 0;
    const cashSales = parseFloat(s.cash_sales) || 0;
    const expected = parseFloat(s.expected_cash) || 0;
    const actual = s.actual_cash !== null ? parseFloat(s.actual_cash) : null;
    const diff = s.difference !== null ? parseFloat(s.difference) : null;

    let diffBadge = '<span class="text-slate-400 text-xs">--</span>';
    if (diff !== null) {
      if (diff === 0) diffBadge = '<span class="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold text-[10px]">S/ 0.00 (Exacto)</span>';
      else if (diff > 0) diffBadge = `<span class="text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-bold text-[10px]">+ S/ ${diff.toFixed(2)} (Sobrante)</span>`;
      else diffBadge = `<span class="text-rose-700 bg-rose-50 px-2 py-0.5 rounded font-bold text-[10px]">- S/ ${Math.abs(diff).toFixed(2)} (Faltante)</span>`;
    }

    const statusBadge = s.status === 'abierta'
      ? '<span class="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse">Abierta</span>'
      : '<span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">Cerrada (Z)</span>';

    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="p-3 sm:p-4 font-mono font-bold text-slate-800">#${String(s.id).padStart(4, '0')}</td>
        <td class="p-3 sm:p-4 font-bold text-slate-700">${s.user_name || 'Cajero'}</td>
        <td class="p-3 sm:p-4 text-xs text-slate-500">${openDate}</td>
        <td class="p-3 sm:p-4 text-xs text-slate-500">${closeDate}</td>
        <td class="p-3 sm:p-4 text-right font-medium text-slate-600">S/ ${initial.toFixed(2)}</td>
        <td class="p-3 sm:p-4 text-right font-bold text-slate-800">S/ ${cashSales.toFixed(2)}</td>
        <td class="p-3 sm:p-4 text-right font-bold text-slate-700">S/ ${expected.toFixed(2)}</td>
        <td class="p-3 sm:p-4 text-right font-black ${actual !== null ? 'text-blue-700' : 'text-slate-400'}">${actual !== null ? `S/ ${actual.toFixed(2)}` : '--'}</td>
        <td class="p-3 sm:p-4 text-center">${diffBadge}</td>
        <td class="p-3 sm:p-4 text-center">${statusBadge}</td>
        <td class="p-3 sm:p-4 text-center">
          <button type="button" onclick='renderCierreZReceipt(${JSON.stringify(s)})' class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1" title="Ver comprobante de Arqueo Z">
            <i class="fa-solid fa-receipt text-amber-600"></i> Ver Z
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function exportShiftsToExcel() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede exportar reportes.');
    return;
  }

  if (!currentShiftsHistory || currentShiftsHistory.length === 0) {
    alert('⚠️ No hay turnos de caja registrados para exportar con los filtros actuales.');
    return;
  }

  if (!window.ExcelJS) {
    alert('⚠️ La librería de Excel aún no ha cargado. Por favor, refresque la página.');
    return;
  }

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VALEVENTAS POS';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Turnos y Arqueos Z', {
      views: [{ showGridLines: true }]
    });

    const companyName = COMPANY_SETTINGS?.name || 'VALEVENTAS';
    const companyRuc = COMPANY_SETTINGS?.ruc || '20123456789';
    const companyAddr = COMPANY_SETTINGS?.address || 'Av. Principal 123 - Lima, Perú';
    const companyPhone = COMPANY_SETTINGS?.phone || '987654321';

    // 1. Encabezado corporativo
    ws.mergeCells('B2:I2');
    const titleCell = ws.getCell('B2');
    titleCell.value = companyName.toUpperCase();
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1E293B' } };

    ws.mergeCells('B3:I3');
    const subCell = ws.getCell('B3');
    subCell.value = `RUC: ${companyRuc}  |  ${companyAddr}  |  Telf: ${companyPhone}`;
    subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF64748B' } };

    ws.mergeCells('B4:I4');
    const docTitle = ws.getCell('B4');
    docTitle.value = 'HISTORIAL DE TURNOS Y ARQUEOS DE CAJA (CORTE Z)';
    docTitle.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFD97706' } };

    ws.mergeCells('B5:I5');
    const metaCell = ws.getCell('B5');
    metaCell.value = `Generado: ${new Date().toLocaleString()} | Usuario: ${currentUser.name}`;
    metaCell.font = { name: 'Calibri', size: 9, color: { argb: 'FF94A3B8' } };

    // 2. Tarjetas KPI Resumen
    let totalCashSales = 0;
    let totalExpected = 0;
    let totalActual = 0;
    let totalDiff = 0;
    let closedCount = 0;

    currentShiftsHistory.forEach(s => {
      const cs = parseFloat(s.cash_sales) || 0;
      const ex = parseFloat(s.expected_cash) || 0;
      totalCashSales += cs;
      totalExpected += ex;
      if (s.status === 'cerrada' && s.actual_cash !== null) {
        closedCount++;
        totalActual += parseFloat(s.actual_cash) || 0;
        totalDiff += parseFloat(s.difference) || 0;
      }
    });

    const kpiData = [
      { label: 'TOTAL TURNOS', val: currentShiftsHistory.length, numFmt: '#,##0', colStart: 2, colEnd: 3, bg: 'FFE0F2FE', fontColor: 'FF0369A1' },
      { label: 'TURNOS CERRADOS', val: closedCount, numFmt: '#,##0', colStart: 4, colEnd: 5, bg: 'FFF1F5F9', fontColor: 'FF334155' },
      { label: 'TOTAL EFECTIVO VENTAS', val: totalCashSales, numFmt: '"S/ "#,##0.00', colStart: 6, colEnd: 7, bg: 'FFECFDF5', fontColor: 'FF047857' },
      { label: 'BALANCE DIFERENCIAS', val: totalDiff, numFmt: '"+"\"S/ \"#,##0.00;"-"\"S/ \"#,##0.00;"S/ 0.00"', colStart: 8, colEnd: 10, bg: totalDiff >= 0 ? 'FFEFF6FF' : 'FFFFF1F2', fontColor: totalDiff >= 0 ? 'FF1D4ED8' : 'FFE11D48' }
    ];

    ws.getRow(7).height = 16;
    ws.getRow(8).height = 24;

    kpiData.forEach(k => {
      const topCell = ws.getCell(7, k.colStart);
      const valCell = ws.getCell(8, k.colStart);
      ws.mergeCells(7, k.colStart, 7, k.colEnd);
      ws.mergeCells(8, k.colStart, 8, k.colEnd);

      topCell.value = k.label;
      topCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: k.fontColor } };
      topCell.alignment = { horizontal: 'center', vertical: 'middle' };
      topCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: k.bg } };

      valCell.value = k.val;
      valCell.numFmt = k.numFmt;
      valCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF0F172A' } };
      valCell.alignment = { horizontal: 'center', vertical: 'middle' };
      valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: k.bg } };

      for (let r = 7; r <= 8; r++) {
        for (let c = k.colStart; c <= k.colEnd; c++) {
          const borderStyle = { style: 'thin', color: { argb: 'FFCBD5E1' } };
          ws.getCell(r, c).border = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
        }
      }
    });

    // 3. Tabla de Turnos
    const startRow = 11;
    const headers = [
      'N° Turno',
      'Cajero',
      'Fecha Apertura',
      'Fecha Cierre',
      'Monto Inicial (S/)',
      'Ventas Efectivo (S/)',
      'Esperado Caja (S/)',
      'Real Declarado (S/)',
      'Diferencia (S/)',
      'Estado'
    ];

    const hRow = ws.getRow(startRow);
    hRow.height = 24;
    headers.forEach((h, idx) => {
      const cell = hRow.getCell(idx + 1);
      cell.value = h;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { top: { style: 'thin', color: { argb: 'FF000000' } }, bottom: { style: 'medium', color: { argb: 'FF000000' } } };
    });

    let currentRow = startRow + 1;
    currentShiftsHistory.forEach((s, idx) => {
      const row = ws.getRow(currentRow);
      row.height = 20;
      const isZebra = idx % 2 === 1;
      const rowBg = isZebra ? 'FFF8FAFC' : 'FFFFFFFF';

      const initial = parseFloat(s.opening_amount) || 0;
      const cashSales = parseFloat(s.cash_sales) || 0;
      const expected = parseFloat(s.expected_cash) || 0;
      const actual = s.actual_cash !== null ? parseFloat(s.actual_cash) : null;
      const diff = s.difference !== null ? parseFloat(s.difference) : null;

      const cells = [
        { val: `#${String(s.id).padStart(4, '0')}`, align: 'center', bold: true },
        { val: s.user_name || 'Cajero', align: 'left' },
        { val: s.opened_at ? new Date(s.opened_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '--', align: 'center' },
        { val: s.closed_at ? new Date(s.closed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Abierta', align: 'center' },
        { val: initial, align: 'right', numFmt: '"S/ "#,##0.00' },
        { val: cashSales, align: 'right', numFmt: '"S/ "#,##0.00', bold: true },
        { val: expected, align: 'right', numFmt: '"S/ "#,##0.00' },
        { val: actual !== null ? actual : '--', align: 'right', numFmt: actual !== null ? '"S/ "#,##0.00' : undefined, bold: true },
        { val: diff !== null ? diff : '--', align: 'right', numFmt: diff !== null ? '"+"\"S/ \"#,##0.00;"-"\"S/ \"#,##0.00;"S/ 0.00"' : undefined, bold: true, color: diff !== null ? (diff >= 0 ? 'FF047857' : 'FFE11D48') : undefined },
        { val: s.status === 'abierta' ? 'ABIERTA' : 'CERRADA', align: 'center', bold: true, color: s.status === 'abierta' ? 'FF047857' : 'FF64748B' }
      ];

      cells.forEach((c, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        cell.value = c.val;
        cell.alignment = { horizontal: c.align, vertical: 'middle' };
        cell.font = { name: 'Calibri', size: 9.5, bold: !!c.bold, color: c.color ? { argb: c.color } : { argb: 'FF1E293B' } };
        if (c.numFmt) cell.numFmt = c.numFmt;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      });

      currentRow++;
    });

    // Fila de totales
    const totRow = ws.getRow(currentRow);
    totRow.height = 22;
    totRow.getCell(1).value = 'TOTALES';
    totRow.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    totRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    totRow.getCell(6).value = totalCashSales;
    totRow.getCell(6).numFmt = '"S/ "#,##0.00';
    totRow.getCell(6).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    totRow.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };

    totRow.getCell(8).value = totalActual;
    totRow.getCell(8).numFmt = '"S/ "#,##0.00';
    totRow.getCell(8).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    totRow.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };

    totRow.getCell(9).value = totalDiff;
    totRow.getCell(9).numFmt = '"+"\"S/ \"#,##0.00;"-"\"S/ \"#,##0.00;"S/ 0.00"';
    totRow.getCell(9).font = { name: 'Calibri', size: 10, bold: true, color: { argb: totalDiff >= 0 ? 'FF047857' : 'FFE11D48' } };
    totRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };

    for (let c = 1; c <= 10; c++) {
      const cell = totRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = { top: { style: 'medium', color: { argb: 'FF94A3B8' } }, bottom: { style: 'double', color: { argb: 'FF64748B' } } };
    }

    // Auto-ajuste de columnas
    ws.columns.forEach((col, idx) => {
      let maxLen = 12;
      col.eachCell({ includeEmpty: false }, (cell, rowNum) => {
        if (rowNum >= startRow) {
          const valStr = cell.value ? String(cell.value) : '';
          if (valStr.length > maxLen) maxLen = Math.min(valStr.length + 3, 30);
        }
      });
      col.width = Math.max(maxLen, 12);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const filename = `Reporte_Turnos_${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    downloadBlob(blob, filename);

    playBeep('success');
  } catch (err) {
    console.error('Error generando Excel de turnos:', err);
    playBeep('error');
    alert('❌ Error generando archivo Excel: ' + err.message);
  }
}

async function exportShiftsToPDF() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert('⚠️ Solo el Administrador puede exportar reportes.');
    return;
  }

  if (!currentShiftsHistory || currentShiftsHistory.length === 0) {
    alert('⚠️ No hay turnos de caja registrados para exportar con los filtros actuales.');
    return;
  }

  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('⚠️ La librería de PDF aún no ha cargado. Por favor, refresque la página.');
    return;
  }

  try {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const companyName = COMPANY_SETTINGS?.name || 'VALEVENTAS';
    const companyRuc = COMPANY_SETTINGS?.ruc || '20123456789';
    const companyAddr = COMPANY_SETTINGS?.address || 'Av. Principal 123 - Lima, Perú';
    const companyPhone = COMPANY_SETTINGS?.phone || '987654321';

    // 1. Barra superior
    doc.setFillColor(217, 119, 6);
    doc.rect(0, 0, pageWidth, 8, 'F');

    // 2. Encabezado corporativo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(companyName, 40, 36);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`RUC: ${companyRuc}  |  ${companyAddr}  |  Telf: ${companyPhone}`, 40, 49);

    // Título derecho
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 41, 59);
    doc.text('REPORTE DE TURNOS Y ARQUEOS DE CAJA (CORTE Z)', pageWidth - 40, 34, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generado: ${new Date().toLocaleString()}  |  Usuario: ${currentUser.name}`, pageWidth - 40, 47, { align: 'right' });

    // 3. Tarjetas KPI
    let totalCashSales = 0;
    let totalActual = 0;
    let totalDiff = 0;
    let closedCount = 0;

    currentShiftsHistory.forEach(s => {
      totalCashSales += parseFloat(s.cash_sales) || 0;
      if (s.status === 'cerrada' && s.actual_cash !== null) {
        closedCount++;
        totalActual += parseFloat(s.actual_cash) || 0;
        totalDiff += parseFloat(s.difference) || 0;
      }
    });

    const kpiCards = [
      { label: 'TOTAL TURNOS', val: `${currentShiftsHistory.length}`, color: [3, 105, 161], bg: [224, 242, 254] },
      { label: 'TURNOS CERRADOS', val: `${closedCount}`, color: [51, 65, 85], bg: [241, 245, 249] },
      { label: 'VENTAS EN EFECTIVO', val: `S/ ${totalCashSales.toFixed(2)}`, color: [4, 120, 87], bg: [236, 253, 245] },
      { label: 'BALANCE DIFERENCIAS', val: `${totalDiff >= 0 ? '+' : ''}S/ ${totalDiff.toFixed(2)}`, color: totalDiff >= 0 ? [29, 78, 216] : [225, 29, 72], bg: totalDiff >= 0 ? [239, 246, 255] : [255, 241, 242] }
    ];

    const cardWidth = (pageWidth - 80 - 30) / 4;
    const cardY = 62;
    const cardH = 38;

    kpiCards.forEach((c, i) => {
      const x = 40 + i * (cardWidth + 10);
      doc.setFillColor(c.bg[0], c.bg[1], c.bg[2]);
      doc.roundedRect(x, cardY, cardWidth, cardH, 5, 5, 'F');
      doc.setDrawColor(c.color[0], c.color[1], c.color[2]);
      doc.setLineWidth(0.8);
      doc.roundedRect(x, cardY, cardWidth, cardH, 5, 5, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(c.color[0], c.color[1], c.color[2]);
      doc.text(c.label, x + cardWidth / 2, cardY + 13, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text(c.val, x + cardWidth / 2, cardY + 30, { align: 'center' });
    });

    // 4. Tabla con autoTable
    const tableHeaders = [
      ['N° Turno', 'Cajero', 'Apertura', 'Cierre', 'M. Inicial', 'Ventas Efec.', 'Esperado', 'Real Caja', 'Diferencia', 'Estado']
    ];

    const tableData = currentShiftsHistory.map(s => {
      const initial = parseFloat(s.opening_amount) || 0;
      const cashSales = parseFloat(s.cash_sales) || 0;
      const expected = parseFloat(s.expected_cash) || 0;
      const actual = s.actual_cash !== null ? parseFloat(s.actual_cash) : null;
      const diff = s.difference !== null ? parseFloat(s.difference) : null;

      let diffText = '--';
      if (diff !== null) {
        diffText = diff === 0 ? 'S/ 0.00 (OK)' : (diff > 0 ? `+ S/ ${diff.toFixed(2)}` : `- S/ ${Math.abs(diff).toFixed(2)}`);
      }

      return [
        `#${String(s.id).padStart(4, '0')}`,
        s.user_name || 'Cajero',
        s.opened_at ? new Date(s.opened_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '--',
        s.closed_at ? new Date(s.closed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Abierta',
        `S/ ${initial.toFixed(2)}`,
        `S/ ${cashSales.toFixed(2)}`,
        `S/ ${expected.toFixed(2)}`,
        actual !== null ? `S/ ${actual.toFixed(2)}` : '--',
        diffText,
        s.status.toUpperCase()
      ];
    });

    const tableFoot = [
      [
        'TOTALES',
        '',
        '',
        '',
        '',
        `S/ ${totalCashSales.toFixed(2)}`,
        '',
        `S/ ${totalActual.toFixed(2)}`,
        `${totalDiff >= 0 ? '+' : ''}S/ ${totalDiff.toFixed(2)}`,
        ''
      ]
    ];

    doc.autoTable({
      head: tableHeaders,
      body: tableData,
      foot: tableFoot,
      startY: 114,
      margin: { left: 40, right: 40, bottom: 35 },
      theme: 'striped',
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
        cellPadding: 4
      },
      bodyStyles: {
        fontSize: 7.5,
        cellPadding: 3.5,
        textColor: [51, 65, 85]
      },
      footStyles: {
        fillColor: [226, 232, 240],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 8.5,
        cellPadding: 4
      },
      columnStyles: {
        0: { halign: 'center', fontStyle: 'bold', cellWidth: 55 },
        1: { halign: 'left', cellWidth: 85 },
        2: { halign: 'center', cellWidth: 85 },
        3: { halign: 'center', cellWidth: 85 },
        4: { halign: 'right', cellWidth: 70 },
        5: { halign: 'right', fontStyle: 'bold', cellWidth: 75 },
        6: { halign: 'right', cellWidth: 75 },
        7: { halign: 'right', fontStyle: 'bold', textColor: [3, 105, 161], cellWidth: 75 },
        8: { halign: 'right', fontStyle: 'bold', cellWidth: 80 },
        9: { halign: 'center', fontStyle: 'bold', cellWidth: 60 }
      },
      didParseCell: function(data) {
        if (data.section === 'body' && data.column.index === 8) {
          const txt = String(data.cell.raw || '');
          if (txt.startsWith('-')) data.cell.styles.textColor = [225, 29, 72];
          else if (txt.startsWith('+') || txt.includes('(OK)')) data.cell.styles.textColor = [4, 120, 87];
        }
      },
      didDrawPage: function(data) {
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `VALEVENTAS POS | Soluciones de Punto de Venta & Facturación by VT VALETEC`,
          40,
          pageHeight - 15
        );
        doc.text(
          `Página ${doc.internal.getCurrentPageInfo().pageNumber} de ${pageCount}`,
          pageWidth - 40,
          pageHeight - 15,
          { align: 'right' }
        );
      }
    });

    const filename = `Reporte_Turnos_${companyName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
    playBeep('success');
  } catch (err) {
    console.error('Error generando PDF de turnos:', err);
    playBeep('error');
    alert('❌ Error generando PDF: ' + err.message);
  }
}

document.addEventListener('click', (e) => {
  const container = document.getElementById('cust-search-results');
  const searchInput = document.getElementById('cust-search-input');
  if (container && searchInput && !container.contains(e.target) && !searchInput.contains(e.target)) {
    container.classList.add('hidden');
  }
});

window.onload = init;
