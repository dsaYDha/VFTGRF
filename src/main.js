import './style.css';
import { Game } from './core/Game.js';
import { installDevTools } from './devtools.js';

const game = new Game(document.getElementById('app'));
// 개발·테스트용 접근점
window.__game = game;
installDevTools(game);
game.init().catch((err) => {
  console.error(err);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = '오류: ' + (err && err.message ? err.message : err);
});
