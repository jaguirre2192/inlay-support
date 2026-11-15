'use strict';

// Native <details> navigation remains usable without this enhancement.
const menu = document.querySelector('.mobile-menu');
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu?.open) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});
document.addEventListener('click', event => {
  if (!menu?.open) return;
  if (!menu.contains(event.target) || event.target.closest('a')) menu.open = false;
});
matchMedia('(min-width: 761px)').addEventListener('change', event => {
  if (event.matches && menu) menu.open = false;
});

// The poster is the default; film is enhancement, never a loading gate.
const film = document.querySelector('#atlas-film');
if (film) {
  const room = film.closest('.cinema');
  const toggle = room.querySelector('.motion-toggle');
  const status = room.querySelector('.motion-status');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = Boolean(navigator.connection?.saveData);
  const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>';
  const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
  let timer, attempt = 0, wantsPlay = false, userPaused = false, visible = false, needsReload = false;

  function button(label, icon = playIcon) { toggle.innerHTML = label + icon; }
  function pause() {
    attempt += 1;
    clearTimeout(timer);
    wantsPlay = false;
    film.pause();
    room.classList.remove('is-playing');
    button('Play atmosphere');
  }
  function unavailable(message = 'The film couldn’t play. The illustration is still here.') {
    pause();
    needsReload = true;
    status.textContent = message;
    button('Try the film again');
  }
  function armTimeout(token) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (attempt === token && wantsPlay) unavailable('The film is taking too long. Enjoy the illustration, or try again.');
    }, 7000);
  }
  function play() {
    if (wantsPlay) return;
    wantsPlay = true;
    const token = ++attempt;
    status.textContent = '';
    button('Cancel film');
    armTimeout(token);
    if (!film.src || film.error || needsReload) {
      needsReload = false;
      film.src = film.dataset.src;
      film.load();
    }
    film.play().then(() => {
      if (token !== attempt || !wantsPlay) { film.pause(); return; }
      clearTimeout(timer);
      room.classList.add('is-playing');
      button('Pause atmosphere', pauseIcon);
    }).catch(() => { if (token === attempt) unavailable(); });
  }
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    if (wantsPlay) { userPaused = true; pause(); status.textContent = ''; }
    else { userPaused = false; play(); }
  });
  film.addEventListener('error', () => { if (wantsPlay) unavailable(); });
  film.addEventListener('waiting', () => { if (wantsPlay) armTimeout(attempt); });
  film.addEventListener('playing', () => {
    if (!wantsPlay) { film.pause(); return; }
    clearTimeout(timer);
    room.classList.add('is-playing');
    button('Pause atmosphere', pauseIcon);
  });
  reduceMotion.addEventListener('change', event => {
    if (event.matches) { pause(); status.textContent = ''; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (visible && !reduceMotion.matches && !saveData && !userPaused) play();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible && !reduceMotion.matches && !saveData && !userPaused) play();
      else if (!visible) pause();
    }, {threshold: 0.25}).observe(room);
  }
}
