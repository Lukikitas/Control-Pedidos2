import { userSettings } from './settings.js';

export function initCalculator() {
  const calculatorOverlay = document.getElementById('calculator-overlay');
  const calculatorModal = document.getElementById('calculator-modal');
  let calcState = { displayValue: '0', firstOperand: null, waitingForSecondOperand: false, operator: null, expression: '' };

  function updateCalcDisplay() {
    document.getElementById('calc-display').textContent = calcState.displayValue;
    document.getElementById('calc-expression-display').textContent = calcState.expression;
  }

  document.getElementById('open-calculator-btn').addEventListener('click', () => {
    const calcSizes = ['w-64','w-72','w-80','w-96','w-[28rem]','w-[32rem]','w-[36rem]','w-[40rem]'];
    calculatorModal.className = 'bg-white dark:bg-gray-800 p-4 rounded-lg shadow-2xl transition-transform transform open';
    calculatorModal.classList.add(calcSizes[userSettings.calculatorSize - 1] || calcSizes[3]);
    calculatorOverlay.classList.remove('hidden');
  });

  calculatorOverlay.addEventListener('click', (e) => {
    if (e.target === calculatorOverlay) {
      calculatorModal.classList.remove('open');
      calculatorOverlay.classList.add('hidden');
    }
  });

  document.getElementById('calc-buttons').addEventListener('click', (e) => {
    const { target } = e;
    if (!target.matches('button')) return;
    const key = target.textContent;

    if (key === 'C') {
      calcState = { displayValue:'0', firstOperand:null, waitingForSecondOperand:false, operator:null, expression:'' };
    } else if (!isNaN(parseFloat(key)) || key === '.') {
      if (calcState.waitingForSecondOperand) {
        calcState.displayValue = key;
        calcState.waitingForSecondOperand = false;
      } else {
        calcState.displayValue = calcState.displayValue === '0' ? key : (calcState.displayValue + key);
      }
    } else if (['+','-','*','/'].includes(key)) {
      const inputValue = parseFloat(calcState.displayValue);
      if (calcState.operator && calcState.waitingForSecondOperand)  {
        calcState.operator = key;
        calcState.expression = `${calcState.firstOperand} ${key}`;
        return;
      }
      if (calcState.firstOperand == null) {
        calcState.firstOperand = inputValue;
      } else if (calcState.operator) {
        const result = performCalculation[calcState.operator](calcState.firstOperand, inputValue);
        calcState.displayValue = `${parseFloat(result.toFixed(7))}`;
        calcState.firstOperand = result;
      }
      calcState.waitingForSecondOperand = true;
      calcState.operator = key;
      calcState.expression = `${calcState.firstOperand} ${key}`;
    } else if (key === '=') {
      if (calcState.operator == null || calcState.waitingForSecondOperand) return;
      const inputValue = parseFloat(calcState.displayValue);
      calcState.expression = `${calcState.firstOperand} ${calcState.operator} ${inputValue} =`;
      const result = performCalculation[calcState.operator](calcState.firstOperand, inputValue);
      calcState.displayValue = `${parseFloat(result.toFixed(7))}`;
      calcState.firstOperand = null;
      calcState.operator = null;
      calcState.waitingForSecondOperand = true;
    }
    updateCalcDisplay();
  });

  const performCalculation = {
    '/': (first, second) => first / second,
    '*': (first, second) => first * second,
    '+': (first, second) => first + second,
    '-': (first, second) => first - second,
  };
}
