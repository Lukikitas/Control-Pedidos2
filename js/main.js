import { auth, db, doc, setDoc, getDoc, onSnapshot, updateDoc, serverTimestamp, onAuthStateChanged, arrayUnion, arrayRemove, writeBatch } from './firebase.js';
import { showNotification, fitTextToContainer } from './utils.js';
import { userSettings, updateLocalSettings, populateSettingsForm, registerSettingsHandlers } from './settings.js';
import { initCalculator } from './calculator.js';
import { initRappicargo } from './rappicargo.js';
import { registerAuthHandlers, handleLogout } from './auth.js';
import { registerNavigationEvents } from './navigation.js';
import { initVoiceRecognition } from './voice.js';

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
  if (!userId) return Promise.reject(new Error("User not logged in."));

  const codeTrim = String(code).trim();
  if (!codeTrim || !source) {
    showNotification("Ingresa un código y selecciona un origen", "error");
    return Promise.reject(new Error("Code or source missing."));
  }

  if (isDuplicate(codeTrim, source)) {
    showNotification("Este pedido ya fue ingresado", "error");
    return Promise.reject(new Error("Duplicate code."));
  }

  const newCode = {
    id: crypto.randomUUID(),
    code: codeTrim,
    source,
    note: note.trim(),
    type,
    timestamp: new Date()
  };

  // --- Optimistic UI Update ---
  const originalCodes = [...sessionData.codes];
  sessionData.codes = [...sessionData.codes, newCode];

  const getMs = (timestamp) => (timestamp?.seconds ? timestamp.seconds * 1000 : timestamp?.getTime()) || 0;
  const sortAsc = (a, b) => getMs(a.timestamp) - getMs(b.timestamp);
  const sortDesc = (a, b) => getMs(b.timestamp) - getMs(a.timestamp);

  renderOperatorList([...sessionData.codes].sort(sortAsc));
  renderViewerList([...sessionData.codes].sort(sortDesc), true);
  if (!closeOrdersView.classList.contains('hidden')) {
    renderCloseOrders(activeFilter);
  }
  // --- End Optimistic UI Update ---

  const sessionDocRef = doc(db, "sessions", userId);
  return updateDoc(sessionDocRef, { codes: arrayUnion(newCode) })
    .catch(err => {
      console.error("Failed to add code to Firestore:", err);
      showNotification("Error al guardar pedido.", "error");

      sessionData.codes = originalCodes;

      renderOperatorList([...sessionData.codes].sort(sortAsc));
      renderViewerList([...sessionData.codes].sort(sortDesc), false);
      if (!closeOrdersView.classList.contains('hidden')) {
        renderCloseOrders(activeFilter);
      }
      // Re-throw the error to ensure the promise chain fails
      throw err;
    });
}

function deleteCode(codeId) {
  const userId = auth.currentUser?.uid;
  if (!userId) return;

  const codeToMove = sessionData.codes.find(c => c.id === codeId);
  if (!codeToMove) return;

  // Create the history item with a client-side timestamp.
  const historyItem = { ...codeToMove, deletedAt: new Date() };

  // --- Optimistic UI Update ---
  const originalCodes = [...sessionData.codes];
  const originalHistory = [...sessionData.history];

  sessionData.codes = sessionData.codes.filter(c => c.id !== codeId);
  // Use the same historyItem for the optimistic update.
  sessionData.history = [historyItem, ...sessionData.history];

  const operatorCodes = [...sessionData.codes].sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
  renderOperatorList(operatorCodes);
  if (!closeOrdersView.classList.contains('hidden')) {
    renderCloseOrders(activeFilter);
  }
  // --- End Optimistic UI Update ---

  // --- Persist change to Firestore using a batch write ---
  const sessionDocRef = doc(db, "sessions", userId);
  const batch = writeBatch(db);

  // Note: arrayRemove needs the *exact* object from the array.
  // codeToMove does not have `deletedAt`, which is correct.
  batch.update(sessionDocRef, { codes: arrayRemove(codeToMove) });
  // arrayUnion will add the new history item.
  batch.update(sessionDocRef, { history: arrayUnion(historyItem) });

  batch.commit().catch(err => {
    console.error("Failed to delete code with batch:", err);
    showNotification("Error al sincronizar borrado.", "error");
    // Revert UI to pre-update state. onSnapshot will eventually correct it anyway,
    // but this provides a faster feedback loop for the user.
    sessionData.codes = originalCodes;
    sessionData.history = originalHistory;
    renderOperatorList([...sessionData.codes].sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0)));
     if (!closeOrdersView.classList.contains('hidden')) {
        renderCloseOrders(activeFilter);
    }
  });
}

function completeCode(codeId) {
  deleteCode(codeId);
  showNotification('Pedido marcado como FINALIZADO.');
}

