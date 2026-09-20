(function () {
  var english = document.documentElement.lang === "en";
  function t(ko, en) { return english ? en : ko; }
  // ---- nav burger ----
  var burger = document.querySelector('.burger');
  var links = document.querySelector('.nav-links');
  var submenuToggle = document.querySelector('.people-trigger');
  var submenu = document.getElementById('people-submenu');
  var navGroup = submenuToggle && submenuToggle.closest('.nav-group');
  function openSubmenu() {
    if (!submenuToggle || !submenu) return;
    submenu.hidden = false;
    submenuToggle.setAttribute('aria-expanded', 'true');
  }
  function closeSubmenu() {
    if (!submenuToggle || !submenu) return;
    submenu.hidden = true;
    submenuToggle.setAttribute('aria-expanded', 'false');
  }
  function closeMenu() {
    if (!burger || !links) return;
    links.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', t('메뉴 열기', 'Open menu'));
    closeSubmenu();
  }
  if (burger && links) {
    burger.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? t('메뉴 닫기', 'Close menu') : t('메뉴 열기', 'Open menu'));
    });
    links.addEventListener('click', function (event) { if (!event.defaultPrevented && event.target.closest('a')) closeMenu(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && submenu && !submenu.hidden) {
        submenuToggle.focus(); closeSubmenu();
      } else if (event.key === 'Escape' && links.classList.contains('open')) {
        closeMenu(); burger.focus();
      }
    });
  }
  if (submenuToggle && submenu) {
    navGroup.addEventListener('mouseenter', function () {
      if (window.matchMedia('(hover: hover) and (min-width: 1061px)').matches) openSubmenu();
    });
    navGroup.addEventListener('mouseleave', function () {
      if (!navGroup.contains(document.activeElement)) closeSubmenu();
    });
    navGroup.addEventListener('focusout', function (event) {
      if (!navGroup.contains(event.relatedTarget)) closeSubmenu();
    });
    navGroup.addEventListener('focusin', function () {
      if (window.matchMedia('(hover: hover) and (min-width: 1061px)').matches) openSubmenu();
    });
    submenuToggle.addEventListener('click', function (event) {
      if (!window.matchMedia('(hover: hover) and (min-width: 1061px)').matches && submenu.hidden) {
        event.preventDefault();
        openSubmenu();
      }
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.nav-group')) closeSubmenu();
    });
  }

  // ---- highlight active nav ----
  var here = location.pathname.split('/').pop() || 'index.html';
  if (here === 'news.html' && location.hash === '#awards') location.replace('awards.html');
  var oldSections = {'#about':'members.html#about', '#contact':'contact.html#contact'};
  if (here === 'index.html' && oldSections[location.hash]) location.replace(oldSections[location.hash]);
  function highlightNav() { document.querySelectorAll('.nav-links a').forEach(function (a) {
    a.classList.remove('active'); a.removeAttribute('aria-current');
    var href = a.getAttribute('href').split('#')[0];
    if (href === here && (!a.closest('.nav-submenu') || a.hash === location.hash)) {
      a.classList.add('active'); a.setAttribute('aria-current', a.closest('.nav-submenu') ? 'location' : 'page');
    }
  }); }
  highlightNav();
  window.addEventListener('hashchange', highlightNav);

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function boldMe(authors) {
    return esc(authors).replace(/(Yoonseok Heo\*?|Y\. Heo|허윤석)/g, '<b>$1</b>');
  }
  function scholarLink(title) {
    return 'https://scholar.google.com/scholar?q=' + encodeURIComponent('"' + title + '"');
  }
  function areasFor(p) {
    return (p.areas || []).filter(function (area, index, areas) {
      return Object.prototype.hasOwnProperty.call(window.RESEARCH_AREAS || {}, area) && areas.indexOf(area) === index;
    }).sort(function (a, b) { return Object.keys(window.RESEARCH_AREAS).indexOf(a) - Object.keys(window.RESEARCH_AREAS).indexOf(b); });
  }

  window.renderPub = function (p) {
    var badgeCls = p.award ? 'award' : (p.type === 'domestic' ? 'domestic' : (p.type === 'preprint' ? 'preprint' : ''));
    var indexing = p.indexing ? ' (' + p.indexing + ')' : '';
    var badge = '<span class="venue ' + badgeCls + '">' + (p.hot ? '🔥 ' : '') + esc(p.venue) + esc(indexing) + (p.award ? ' · ' + esc(p.award) : '') + '</span>';
    var titleHref = (p.links && p.links[0]) ? (p.links[0].scholar ? scholarLink(p.title) : p.links[0].href) : scholarLink(p.title);
    var linksHtml = (p.links || []).map(function (l) {
      var href = l.scholar ? scholarLink(p.title) : l.href;
      return '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>';
    }).join('');
    if (p.cites) linksHtml += '<span class="cites">Cited by ' + p.cites + '</span>';
    var areas = areasFor(p);
    var areaHtml = areas.length ? '<div class="pub-area">' + areas.map(function (area) {
      return '<a class="area-badge area-' + area + '" href="publications.html?area=' + area + '">' + esc(window.RESEARCH_AREAS[area]) + '</a>';
    }).join('') +
      (p.areaNote ? '<span class="area-note">' + esc(p.areaNote) + '</span>' : '') + '</div>' : '';
    return '<article class="pub" data-type="' + esc(p.type) + '">' +
      '<div>' + badge +
        '<h4><a href="' + esc(titleHref) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a></h4>' +
        (p.subtitle ? '<div class="where original-title" lang="' + (/[가-힣]/.test(p.subtitle) ? 'ko' : 'en') + '" style="margin-top:2px">' + esc(p.subtitle) + '</div>' : '') +
        (p.titleNote ? '<div class="title-note">' + esc(p.titleNote) + '</div>' : '') +
        '<div class="authors">' + boldMe(p.authors) + '</div>' +
        '<div class="where">' + esc(p.where) + '</div>' + areaHtml +
      '</div>' +
      '<div class="links">' + linksHtml + '</div>' +
    '</article>';
  };

  // ---- full publication list with filters ----
  var list = document.getElementById('pub-list');
  if (list && window.PUBS) {
    var current = 'all', currentArea = 'all';
    var types = ['all', 'journal', 'conference', 'workshop', 'domestic', 'preprint'];
    function readFilters() {
      var params = new URLSearchParams(location.search);
      current = types.indexOf(params.get('type')) >= 0 ? params.get('type') : 'all';
      currentArea = Object.prototype.hasOwnProperty.call(window.RESEARCH_AREAS || {}, params.get('area')) ? params.get('area') : 'all';
    }
    function saveFilters() {
      var url = new URL(location.href);
      if (current === 'all') url.searchParams.delete('type'); else url.searchParams.set('type', current);
      if (currentArea === 'all') url.searchParams.delete('area'); else url.searchParams.set('area', currentArea);
      history.pushState(null, '', url);
    }
    function draw() {
      var pubs = window.PUBS.filter(function (p) {
        return (current === 'all' || p.type === current) && (currentArea === 'all' || areasFor(p).indexOf(currentArea) >= 0);
      });
      document.querySelectorAll('.filters button').forEach(function (b) {
        var selected = b.dataset.area ? b.dataset.area === currentArea : b.dataset.type === current;
        b.classList.toggle('on', selected); b.setAttribute('aria-pressed', String(selected));
      });
      var count = document.getElementById('pub-count');
      if (count) count.textContent = pubs.length + ' publication' + (pubs.length === 1 ? '' : 's') + (currentArea !== 'all' ? ' · ' + window.RESEARCH_AREAS[currentArea] : '');
      var years = [];
      pubs.forEach(function (p) { if (years.indexOf(p.year) < 0) years.push(p.year); });
      years.sort(function (a, b) { return b - a; });
      list.innerHTML = years.map(function (y) {
        return '<h3 class="year">' + y + '</h3>' + pubs.filter(function (p) { return p.year === y; }).map(window.renderPub).join('');
      }).join('') || '<div class="empty-state"><p>' + t('선택한 조건에 해당하는 등록 논문이 없습니다.', 'No publications match the selected filters.') + '</p><a href="publications.html">' + t('전체 논문 보기 →', 'View all publications →') + '</a></div>';
      if (currentArea !== 'all') list.insertAdjacentHTML('afterbegin', '<p class="filtered-area-link"><a href="research.html#' + currentArea + '">' + t('이 연구 분야 자세히 보기 ↗', 'Explore this research area ↗') + '</a></p>');
    }
    document.querySelectorAll('.filters button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.area) currentArea = b.dataset.area; else current = b.dataset.type;
        saveFilters(); draw();
      });
    });
    window.addEventListener('popstate', function () { readFilters(); draw(); });
    readFilters(); draw();
  }

  document.querySelectorAll('[data-related-area]').forEach(function (container) {
    var pubs = (window.PUBS || []).filter(function (p) {
      return areasFor(p).indexOf(container.dataset.relatedArea) >= 0;
    }).sort(function (a, b) { return b.year - a.year; }).slice(0, 3);
    container.innerHTML = pubs.length ? pubs.map(window.renderPub).join('') : '<p class="empty-state">' + t('현재 연구를 진행하고 있으며, 관련 논문은 발표 후 이곳에 소개합니다.', 'Research is underway. Related publications will be listed here as they become available.') + '</p>';
  });

  // ---- selected publications on home ----
  var sel = document.getElementById('selected-pubs');
  if (sel && window.PUBS) {
    sel.innerHTML = window.PUBS.filter(function (p) { return p.selected; }).slice(0, 6).map(window.renderPub).join('');
  }

  // One award archive powers both the homepage preview and the complete list.
  var awards = (window.AWARDS || []).slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
  document.querySelectorAll('[data-awards-limit]').forEach(function (container) {
    var limit = container.dataset.awardsLimit === 'all' ? awards.length : Number(container.dataset.awardsLimit);
    container.innerHTML = awards.slice(0, limit).map(function (award) { return award.markup; }).join('');
  });

  // ---- stats ----
  if (window.PUBS) {
    var n = function (t) { return window.PUBS.filter(function (p) { return p.type === t; }).length; };
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    set('stat-journal', n('journal'));
    set('stat-conf', n('conference'));
    set('stat-total', window.PUBS.length);
    set('stat-awards', awards.length);
  }
})();
