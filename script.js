// MyFoodCraving Landing — Interactions
(function () {
  'use strict';

  // Sticky nav
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  // Mobile menu
  const toggle = document.getElementById('mobile-toggle');
  const mobileMenu = document.getElementById('mobile-menu');
  const desktopBP = window.matchMedia('(min-width: 769px)');
  const authModal = document.getElementById('auth-modal');
  const authTriggers = document.querySelectorAll('[data-auth-trigger]');
  let lastAuthFocus = null;

  const updatePageLock = () => {
    const menuOpen = mobileMenu.classList.contains('open');
    const authOpen = authModal && authModal.classList.contains('open');
    document.body.style.overflow = menuOpen || authOpen ? 'hidden' : '';
    document.body.classList.toggle('modal-open', !!authOpen);
  };

  const setMenu = (open) => {
    toggle.classList.toggle('active', open);
    mobileMenu.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    updatePageLock();
  };

  const closeAuth = () => {
    if (!authModal || !authModal.classList.contains('open')) return;
    authModal.classList.remove('open');
    authModal.setAttribute('aria-hidden', 'true');
    authModal.hidden = true;
    updatePageLock();
    if (lastAuthFocus) lastAuthFocus.focus();
    lastAuthFocus = null;
  };

  const openAuth = () => {
    if (!authModal) return;
    lastAuthFocus = document.activeElement;
    setMenu(false);
    authModal.hidden = false;
    authModal.classList.add('open');
    authModal.setAttribute('aria-hidden', 'false');
    updatePageLock();
    const firstFocus = authModal.querySelector('.provider-btn');
    if (firstFocus) firstFocus.focus();
  };

  toggle.addEventListener('click', () => setMenu(!mobileMenu.classList.contains('open')));
  mobileMenu.addEventListener('click', (e) => { if (e.target === mobileMenu) setMenu(false); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && authModal && authModal.classList.contains('open')) { closeAuth(); return; }
    if (e.key === 'Escape' && mobileMenu.classList.contains('open')) setMenu(false);
    if (e.key !== 'Tab' || !authModal || !authModal.classList.contains('open')) return;
    const focusable = [...authModal.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  desktopBP.addEventListener('change', (e) => { if (e.matches) setMenu(false); });

  authTriggers.forEach(trigger => {
    trigger.addEventListener('click', e => { e.preventDefault(); openAuth(); });
  });

  if (authModal) {
    authModal.querySelectorAll('[data-auth-close]').forEach(el => {
      el.addEventListener('click', closeAuth);
    });
  }

  // Smooth anchor scroll
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const id = link.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      setMenu(false);
      window.scrollTo({ top: target.offsetTop - 72, behavior: 'smooth' });
    });
  });

  // Scroll reveal
  const targets = document.querySelectorAll('.reveal, .feature-item, .step');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    targets.forEach(el => observer.observe(el));
  } else {
    targets.forEach(el => el.classList.add('visible'));
  }

  // Animated cook timer
  const timerEl = document.querySelector('.cook-timer');
  if (timerEl) {
    let seconds = 684; // 11:24
    const fmt = (s) => {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `⏱ ${m}:${sec.toString().padStart(2, '0')} remaining`;
    };
    setInterval(() => {
      seconds = seconds > 0 ? seconds - 1 : 900;
      timerEl.textContent = fmt(seconds);
    }, 1000);
  }

  // CTA form
  const ctaForm = document.getElementById('cta-form');
  if (ctaForm) {
    ctaForm.addEventListener('submit', (e) => {
      e.preventDefault();
      openAuth();
    });
  }
})();
