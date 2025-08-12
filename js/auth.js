import { auth, db, doc, updateDoc, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from './firebase.js';
import { showNotification } from './utils.js';

async function handleAuth(action, email, password) {
  try {
    if (action === 'register') {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    handleAuthError(error);
  }
}

function handleAuthError(error) {
  let message = 'Ocurrió un error.';
  switch (error.code) {
    case 'auth/user-not-found': message = 'No se encontró un usuario con ese correo.'; break;
    case 'auth/wrong-password': message = 'Contraseña incorrecta.'; break;
    case 'auth/email-already-in-use': message = 'El correo electrónico ya está registrado.'; break;
    case 'auth/weak-password': message = 'La contraseña debe tener al menos 6 caracteres.'; break;
    case 'auth/invalid-email': message = 'El correo electrónico no es válido.'; break;
  }
  showNotification(message, 'error');
}

export function registerAuthHandlers() {
  const loginForm = document.getElementById('login-form');
  const registerBtn = document.getElementById('register-btn');
  loginForm.addEventListener('submit', e => {
    e.preventDefault();
    handleAuth('login', document.getElementById('email-input').value, document.getElementById('password-input').value);
  });
  registerBtn.addEventListener('click', () => {
    handleAuth('register', document.getElementById('email-input').value, document.getElementById('password-input').value);
  });
}

export async function handleLogout() {
  const userId = auth.currentUser?.uid;
  if (userId && localStorage.getItem('userRole') === 'operator') {
    const sessionDocRef = doc(db, 'sessions', userId);
    await updateDoc(sessionDocRef, { codes: [] });
  }
  signOut(auth);
}
