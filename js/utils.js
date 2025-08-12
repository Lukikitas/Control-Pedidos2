let notificationTimeout;

export function showNotification(message, type = 'success') {
  const modal = document.getElementById('notification-modal');
  if (!modal) return;
  document.getElementById('notification-message').textContent = message;
  modal.className = 'hidden fixed top-5 right-5 border rounded-lg shadow-lg px-6 py-4 z-50 transition-transform duration-300 translate-x-full';
  const classesToAdd = type === 'error' ? ['bg-red-100', 'dark:bg-red-900/50'] : ['bg-white', 'dark:bg-gray-700'];
  modal.classList.add(...classesToAdd);
  void modal.offsetWidth;
  modal.classList.remove('translate-x-full');
  clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => modal.classList.add('translate-x-full'), 4000);
}
