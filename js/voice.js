const numberWords = {
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4,
  cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
};

function parseCommand(text) {
  const cleanText = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");

  let source = null;

  // Check for sources with priority for multi-word phrases
  if (cleanText.includes('rappi cargo') || cleanText.includes('rappicargo')) {
    source = 'RappiCargo';
  } else if (cleanText.includes('pedidos ya') || cleanText.includes('pedidosya') || cleanText.includes('peya')) {
    source = 'PedidosYa';
  } else if (cleanText.includes('mercado pago') || cleanText.includes('mercadopago')) {
    source = 'MercadoPago';
  } else if (cleanText.includes('rappi')) {
    // This is checked last to avoid matching "rappi cargo"
    source = 'Rappi';
  }

  // Extract numbers
  const words = cleanText.split(' ');
  let numbers = '';
  for (const word of words) {
    if (numberWords[word] !== undefined) {
      numbers += numberWords[word];
    } else if (!isNaN(parseInt(word))) {
      numbers += word;
    }
  }

  return { code: numbers, source: source };
}

export function initVoiceRecognition(statusDisplay, button, showConfirmationCallback) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    statusDisplay.textContent = 'El reconocimiento de voz no es compatible.';
    button.disabled = true;
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.continuous = true;
  recognition.interimResults = true;

  let isListening = false;

  button.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (error) {
        console.error("Error starting recognition:", error);
      }
    }
  });

  recognition.onstart = () => {
    isListening = true;
    statusDisplay.textContent = 'Escuchando...';
    button.classList.add('animate-pulse', 'bg-red-600');
    button.classList.remove('bg-blue-600');
  };

  recognition.onend = () => {
    isListening = false;
    statusDisplay.textContent = '';
    button.classList.remove('animate-pulse', 'bg-red-600');
    button.classList.add('bg-blue-600');
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    statusDisplay.textContent = `Error: ${event.error}`;
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      transcript += event.results[i][0].transcript;
    }

    console.log("Transcript:", transcript);
    statusDisplay.textContent = `Detectado: "${transcript}"`;

    const command = parseCommand(transcript);

    // If we have a source and a reasonably long code, the command is complete.
    if (command.source && command.code && command.code.length >= 3) {
      console.log("Complete command detected:", command);
      // Stop listening once we have a complete command
      if (isListening) {
        recognition.stop();
      }
      // Show the confirmation modal
      showConfirmationCallback(command.code.substring(0, 4), command.source);
    }
  };
}