function renderOperatorList(codes) {
  const listEl = document.getElementById('operator-code-list');
  if (oldOrdersInterval) clearInterval(oldOrdersInterval);

  if (codes.length === 0) {
    listEl.innerHTML = `<p class="text-gray-500 dark:text-gray-400 text-center mt-16">No hay pedidos activos.</p>`;
    return;
  }

  const now = Date.now();
  const alertTime = userSettings.blinkMinutes * 60 * 1000;
  const criticalTime = userSettings.criticalMinutes * 60 * 1000;

  const getMs = (timestamp) => (timestamp?.seconds ? timestamp.seconds * 1000 : timestamp?.getTime()) || 0;

  const codesHtml = codes.map(c => {
    const ts = getMs(c.timestamp);
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

    return `
        <div class="flex items-center justify-between p-3 ${style} rounded-lg ${blinkingClass}">
          <div class="flex flex-col">
            <div class="flex items-baseline gap-2">
              <span class="font-mono text-2xl tracking-wider font-bold">${c.code}</span>
              ${isCritical ? `<span class="text-xs text-red-600 dark:text-red-300">Revisar si está cancelado</span>` : ''}
            </div>
            <span class="text-xs font-semibold">${c.source}</span>
            ${c.note ? `<span class="text-sm break-words mt-1">${c.note}</span>` : ''}
          </div>
          <button data-id="${c.id}" class="delete-btn ml-auto p-2 rounded-full hover:bg-red-200 dark:hover:bg-red-800/50" title="Mover a historial">
            <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>`;
  }).join('');

  listEl.innerHTML = codesHtml;

  oldOrdersInterval = setInterval(() => {
    const getMs = (timestamp) => (timestamp?.seconds ? timestamp.seconds * 1000 : timestamp?.getTime()) || 0;
    const operatorCodes = [...sessionData.codes].sort((a, b) => getMs(a.timestamp) - getMs(b.timestamp));
    const viewerCodes = [...sessionData.codes].sort((a, b) => getMs(b.timestamp) - getMs(a.timestamp));

    renderOperatorList(operatorCodes);
    renderViewerList(viewerCodes, false);
  }, 60000);
}

