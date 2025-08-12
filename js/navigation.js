export function registerNavigationEvents({ setupRoleView, backToMenu, handleLogout }) {
  document.getElementById('select-operator-btn').addEventListener('click', () => setupRoleView('operator'));
  document.getElementById('select-viewer-btn').addEventListener('click', () => setupRoleView('viewer'));
  document.getElementById('select-history-btn').addEventListener('click', () => setupRoleView('history'));
  document.getElementById('select-settings-btn').addEventListener('click', () => setupRoleView('settings'));
  document.getElementById('select-closeorders-btn').addEventListener('click', () => setupRoleView('closeorders'));

  const toViewer = document.getElementById('switch-to-viewer-btn');
  const toOperator = document.getElementById('switch-to-operator-btn');
  if (toViewer) toViewer.addEventListener('click', () => setupRoleView('viewer'));
  if (toOperator) toOperator.addEventListener('click', () => setupRoleView('operator'));

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
