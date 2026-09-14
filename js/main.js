(function () {
  // ---- nav burger ----
  var burger = document.querySelector('.burger');
  var links = document.querySelector('.links');
  if (burger && links) burger.addEventListener('click', function () { links.classList.toggle('open'); });

  // ---- highlight active nav ----
  var here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.links a').forEach(function (a) {
    var href = a.getAttribute('href').split('#')[0];
    if (href === here || (here === 'index.html' && href === '')) a.classList.add('active');
  });

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function boldMe(authors) {
    return esc(authors).replace(/(Yoonseok Heo\*?|Y\. Heo|허윤석)/g, '<b>$1</b>');
  }
  function scholarLink(title) {
    return 'https://scholar.google.com/scholar?q=' + encodeURIComponent('"' + title + '"');
  }

  window.renderPub = function (p) {
    var badgeCls = p.award ? 'award' : (p.type === 'domestic' ? 'domestic' : (p.type === 'preprint' ? 'preprint' : ''));
    var badge = '<span class="venue ' + badgeCls + '">' + (p.hot ? '🔥 ' : '') + esc(p.venue) + (p.award ? ' · ' + esc(p.award) : '') + '</span>';
    var titleHref = (p.links && p.links[0]) ? (p.links[0].scholar ? scholarLink(p.title) : p.links[0].href) : scholarLink(p.title);
    var linksHtml = (p.links || []).map(function (l) {
      var href = l.scholar ? scholarLink(p.title) : l.href;
      return '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>';
    }).join('');
    if (p.cites) linksHtml += '<span class="cites">Cited by ' + p.cites + '</span>';
    return '<article class="pub" data-type="' + p.type + '">' +
      '<div>' + badge +
        '<h4><a href="' + esc(titleHref) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a></h4>' +
        (p.subtitle ? '<div class="where" style="margin-top:2px">' + esc(p.subtitle) + '</div>' : '') +
        '<div class="authors">' + boldMe(p.authors) + '</div>' +
        '<div class="where">' + esc(p.where) + '</div>' +
      '</div>' +
      '<div class="links">' + linksHtml + '</div>' +
    '</article>';
  };

  // ---- full publication list with filters ----
  var list = document.getElementById('pub-list');
  if (list && window.PUBS) {
    var current = 'all';
    function draw() {
      var pubs = window.PUBS.filter(function (p) { return current === 'all' || p.type === current; });
      var years = [];
      pubs.forEach(function (p) { if (years.indexOf(p.year) < 0) years.push(p.year); });
      years.sort(function (a, b) { return b - a; });
      list.innerHTML = years.map(function (y) {
        return '<h3 class="year">' + y + '</h3>' + pubs.filter(function (p) { return p.year === y; }).map(window.renderPub).join('');
      }).join('') || '<p style="color:var(--fg3)">No publications in this category.</p>';
    }
    document.querySelectorAll('.filters button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.filters button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); current = b.dataset.type; draw();
      });
    });
    draw();
  }

  // ---- selected publications on home ----
  var sel = document.getElementById('selected-pubs');
  if (sel && window.PUBS) {
    sel.innerHTML = window.PUBS.filter(function (p) { return p.selected; }).slice(0, 6).map(window.renderPub).join('');
  }

  // ---- stats ----
  if (window.PUBS) {
    var n = function (t) { return window.PUBS.filter(function (p) { return p.type === t; }).length; };
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    set('stat-journal', n('journal'));
    set('stat-conf', n('conference'));
    set('stat-total', window.PUBS.length);
  }
})();
