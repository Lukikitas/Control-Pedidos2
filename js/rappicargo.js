import { showNotification } from './utils.js';

export function initRappicargo(addCode) {
  const rappicargoOverlay = document.getElementById('rappicargo-overlay');
  const rappicargoModal = document.getElementById('rappicargo-modal');

  document.getElementById('cancel-rappicargo-btn').addEventListener('click', () => {
    rappicargoModal.classList.remove('open');
    rappicargoOverlay.classList.add('hidden');
  });

  document.getElementById('save-rappicargo-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('rappicargo-name-input');
    const name = String(nameInput.value || '').trim();
    if (name) {
      addCode(name, 'RappiCargo', 'name');
      nameInput.value = '';
      rappicargoModal.classList.remove('open');
      rappicargoOverlay.classList.add('hidden');
    } else {
      showNotification('Por favor, ingresa un nombre.', 'error');
    }
  });
}
