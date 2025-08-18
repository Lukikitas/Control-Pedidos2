export function registerNavigationEvents({ setupRoleView, backToMenu, handleLogout }) {
  document.getElementById('select-operator-btn').addEventListener('click', () => setupRoleView('operator'));
  document.getElementById('select-viewer-btn').addEventListener('click', () => setupRoleView('viewer'));
  document.getElementById('select-history-btn').addEventListener('click', () => setupRoleView('history'));
  document.getElementById('select-settings-btn').addEventListener('click', () => setupRoleView('settings'));
  document.getElementById('select-closeorders-btn').addEventListener('click', () => setupRoleView('closeorders'));

  // Button to switch from Operator to Close Orders view
  const toCloseOrders = document.getElementById('switch-to-closeorders-btn');
  if (toCloseOrders) toCloseOrders.addEventListener('click', () => setupRoleView('closeorders'));

  // Button to switch from Viewer to Operator view
  const toOperatorFromViewer = document.getElementById('switch-to-operator-btn');
  if (toOperatorFromViewer) toOperatorFromViewer.addEventListener('click', () => setupRoleView('operator'));

  // Button to switch from Close Orders to Operator view
  const toOperatorFromCloseorders = document.getElementById('switch-to-operator-from-closeorders-btn');
  if (toOperatorFromCloseorders) toOperatorFromCloseorders.addEventListener('click', () => setupRoleView('operator'));

  document.getElementById('op-back-to-menu-btn').addEventListener('click', backToMenu);
  document.getElementById('viewer-back-to-menu-btn').addEventListener('click', backToMenu);
  document.getElementById('history-back-to-menu-btn').addEventListener('click', backToMenu);
  document.getElementById('settings-back-to-menu-btn').addEventListener('click', backToMenu);
  document.getElementById('closeorders-back-to-menu-btn').addEventListener('click', backToMenu);

  [
    'role-logout-btn',
    'op-logout-btn',
    'viewer-logout-btn',
    'history-logout-btn',
    'closeorders-logout-btn'
  ].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', handleLogout);
  });
}
