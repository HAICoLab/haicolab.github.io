(function () {
  var picker = document.querySelector('.language-picker');
  if (!picker) return;
  var button = picker.querySelector('.language-toggle');
  var options = picker.querySelector('.language-options');
  var links = Array.from(picker.querySelectorAll('.language-option'));
  var destinations = links.map(function (link) { return new URL(link.getAttribute('href'), location.href); });
  function update() {
    links.forEach(function (link, index) {
      destinations[index].search = location.search;
      destinations[index].hash = location.hash;
      link.href = destinations[index].href;
    });
  }
  function close() { options.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  function open() { update(); options.hidden = false; button.setAttribute('aria-expanded', 'true'); }
  button.addEventListener('click', function () { if (options.hidden) open(); else close(); });
  button.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); open(); links[0].focus(); }
  });
  links.forEach(function (link) { link.addEventListener('click', function () { update(); close(); }); });
  picker.addEventListener('focusout', function (event) { if (!picker.contains(event.relatedTarget)) close(); });
  document.addEventListener('click', function (event) {
    if (!picker.contains(event.target)) close();
    if (event.target.closest('.filters')) update();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !options.hidden) {
      event.preventDefault(); event.stopPropagation(); close(); button.focus();
    }
  }, true);
  update();
  window.addEventListener('hashchange', update);
  window.addEventListener('popstate', update);
})();
