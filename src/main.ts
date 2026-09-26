import './style.css';
import { GameApp } from './core/GameApp';

let fatalShown = false;

function showFatal(message: string): void {
  if (fatalShown) return;
  fatalShown = true;
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = 'Ошибка: ' + message + '. Обновите страницу. Если ошибка повторяется, сообщите о ней.';
  document.body.appendChild(box);
}

window.addEventListener('error', (event) => showFatal(event.message || 'неизвестная ошибка'));
window.addEventListener('unhandledrejection', (event) => console.warn('Необработанная ошибка', event.reason));

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
const root = document.getElementById('ui') as HTMLElement | null;

if (!canvas || !root) {
  showFatal('не найдены элементы страницы');
} else {
  try {
    new GameApp(canvas, root);
  } catch (error) {
    console.error(error);
    showFatal(error instanceof Error ? error.message : String(error));
  }
}
