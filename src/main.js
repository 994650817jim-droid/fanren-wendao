import { mount } from './ui/ui.js';

function boot() {
  const root = document.getElementById('app');
  if (!root) {
    console.error('找不到 #app 节点');
    return;
  }
  mount(root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
