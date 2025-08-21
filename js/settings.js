import { auth, db, doc, updateDoc } from './firebase.js';
import { showNotification } from './utils.js';

export const userSettings = {
  blinkMinutes: 5,
  criticalMinutes: 15,
  scrollSpeed: 3,
  viewerSize: 3,
  calculatorSize: 4,
  viewerFooterText: "⬅️ para retirar",
  viewerFooterSize: 3,
  voiceAliases: {
    'PedidosYa': 'pedidos ya,pedidosya,peya,pedido yas,pesa,pedido ya,ya',
    'Rappi': 'rappi,rapi',
    'RappiCargo': 'rappi cargo,cargo',
    'MercadoPago': 'mercado pago,mercadopago,mp,mercado',
  },
};

export function updateLocalSettings(newSettings = {}) {
  Object.assign(userSettings, newSettings);
}

export function populateSettingsForm() {
  document.getElementById('blink-minutes-input').value = userSettings.blinkMinutes;
  document.getElementById('critical-minutes-input').value = userSettings.criticalMinutes;
  document.getElementById('scroll-speed-input').value = userSettings.scrollSpeed;
  document.getElementById('viewer-size-input').value = userSettings.viewerSize;
  document.getElementById('calculator-size-input').value = userSettings.calculatorSize;
  document.getElementById('viewer-text-input').value = userSettings.viewerFooterText;
  document.getElementById('viewer-footer-size-input').value = userSettings.viewerFooterSize;

  // Populate voice alias fields
  const aliases = userSettings.voiceAliases || {};
  document.getElementById('alias-pedidosya-input').value = aliases.PedidosYa || '';
  document.getElementById('alias-rappi-input').value = aliases.Rappi || '';
  document.getElementById('alias-rappicargo-input').value = aliases.RappiCargo || '';
  document.getElementById('alias-mercadopago-input').value = aliases.MercadoPago || '';
}

export function registerSettingsHandlers({ backToMenu }) {
  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    const newSettings = {
      blinkMinutes: parseInt(document.getElementById('blink-minutes-input').value) || 5,
      criticalMinutes: parseInt(document.getElementById('critical-minutes-input').value) || 15,
      scrollSpeed: parseInt(document.getElementById('scroll-speed-input').value) || 3,
      viewerSize: parseInt(document.getElementById('viewer-size-input').value) || 3,
      calculatorSize: parseInt(document.getElementById('calculator-size-input').value) || 4,
      viewerFooterText: document.getElementById('viewer-text-input').value || "⬅️ para retirar",
      viewerFooterSize: parseInt(document.getElementById('viewer-footer-size-input').value) || 3,
      voiceAliases: {
        'PedidosYa': document.getElementById('alias-pedidosya-input').value,
        'Rappi': document.getElementById('alias-rappi-input').value,
        'RappiCargo': document.getElementById('alias-rappicargo-input').value,
        'MercadoPago': document.getElementById('alias-mercadopago-input').value
      }
    };
    const sessionDocRef = doc(db, 'sessions', userId);
    await updateDoc(sessionDocRef, { settings: newSettings });
    updateLocalSettings(newSettings);
    showNotification('Configuración guardada.');
    backToMenu();
  });
}

