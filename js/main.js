import { auth, db, doc, setDoc, getDoc, onSnapshot, updateDoc, serverTimestamp, onAuthStateChanged } from './firebase.js';
import { showNotification, fitTextToContainer } from './utils.js';
import { userSettings, updateLocalSettings, populateSettingsForm, registerSettingsHandlers } from './settings.js';
import { initCalculator } from './calculator.js';
import { initRappicargo } from './rappicargo.js';
import { registerAuthHandlers, handleLogout } from './auth.js';
import { registerNavigationEvents } from './navigation.js';

const { jsPDF } = window.jspdf;

let unsubscribeFromCodes = null;
let sessionData = { codes: [], history: [], settings: {} };
let currentSource = null;
let scrollInterval = null;
let scrollPauseTimeout = null;
let oldOrdersInterval = null;
let previousCodesCount = 0;

const loginView = document.getElementById('login-view');
const roleSelectionView = document.getElementById('role-selection-view');
const mainView = document.getElementById('main-view');

const operatorView = document.getElementById('operator-view');
const viewerView = document.getElementById('viewer-view');
const closeOrdersView = document.getElementById('closeorders-view');
const historyView = document.getElementById('history-view');
const settingsView = document.getElementById('settings-view');

function showView(viewToShow) {
  [loginView, roleSelectionView, mainView].forEach(v => v.classList.add('hidden'));
  viewToShow.classList.remove('hidden');
}

onAuthStateChanged(auth, user => {
  if (user) {
    const savedRole = localStorage.getItem('userRole');
    if (savedRole) {
      setupRoleView(savedRole);
    } else {
      document.getElementById('welcome-email').textContent = `Sesión iniciada como: ${user.email}`;
      showView(roleSelectionView);
    }
    listenForCodes(user.uid);
  } else {
    if (unsubscribeFromCodes) unsubscribeFromCodes();
    if (oldOrdersInterval) clearInterval(oldOrdersInterval);
    localStorage.removeItem('userRole');
    previousCodesCount = 0;
    document.documentElement.classList.remove('dark');
    showView(loginView);
  }
});

function setupRoleView(role) {
  localStorage.setItem('userRole', role);
  showView(mainView);
  operatorView.classList.toggle('hidden', role !== 'operator');
  viewerView.classList.toggle('hidden', role !== 'viewer');
  closeOrdersView.classList.toggle('hidden', role !== 'closeorders');
  historyView.classList.toggle('hidden', role !== 'history');
  settingsView.classList.toggle('hidden', role !== 'settings');

  if (role === 'settings') populateSettingsForm();

  if (role === 'viewer') {
    document.documentElement.classList.remove('dark');
    updateViewerAutoScroll();
  } else {
    if (scrollInterval) {
      clearInterval(scrollInterval);
      clearTimeout(scrollPauseTimeout);
      scrollInterval = null;
    }
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }

  if (role === 'closeorders') {
    renderCloseOrders(activeFilter);
  }
}

function listenForCodes(userId) {
  if (unsubscribeFromCodes) unsubscribeFromCodes();
  const sessionDocRef = doc(db, "sessions", userId);

  getDoc(sessionDocRef).then(docSnap => {
    if (!docSnap.exists()) {
      setDoc(sessionDocRef, { createdAt: serverTimestamp(), codes: [], history: [], settings: userSettings });
    }
  });

  unsubscribeFromCodes = onSnapshot(sessionDocRef, (docSnap) => {
    if (docSnap.exists()) {
      sessionData = docSnap.data();
      sessionData.codes = sessionData.codes || [];
      sessionData.history = sessionData.history || [];
      updateLocalSettings(sessionData.settings);

      const isNewCode = sessionData.codes.length > previousCodesCount;
      previousCodesCount = sessionData.codes.length;

      const operatorCodes = [...sessionData.codes].sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      const viewerCodes = [...sessionData.codes].sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      sessionData.history.sort((a, b) => (b.deletedAt?.seconds || 0) - (a.deletedAt?.seconds || 0));

      renderOperatorList(operatorCodes);
      renderViewerList(viewerCodes, isNewCode);
      filterAndRenderHistory();
      if (!closeOrdersView.classList.contains('hidden')) renderCloseOrders(activeFilter);
    }
  });
}