function renderViewerList(codes, isNewCode) {
  const listEl = document.getElementById('viewer-code-list');

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
    'text-5xl md:text-6xl', 'text-6xl md:text-7xl', 'text-7xl md:text-8xl',
    'text-8xl md:text-9xl', 'text-9xl md:text-[10rem]', 'text-[10rem] md:text-[11rem]',
    'text-[11rem] md:text-[12rem]', 'text-[12rem] md:text-[13rem]'
  ];

  const codesToFit = [];
  const codesHtml = codes.map((c, index) => {
    const sizeClass = sizeClasses[userSettings.viewerSize - 1] || sizeClasses[2];
    const displaySource = c.source === 'RappiCargo' ? 'Rappi' : c.source;
    const style = sourceStyles[c.source] || 'bg-gray-200';
    const popClass = (index === 0 && isNewCode) ? 'new-order-pop' : '';
    const fitId = c.type === 'name' ? `fit-text-${c.id}` : '';
    if (fitId) {
        codesToFit.push({ id: fitId, containerClass: 'bg-white' });
    }

    return `
      <div class="bg-white rounded-xl shadow-lg p-4 flex flex-col items-center justify-center aspect-video ${popClass}">
        <p id="${fitId}" class="viewer-order font-black text-gray-900 ${sizeClass} tracking-tighter px-2">${c.code}</p>
        <div class="mt-4 px-6 py-2 rounded-lg ${style}"><p class="font-bold text-xl">${displaySource}</p></div>
      </div>`;
  }).join('');

  listEl.innerHTML = codesHtml;

  codesToFit.forEach(item => {
      const textEl = document.getElementById(item.id);
      if (textEl) {
          fitTextToContainer(textEl, textEl.parentElement);
      }
  });

  const footerTextEl = document.getElementById('viewer-footer-text');
  footerTextEl.textContent = userSettings.viewerFooterText;
  const footerSizeClasses = [
    'text-xl py-3', 'text-2xl py-4', 'text-3xl py-5',
    'text-4xl py-6', 'text-5xl py-7'
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
  const sourceOrder = ['PedidosYa','Rappi','RappiCargo','MercadoPago'];

  const sortedKeys = Object.keys(grouped).sort((a,b) => {
    const ia = sourceOrder.indexOf(a), ib = sourceOrder.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const now = Date.now();
  const alertTime = userSettings.blinkMinutes * 60 * 1000;
  const criticalTime = userSettings.criticalMinutes * 60 * 1000;
  const getMs = (timestamp) => (timestamp?.seconds ? timestamp.seconds * 1000 : timestamp?.getTime()) || 0;

  const groupsHtml = sortedKeys.map(source => {
    const items = grouped[source] || [];
    if (!items.length || (filter !== 'all' && filter !== source)) {
      return '';
    }

    const st = getSourceStyles(source);
    const sortedItems = items.slice().sort((a,b) => getMs(a.timestamp) - getMs(b.timestamp));

    const itemsHtml = sortedItems.map(i => {
      const ts = getMs(i.timestamp);
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
    }).join('');

    return `
      <div class="rounded-xl border ${st.border} ${st.light} p-3 sm:p-4">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="co-badge ${st.badge}">${source}</span>
            <span class="text-sm font-semibold opacity-80">${sortedItems.length} activo${sortedItems.length!==1?'s':''}</span>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${itemsHtml}
        </div>
      </div>`;
  }).join('');

  if (!groupsHtml.trim()) {
    closeGroupsEl.innerHTML = `<p class="text-gray-500 text-center py-12">No hay pedidos activos.</p>`;
  } else {
    closeGroupsEl.innerHTML = groupsHtml;
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
    addCode(code, currentSource, 'code', note)
      .then(() => {
        // Clear form only on successful database write
        document.getElementById('code-display').textContent = '';
        if (noteInput) noteInput.value = '';
        document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
        currentSource = null;
      })
      .catch(err => {
        // Errors are already handled inside addCode (UI revert and notification)
        // We can log the error here again if needed for debugging the event listener chain
        console.log("Add code promise rejected, form will not be cleared.", err.message);
      });
  } else {
    showNotification("Ingresa un código y selecciona un origen", "error");
  }
});
document.getElementById('operator-code-list').addEventListener('click', e => {
  const deleteBtn = e.target.closest('.delete-btn');
  if (deleteBtn) deleteCode(deleteBtn.dataset.id);
});

document.getElementById('toggle-layout-btn').addEventListener('click', (e) => {
  const operatorGrid = document.getElementById('operator-grid');
  const listPanel = document.getElementById('operator-list-panel');
  const noteBagsBtn = document.getElementById('note-bags-btn');
  const noteCashBtn = document.getElementById('note-cash-btn');
  const toggleBtn = e.currentTarget;

  const isFullScreen = listPanel.classList.contains('hidden');

  if (isFullScreen) {
    // Restore normal view
    listPanel.classList.remove('hidden');
    operatorGrid.classList.replace('lg:grid-cols-1', 'lg:grid-cols-2');

    // Make note buttons smaller
    noteBagsBtn.classList.replace('text-lg', 'text-xs');
    noteBagsBtn.classList.replace('py-3', 'py-1');
    noteBagsBtn.classList.replace('px-4', 'px-2');
    noteCashBtn.classList.replace('text-lg', 'text-xs');
    noteCashBtn.classList.replace('py-3', 'py-1');
    noteCashBtn.classList.replace('px-4', 'px-2');

    toggleBtn.textContent = 'Expandir';
    toggleBtn.classList.replace('text-blue-600', 'text-green-600');
  } else {
    // Go to full-screen keypad
    listPanel.classList.add('hidden');
    operatorGrid.classList.replace('lg:grid-cols-2', 'lg:grid-cols-1');

    // Make note buttons bigger
    noteBagsBtn.classList.replace('text-xs', 'text-lg');
    noteBagsBtn.classList.replace('py-1', 'py-3');
    noteBagsBtn.classList.replace('px-2', 'px-4');
    noteCashBtn.classList.replace('text-xs', 'text-lg');
    noteCashBtn.classList.replace('py-1', 'py-3');
    noteCashBtn.classList.replace('px-2', 'px-4');

    toggleBtn.textContent = 'Ver Lista';
    toggleBtn.classList.replace('text-green-600', 'text-blue-600');
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

// --- Initialize Voice Recognition ---
const voiceStatus = document.getElementById('voice-status');
const voiceBtn = document.getElementById('voice-input-btn');
const voiceConfirmationOverlay = document.getElementById('voice-confirmation-overlay');
const voiceResultCode = document.getElementById('voice-result-code');
const voiceResultSource = document.getElementById('voice-result-source');
const voiceSaveBtn = document.getElementById('voice-confirm-save-btn');
const voiceDiscardBtn = document.getElementById('voice-confirm-discard-btn');

let confirmedVoiceData = null;

function showConfirmation(code, source) {
  confirmedVoiceData = { code, source };
  voiceResultCode.textContent = code;
  voiceResultSource.textContent = source;
  voiceConfirmationOverlay.classList.remove('hidden');
}

voiceDiscardBtn.addEventListener('click', () => {
  voiceConfirmationOverlay.classList.add('hidden');
  confirmedVoiceData = null;
});

voiceSaveBtn.addEventListener('click', () => {
  if (confirmedVoiceData) {
    addCode(confirmedVoiceData.code, confirmedVoiceData.source);
    // Clear the main display and selection after saving
    document.getElementById('code-display').textContent = '';
    const activeSource = document.querySelector('.source-btn.active');
    if (activeSource) activeSource.classList.remove('active');
  }
  voiceConfirmationOverlay.classList.add('hidden');
  confirmedVoiceData = null;
});

initVoiceRecognition(voiceStatus, voiceBtn, showConfirmation);
