(function () {
  var sweep = document.getElementById('page-sweep');
  if (!sweep) return;

  var TRANS_KEY = 'vb_page_sweep';
  var sweeping = false;

  // ---- IN: every page gets a full-screen blue block that slides left ----
  function playSlideIn() {
    // Reset any leftover state
    sweep.style.transition = 'none';
    // Cover full screen instantly
    sweep.style.zIndex = '2147483647';
    sweep.style.width = '100vw';
    sweep.style.transform = 'translateX(0)';
    sweep.offsetHeight;
    // Slide out to the left
    sweep.style.transition = 'transform 0.35s cubic-bezier(0.1, 0.8, 0.2, 1)';
    sweep.style.transform = 'translateX(-100%)';
    sweep.addEventListener('transitionend', function clean() {
      sweep.removeEventListener('transitionend', clean);
      sweep.style.transition = 'none';
      sweep.style.transform = '';
      sweep.style.width = '';
      sweep.style.zIndex = '';
      sweep.offsetHeight;
      sweep.style.transition = '';
    });
  }
  playSlideIn();
  // Handle browser back/forward (bfcache restores DOM but not JS state)
  window.addEventListener('pageshow', function () {
    sweeping = false; // bfcache restores JS state, reset guard
    if (sweep.style.width === '100vw' || sweep.style.zIndex === '2147483647') {
      playSlideIn();
    }
  });

  // ---- OUT: intercept nav clicks, sweep right->left, then navigate ----
  function doSweep(url) {
    if (sweeping) return;
    sweeping = true;

    // Immediately bring to front, then show stripes
    sweep.style.zIndex = '2147483647';
    sweep.classList.add('stripes');
    setTimeout(function () {
      sweep.classList.remove('stripes');
      sweep.style.transition = 'width 0.35s cubic-bezier(0.1, 0.8, 0.2, 1)';
      sweep.style.width = '100vw';
    }, 160);

    setTimeout(function () {
      sessionStorage.setItem(TRANS_KEY, '1');
      window.location.href = url;
    }, 550);
  }

  // Nav bar direct handler
  var navEl = document.querySelector('.top-nav nav');
  if (navEl) {
    navEl.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      doSweep(link.href);
    });
  }

  // Document fallback for other .html links
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    // Brand link
    if (link.classList.contains('brand')) { e.preventDefault(); doSweep(link.href); return; }
    if (link.closest('.top-nav')) return; // handled above
    var href = link.getAttribute('href') || link.href || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      var fullUrl = new URL(href, document.baseURI);
      if (fullUrl.origin !== window.location.origin) return;
      if (!fullUrl.pathname.endsWith('.html')) return;
      e.preventDefault();
      // Fallback: navigate directly if doSweep fails
      try {
        doSweep(fullUrl.pathname + fullUrl.search);
      } catch (_) {
        window.location.href = fullUrl.href;
      }
    } catch (_) {
      // URL parse failed, navigate normally
    }
  });
})();

// ---- Card hover border wrapper ----
(function () {
  function wrapCards() {
    document.querySelectorAll('.item-card:not(.wrapped), .ac:not(.wrapped), .game-card:not(.wrapped)').forEach(function (card) {
      var w = document.createElement('div');
      w.className = 'card-wrap';
      card.parentNode.insertBefore(w, card);
      w.appendChild(card);
      card.classList.add('wrapped');
    });
  }
  wrapCards();
  setInterval(wrapCards, 800);
})();