function isDuplicate(code, source) {
  if (!code || !source) return false;
  const normalized = String(code).trim();
  return (sessionData.codes || []).some(c => String(c.code).trim() === normalized && c.source === source);
}

function addCode(code, source, type = 'code', note = '') {
  const userId = auth.currentUser?.uid;
  if (!userId) return;

  const codeTrim = String(code).trim();
  if (!codeTrim || !source) {
    showNotification("Ingresa un código y selecciona un origen", "error");
    return;
  }

  if (isDuplicate(codeTrim, source)) {
    showNotification("Este pedido ya fue ingresado", "error");
    return;
  }

  // --- Optimistic UI Update ---
  // 1. Create the new object and update local state
  const newCode = { id: crypto.randomUUID(), code: codeTrim, source, note: note.trim(), timestamp: new Date(), type };
  sessionData.codes = [newCode, ...sessionData.codes];

  // 2. Re-render the UI immediately
  const operatorCodes = [...sessionData.codes].sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
  renderOperatorList(operatorCodes);
  // --- End Optimistic UI Update ---

  // 3. Persist change to Firestore in the background
  const sessionDocRef = doc(db, "sessions", userId);
  updateDoc(sessionDocRef, { codes: sessionData.codes }) // Use the already updated array
    .catch(err => {
      console.error("Failed to add code to Firestore:", err);
      showNotification("Error al guardar pedido.", "error");
      // Revert the optimistic update on failure
      sessionData.codes = sessionData.codes.filter(c => c.id !== newCode.id);
      const revertedOperatorCodes = [...sessionData.codes].sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      renderOperatorList(revertedOperatorCodes);
    });
}

function deleteCode(codeId) {
  const userId = auth.currentUser?.uid;
  if (!userId) return;

  const codeToMove = sessionData.codes.find(c => c.id === codeId);
  if (!codeToMove) return;

  // --- Optimistic UI Update ---
  // 1. Update local state immediately
  codeToMove.deletedAt = new Date();
  const newCodesArray = sessionData.codes.filter(c => c.id !== codeId);
  const newHistoryArray = [codeToMove, ...sessionData.history];

  sessionData.codes = newCodesArray;
  sessionData.history = newHistoryArray;

  // 2. Re-render the UI with the new local state
  const operatorCodes = [...sessionData.codes].sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
  renderOperatorList(operatorCodes);
  // Also re-render close orders view if it's active
  if (!closeOrdersView.classList.contains('hidden')) {
    renderCloseOrders(activeFilter);
  }
  // --- End Optimistic UI Update ---

  // 3. Persist change to Firestore in the background
  const sessionDocRef = doc(db, "sessions", userId);
  updateDoc(sessionDocRef, { codes: newCodesArray, history: newHistoryArray })
    .catch(err => {
      console.error("Failed to delete code from Firestore:", err);
      showNotification("Error al sincronizar borrado.", "error");
      // The UI will be out of sync, but onSnapshot will eventually correct it.
    });
}

function completeCode(codeId) {
  deleteCode(codeId);
  showNotification('Pedido marcado como FINALIZADO.');
}

