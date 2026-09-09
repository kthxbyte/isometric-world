// The documentation overlay: markdown files in this directory, readable
// without leaving the app. The list is hardcoded because a static server
// offers no directory listing. Each file is fetched on the first visit
// and kept, so switching back is instant. The rendering itself lives in
// markdown.js.

(function (global) {
  'use strict';

  var Markdown = global.Markdown;

  var DOCS = [
    { key: 'readme', file: 'README.md', title: 'README' },
    { key: 'license', file: 'LICENSE', title: 'LICENSE' }
  ];

  var HASH = '#docs/';

  function findDoc(key) {
    for (var i = 0; i < DOCS.length; i++) {
      if (DOCS[i].key === key) return DOCS[i];
    }
    return null;
  }

  // onOpen/onClose let the caller do whatever behind the overlay needs
  // pausing or tidying (e.g. drop a drawer back out of the way).
  function Docs(options) {
    this.onOpen = options && options.onOpen;
    this.onClose = options && options.onClose;
    this.root = document.getElementById('docs');
    this.list = document.getElementById('docs-list');
    this.body = document.getElementById('docs-body');
    this.article = document.getElementById('docs-article');
    this.cache = {};   // key -> rendered HTML
    this.scroll = {};  // key -> scrollTop, so a doc reopens where it was
    this.current = null;
    this.headings = [];
    this.opener = null;
    this.tocLinks = new Map();

    var self = this;
    DOCS.forEach(function (doc) {
      var li = document.createElement('li');
      var button = document.createElement('button');
      button.className = 'docs-title';
      button.textContent = doc.title;
      button.addEventListener('click', function () { self.show(doc.key); });
      var toc = document.createElement('ul');
      toc.className = 'docs-toc';
      li.appendChild(button);
      li.appendChild(toc);
      self.list.appendChild(li);
      doc.el = { li: li, button: button, toc: toc };
    });

    this.closeButton = document.getElementById('docs-close');
    this.closeButton.addEventListener('click', function () { self.close(); });
    document.getElementById('docs-open')
      .addEventListener('click', function () { self.toggle(); });

    // A link inside an article that points at one of this directory's
    // doc files switches to it in the viewer instead of navigating the
    // page away (README's `[LICENSE](LICENSE)` stays on the page).
    this.article.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== self.article && el.tagName !== 'A') {
        el = el.parentElement;
      }
      if (!el || el.tagName !== 'A') return;
      var href = el.getAttribute('href');
      for (var i = 0; i < DOCS.length; i++) {
        if (DOCS[i].file === href) {
          e.preventDefault();
          self.show(DOCS[i].key);
          return;
        }
      }
    });

    // The overlay handles its own keys rather than relying on anything
    // behind it, so Escape always closes it and Tab cannot wander out to
    // a panel the reader cannot see.
    this.root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); self.close(); return; }
      if (e.key !== 'Tab') return;
      var stops = self.focusables();
      if (!stops.length) return;
      var first = stops[0];
      var last = stops[stops.length - 1];
      var on = document.activeElement;
      if (e.shiftKey && (on === first || stops.indexOf(on) === -1)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && on === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Track the heading being read so the contents can say where you
    // are. rAF-coalesced: scroll fires far more often than the
    // highlight can usefully change.
    var pending = false;
    this.body.addEventListener('scroll', function () {
      if (self.current) self.scroll[self.current] = self.body.scrollTop;
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; self.spy(); });
    });

    addEventListener('hashchange', function () { self.fromHash(); });
  }

  Docs.prototype.isOpen = function () {
    return !this.root.hidden;
  };

  // A document is linkable: #docs/readme opens straight to it. The
  // query string is left alone.
  Docs.prototype.fromHash = function () {
    if (location.hash.indexOf(HASH) !== 0) {
      if (this.isOpen()) this.close({ hash: false });
      return;
    }
    var key = location.hash.slice(HASH.length);
    if (findDoc(key)) this.open(key);
  };

  // Only what can actually be reached: the contents rail of a document
  // you are not reading is hidden by the stylesheet, and a tab stop you
  // cannot see is worse than no tab stop at all.
  Docs.prototype.focusables = function () {
    var doc = findDoc(this.current);
    var stops = [this.closeButton];
    DOCS.forEach(function (d) { stops.push(d.el.button); });
    if (doc) {
      var links = doc.el.toc.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) stops.push(links[i]);
    }
    stops.push(this.body);
    return stops.filter(Boolean);
  };

  Docs.prototype.open = function (key) {
    var self = this;
    if (!self.isOpen()) {
      // Where to put focus back when this closes.
      self.opener = document.activeElement;
      self.root.hidden = false;
      if (document.exitPointerLock) document.exitPointerLock();
      if (self.onOpen) self.onOpen();
    }
    self.show(key || self.current || DOCS[0].key);
    // The reading pane, not the first link: the first thing anyone
    // wants here is to page through the prose.
    if (self.body.focus) self.body.focus();
  };

  Docs.prototype.close = function (options) {
    options = options || {};
    if (!this.isOpen()) return;
    this.root.hidden = true;
    if (options.hash !== false && location.hash.indexOf(HASH) === 0) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    // Focus must not be left on something now hidden, or it falls to
    // the body and the next Tab starts from the top of the page.
    if (this.opener && this.opener.focus) this.opener.focus();
    this.opener = null;
    if (this.onClose) this.onClose();
  };

  Docs.prototype.toggle = function () {
    if (this.isOpen()) this.close();
    else this.open();
  };

  Docs.prototype.show = function (key) {
    var self = this;
    var doc = findDoc(key);
    if (!doc || this.current === key) return;
    if (this.current) this.scroll[this.current] = this.body.scrollTop;

    this.current = key;
    DOCS.forEach(function (d) {
      d.el.li.classList.toggle('active', d === doc);
      // Colour alone does not say "you are here".
      if (d === doc) d.el.button.setAttribute('aria-current', 'page');
      else d.el.button.removeAttribute('aria-current');
    });
    if (location.hash !== HASH + key) {
      history.replaceState(null, '',
                           location.pathname + location.search + HASH + key);
    }

    if (!this.cache[key]) {
      this.article.innerHTML = '<p class="docs-loading">Loading…</p>';
      fetch(doc.file).then(function (res) {
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        return res.text();
      }).then(function (text) {
        // Cache the work even if the reader has switched away in the
        // meantime; it just is not painted.
        self.cache[key] = Markdown.render(text);
      }).catch(function (e) {
        // Serving the folder is a precondition of the app itself, so
        // this is worth naming rather than blanking.
        self.article.innerHTML =
          '<h1>' + doc.title + '</h1>' +
          '<p class="docs-error">Could not load <code>' + doc.file +
          '</code> — ' + e.message + '.</p>';
        self.setToc(doc, []);
        return;
      }).then(function () {
        if (self.current === key && self.cache[key]) self.paint(doc);
      });
    } else {
      this.paint(doc);
    }
  };

  Docs.prototype.paint = function (doc) {
    this.article.innerHTML = this.cache[doc.key];
    // A table can run wider than the readable measure; it gets its own
    // scroller rather than widening the page.
    var tables = this.article.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var wrap = document.createElement('div');
      wrap.className = 'docs-scroll';
      tables[i].parentNode.replaceChild(wrap, tables[i]);
      wrap.appendChild(tables[i]);
    }
    this.headings = [];
    var hs = this.article.querySelectorAll('h2, h3');
    for (var j = 0; j < hs.length; j++) this.headings.push(hs[j]);
    this.setToc(doc, this.headings);
    this.body.scrollTop = this.scroll[doc.key] || 0;
    this.spy();
  };

  Docs.prototype.setToc = function (doc, headings) {
    // Every list, not just this one: each switch would otherwise leave
    // the outgoing document's entries behind in the tree.
    for (var k = 0; k < DOCS.length; k++) {
      var toc = DOCS[k].el.toc;
      while (toc.firstChild) toc.removeChild(toc.firstChild);
    }
    this.tocLinks = new Map();
    for (var i = 0; i < headings.length; i++) {
      let h = headings[i];
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      a.className = h.tagName === 'H3' ? 'sub' : '';
      a.addEventListener('click', function (e) {
        // The article scrolls inside its own box; letting the browser
        // resolve the fragment would rewrite the hash that names the
        // open document.
        e.preventDefault();
        h.scrollIntoView({ block: 'start' });
      });
      li.appendChild(a);
      toc.appendChild(li);
      this.tocLinks.set(h, a);
    }
  };

  // The heading you are under is the last one that has passed the top
  // of the reading pane.
  Docs.prototype.spy = function () {
    if (!this.headings.length) return;
    var top = this.body.getBoundingClientRect().top + 80;
    var active = this.headings[0];
    for (var i = 0; i < this.headings.length; i++) {
      if (this.headings[i].getBoundingClientRect().top <= top) {
        active = this.headings[i];
      } else {
        break;
      }
    }
    this.tocLinks.forEach(function (a, h) {
      var here = h === active;
      a.classList.toggle('here', here);
      if (here) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  };

  global.Docs = Docs;
}(window));