function renderOperatorList(codes) {
  const listEl = document.getElementById('operator-code-list');
  listEl.innerHTML = '';
  if (oldOrdersInterval) clearInterval(oldOrdersInterval);

  if (codes.length === 0) {
    listEl.innerHTML = `<p class="text-gray-500 dark:text-gray-400 text-center mt-16">No hay pedidos activos.</p>`;
    return;
  }
  const now = Date.now();
  const alertTime = userSettings.blinkMinutes * 60 * 1000;
  const criticalTime = userSettings.criticalMinutes * 60 * 1000;

  codes.forEach(c => {
    const ts = c.timestamp?.toDate ? c.timestamp.toDate().getTime() : 0;
    const age = now - ts;
    const isCritical = ts && age > criticalTime;
    const isOld = ts && age > alertTime;
    const sourceStyles = {
      'PedidosYa': 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300',
      'Rappi': 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-300',
      'RappiCargo': 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-300',
      'MercadoPago': 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300'
    };
    const style = sourceStyles[c.source] || 'bg-gray-100';
    const blinkingClass = isCritical ? 'critical-border' : isOld ? 'blinking-border' : '';

    listEl.innerHTML += `
        <div class="flex items-center justify-between p-3 ${style} rounded-lg ${blinkingClass}">
          <div class="flex flex-col">
            <div class="flex items-baseline gap-2">
              <span class="font-mono text-2xl tracking-wider font-bold">${c.code}</span>
              ${isCritical ? '<span class="text-xs text-red-600 dark:text-red-300">Revisar si está cancelado</span>' : ''}
            </div>
            <span class="text-xs font-semibold">${c.source}</span>
            ${c.note ? `<span class="text-sm break-words mt-1">${c.note}</span>` : ''}
          </div>
          <button data-id="${c.id}" class="delete-btn ml-auto p-2 rounded-full hover:bg-red-200 dark:hover:bg-red-800/50" title="Mover a historial">
            <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>`;
  });

  oldOrdersInterval = setInterval(() => {
    renderOperatorList(sessionData.codes);
    const viewerCodes = [...sessionData.codes].sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    renderViewerList(viewerCodes, false);
  }, 60000);
}

function renderViewerList(codes, isNewCode) {
  const listEl = document.getElementById('viewer-code-list');
  listEl.innerHTML = '';
  if (codes.length === 0) {
    listEl.innerHTML = `<p class="viewer-no-codes text-gray-500 text-center mt-32 text-2xl col-span-full">Esperando pedidos...</p>`;
    updateViewerAutoScroll();
    return;
  }

  const sourceStyles = {
    'PedidosYa': 'bg-red-600 text-white',
    'Rappi': 'bg-sky-500 text-white',
    'RappiCargo': 'bg-sky-500 text-white',
    'MercadoPago': 'bg-yellow-400 text-black'
  };
  const sizeClasses = [
    'text-5xl md:text-6xl',
    'text-6xl md:text-7xl',
    'text-7xl md:text-8xl',
    'text-8xl md:text-9xl',
    'text-9xl md:text-[10rem]',
    'text-[10rem] md:text-[11rem]',
    'text-[11rem] md:text-[12rem]',
    'text-[12rem] md:text-[13rem]'
  ];

  codes.forEach((c, index) => {
    let sizeClass = sizeClasses[userSettings.viewerSize - 1] || sizeClasses[2];
    const displaySource = c.source === 'RappiCargo' ? 'Rappi' : c.source;
    const style = sourceStyles[c.source] || 'bg-gray-200';
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl shadow-lg p-4 flex flex-col items-center justify-center aspect-video';
    if (index === 0 && isNewCode) card.classList.add('new-order-pop');
    card.innerHTML = `
        <p class="viewer-order font-black text-gray-900 ${sizeClass} tracking-tighter px-2">${c.code}</p>
        <div class="mt-4 px-6 py-2 rounded-lg ${style}"><p class="font-bold text-xl">${displaySource}</p></div>`;
    listEl.appendChild(card);
    if (c.type === 'name') {
      const textEl = card.querySelector('.viewer-order');
      fitTextToContainer(textEl, card);
    }
  });

  const footerTextEl = document.getElementById('viewer-footer-text');
  footerTextEl.textContent = userSettings.viewerFooterText;
  const footerSizeClasses = [
    'text-xl py-3',
    'text-2xl py-4',
    'text-3xl py-5',
    'text-4xl py-6',
    'text-5xl py-7'
  ];
  footerTextEl.className = `text-center font-bold flex-shrink-0 bg-gray-100 dark:bg-gray-900 ${footerSizeClasses[userSettings.viewerFooterSize - 1] || footerSizeClasses[1]}`;

  updateViewerAutoScroll();
}

function updateViewerAutoScroll() {
  const listEl = document.getElementById('viewer-code-list');
  if (scrollInterval) clearInterval(scrollInterval);
  if (scrollPauseTimeout) clearTimeout(scrollPauseTimeout);
  scrollInterval = null;

  if (viewerView.classList.contains('hidden')) return;

  setTimeout(() => {
    const hasOverflow = listEl.scrollHeight > listEl.clientHeight;
    if (hasOverflow) {
      let direction = 1;
      let paused = true;
      const speeds = [80, 70, 60, 50, 40, 30, 20, 10];
      const scrollSpeedMs = speeds[userSettings.scrollSpeed - 1] || 50;
      const startScrollCycle = () => {
        scrollPauseTimeout = setTimeout(() => {
          paused = false;
          scrollInterval = setInterval(() => {
            if (paused) return;
            listEl.scrollBy(0, direction);
            const atBottom = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 1;
            const atTop = listEl.scrollTop <= 0;
            if ((direction === 1 && atBottom) || (direction === -1 && atTop)) {
              paused = true;
              direction *= -1;
              clearInterval(scrollInterval);
              startScrollCycle();
            }
          }, scrollSpeedMs);
        }, 3000);
      };
      startScrollCycle();
    }
  }, 500);
}

function renderHistoryList(history) {
  const tableBody = document.getElementById('history-table-body');
  tableBody.innerHTML = '';
  if (history.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-8">No hay historial de pedidos.</td></tr>`;
    return;
  }
  history.forEach(c => {
    const created = c.timestamp?.toDate ? c.timestamp.toDate() : null;
    const deleted = c.deletedAt?.toDate ? c.deletedAt.toDate() : null;
    let duration = 'N/A';
    if (created && deleted) {
      const diffMs = deleted - created;
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);
      duration = `${diffMins} min, ${diffSecs} seg`;
    }

    tableBody.innerHTML += `
        <tr class="bg-white border-b dark:bg-gray-800 dark:border-gray-700">
          <th scope="row" class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap dark:text-white">${c.code}</th>
          <td class="px-6 py-4">${c.source}</td>
          <td class="px-6 py-4">${c.note || ''}</td>
          <td class="px-6 py-4">${created ? created.toLocaleString() : 'N/A'}</td>
          <td class="px-6 py-4">${deleted ? deleted.toLocaleString() : 'N/A'}</td>
          <td class="px-6 py-4">${duration}</td>
        </tr>`;
  });
}

function filterAndRenderHistory() {
  const searchTerm = document.getElementById('history-search-input').value.toLowerCase();
  const filterValue = document.getElementById('history-filter-select').value;

  const filteredHistory = (sessionData.history || []).filter(item => {
    const codeMatch = String(item.code).toLowerCase().includes(searchTerm);
    const filterMatch = filterValue === 'all' || item.source === filterValue;
    return codeMatch && filterMatch;
  });
  renderHistoryList(filteredHistory);
}

const closeGroupsEl = document.getElementById('closeorders-groups');
let activeFilter = 'all';

function getSourceStyles(source) {
  const map = {
    'PedidosYa': { badge:'bg-red-600 text-white', border:'border-red-300', light:'bg-red-50 dark:bg-red-900/20' },
    'Rappi': { badge:'bg-orange-500 text-white', border:'border-orange-300', light:'bg-orange-50 dark:bg-orange-900/20' },
    'RappiCargo': { badge:'bg-sky-500 text-white', border:'border-sky-300', light:'bg-sky-50 dark:bg-sky-900/20' },
    'MercadoPago': { badge:'bg-green-500 text-white', border:'border-green-300', light:'bg-green-50 dark:bg-green-900/20' }
  };
  return map[source] || { badge:'bg-gray-500 text-white', border:'border-gray-300', light:'bg-gray-50 dark:bg-gray-800' };
}

function groupBySource(codes) {
  return (codes || []).reduce((acc, c) => {
    const key = c.source || 'Otros';
    (acc[key] = acc[key] || []).push(c);
    return acc;
  }, {});
}

function renderCloseOrders(filter='all') {
  if (!closeGroupsEl) return;
  const grouped = groupBySource(sessionData.codes || []);
  const order = ['PedidosYa','Rappi','RappiCargo','MercadoPago'];
  const keys = Object.keys(grouped).sort((a,b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  closeGroupsEl.innerHTML = '';
  let renderedAny = false;

  keys.forEach(source => {
    const items = grouped[source] || [];
    if (!items.length) return;
    if (filter !== 'all' && filter !== source) return;

    renderedAny = true;
    const st = getSourceStyles(source);
    const wrap = document.createElement('div');
    wrap.className = `rounded-xl border ${st.border} ${st.light} p-3 sm:p-4`;

    const sorted = items.slice().sort((a,b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
    const now = Date.now();
    const alertTime = userSettings.blinkMinutes * 60 * 1000;
    const criticalTime = userSettings.criticalMinutes * 60 * 1000;

    wrap.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="co-badge ${st.badge}">${source}</span>
            <span class="text-sm font-semibold opacity-80">${sorted.length} activo${sorted.length!==1?'s':''}</span>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${sorted.map(i => {
            const ts = (i.timestamp?.seconds || 0) * 1000;
            const age = now - ts;
            const isCritical = ts && age > criticalTime;
            const isOld = ts && age > alertTime;
            const blinkClass = isCritical ? 'critical-border' : isOld ? 'blinking-border' : '';
            return `
            <div class="co-card bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-4 flex items-center justify-between ${blinkClass}">
              <div class="min-w-0">
                <p class="font-black text-2xl tracking-tight truncate">${i.code}</p>
                <p class="text-xs text-gray-500">${i.type === 'name' ? 'Nombre' : 'Código'} • ${new Date(ts).toLocaleTimeString()}</p>
                ${i.note ? `<p class="text-sm break-words mt-1">${i.note}</p>` : ''}
              </div>
              <button class="finish-item bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm co-btn" data-id="${i.id}">
                Finalizar
              </button>
            </div>`;
          }).join('')}
        </div>
      `;
    closeGroupsEl.appendChild(wrap);
  });

  if (!renderedAny) {
    closeGroupsEl.innerHTML = `<p class="text-gray-500 text-center py-12">No hay pedidos activos.</p>`;
  }
}

document.querySelectorAll('.co-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.co-filter').forEach(b => b.classList.remove('tab-active'));
    btn.classList.add('tab-active');
    activeFilter = btn.dataset.filter || 'all';
    renderCloseOrders(activeFilter);
  });
});

if (closeGroupsEl) {
  closeGroupsEl.addEventListener('click', (e) => {
    const finishBtn = e.target.closest('.finish-item');
    if (finishBtn) {
      const id = finishBtn.dataset.id;
      if (id) completeCode(id);
    }
  });
}

function backToMenu() { localStorage.removeItem('userRole'); showView(roleSelectionView); }

document.querySelectorAll('.keypad-btn').forEach(btn => btn.addEventListener('click', () => {
  const display = document.getElementById('code-display');
  if (display.textContent.length < 4) display.textContent += btn.textContent;
}));
document.getElementById('clear-btn').addEventListener('click', () => document.getElementById('code-display').textContent = '');
document.getElementById('backspace-btn').addEventListener('click', () => {
  const display = document.getElementById('code-display');
  display.textContent = display.textContent.slice(0, -1);
});
document.querySelectorAll('.source-btn').forEach(btn => btn.addEventListener('click', () => {
  const source = btn.dataset.source;
  if (source === 'RappiCargo') {
    document.getElementById('rappicargo-overlay').classList.remove('hidden');
    document.getElementById('rappicargo-modal').classList.add('open');
  } else {
    document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSource = source;
  }
}));
const noteInputEl = document.getElementById('note-input');
document.getElementById('note-bags-btn').addEventListener('click', () => {
  if (noteInputEl) noteInputEl.value = 'Varias bolsas';
});
document.getElementById('note-cash-btn').addEventListener('click', () => {
  if (noteInputEl) noteInputEl.value = 'Efectivo';
});
document.getElementById('submit-code-btn').addEventListener('click', () => {
  const code = document.getElementById('code-display').textContent;
  const noteInput = document.getElementById('note-input');
  const note = noteInput ? noteInput.value : '';
  if (code && currentSource) {
    addCode(code, currentSource, 'code', note);
    document.getElementById('code-display').textContent = '';
    if (noteInput) noteInput.value = '';
    document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
    currentSource = null;
  } else { showNotification("Ingresa un código y selecciona un origen", "error"); }
});
document.getElementById('operator-code-list').addEventListener('click', e => {
  const deleteBtn = e.target.closest('.delete-btn');
  if (deleteBtn) deleteCode(deleteBtn.dataset.id);
});

document.getElementById('toggle-layout-btn').addEventListener('click', (e) => {
  const operatorGrid = document.getElementById('operator-grid');
  const keypadPanel = document.getElementById('operator-keypad-panel');
  const noteBagsBtn = document.getElementById('note-bags-btn');
  const noteCashBtn = document.getElementById('note-cash-btn');
  const toggleBtn = e.currentTarget;

  const isCompact = operatorGrid.classList.contains('lg:grid-cols-3');

  if (isCompact) {
    // Agrandar lista, achicar teclado
    operatorGrid.classList.replace('lg:grid-cols-3', 'lg:grid-cols-2');
    keypadPanel.classList.remove('lg:col-span-2');

    // Achicar botones de nota
    noteBagsBtn.classList.replace('text-lg', 'text-xs');
    noteBagsBtn.classList.replace('py-3', 'py-1');
    noteBagsBtn.classList.replace('px-4', 'px-2');
    noteCashBtn.classList.replace('text-lg', 'text-xs');
    noteCashBtn.classList.replace('py-3', 'py-1');
    noteCashBtn.classList.replace('px-4', 'px-2');

    toggleBtn.textContent = 'Compactar';
  } else {
    // Achicar lista, agrandar teclado
    operatorGrid.classList.replace('lg:grid-cols-2', 'lg:grid-cols-3');
    keypadPanel.classList.add('lg:col-span-2');

    // Agrandar botones de nota
    noteBagsBtn.classList.replace('text-xs', 'text-lg');
    noteBagsBtn.classList.replace('py-1', 'py-3');
    noteBagsBtn.classList.replace('px-2', 'px-4');
    noteCashBtn.classList.replace('text-xs', 'text-lg');
    noteCashBtn.classList.replace('py-1', 'py-3');
    noteCashBtn.classList.replace('px-2', 'px-4');

    toggleBtn.textContent = 'Expandir';
  }
});

document.getElementById('history-search-input').addEventListener('input', filterAndRenderHistory);
document.getElementById('history-filter-select').addEventListener('change', filterAndRenderHistory);
document.getElementById('export-pdf-btn').addEventListener('click', () => {
  const doc = new jsPDF();
  doc.autoTable({ html: '#history-table' });
  doc.save('historial-pedidos.pdf');
});
document.getElementById('delete-history-btn').addEventListener('click', async () => {
  const userId = auth.currentUser?.uid;
  if (!userId) return;
  if (confirm("¿Borrar todo el historial? Esta acción no se puede deshacer.")) {
    const sessionDocRef = doc(db, "sessions", userId);
    await updateDoc(sessionDocRef, { history: [] });
    showNotification("Historial borrado correctamente.");
  }
});
registerAuthHandlers();
registerNavigationEvents({ setupRoleView, backToMenu, handleLogout });
registerSettingsHandlers({ backToMenu });
initCalculator();
initRappicargo(addCode);

