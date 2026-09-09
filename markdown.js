// Markdown → HTML, for rendering the README inside the app.
//
// Deliberately not a CommonMark parser: it handles what README.md and
// friends actually contain (ATX headings, fenced code, GFM tables,
// simple lists with wrapped continuation lines, blockquotes, rules,
// and the inline run of code/emphasis/links), and nothing else.
//
// Everything is escaped up front, before any rule runs. That ordering
// is the safety story: no document, and nothing a document links to,
// can put markup into the page.

(function (global) {
  'use strict';

  var ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) { return ESCAPE[c]; });
  }

  // Headings become anchors for the table of contents, so the slug has
  // to survive punctuation real headings carry.
  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/&[a-z]+;/g, ' ')
      .replace(/[`*[\]()]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // A character no document can contain: it is stripped from the source
  // before parsing, so a code span standing in as one cannot be forged.
  var MARK = '\u0000';

  // Code spans are pulled out before inline rules so `**not bold**`
  // stays literal, then put back last.
  function inline(text) {
    var spans = [];
    var s = text.replace(/`([^`]+)`/g, function (match, code) {
      spans.push(code);
      return MARK + String(spans.length - 1) + MARK;
    });
    // <http://...> autolinks, already escaped to an entity by now.
    s = s.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g,
                  '<a href="$1">$1</a>');
    // A target containing a space is not a link; leaving it as text is
    // what keeps a quote from breaking out of the attribute.
    s = s.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return s.replace(new RegExp(MARK + '(\\d+)' + MARK, 'g'),
                     function (match, n) {
                       return '<code>' + spans[Number(n)] + '</code>';
                     });
  }

  var RE = {
    fence: /^```/,
    heading: /^(#{1,6}) +(.*)$/,
    rule: /^(-{3,}|\*{3,}|_{3,})\s*$/,
    bullet: /^ *([-*]) +(.*)$/,
    number: /^ *\d+\. +(.*)$/,
    // Escaping precedes the block rules, so a blockquote marker arrives
    // as an entity, not as the character it was written as.
    quote: /^ *&gt; ?(.*)$/,
    align: /^\|[ :|-]+\|\s*$/
  };

  // Where a paragraph or a list item has to stop.
  function startsBlock(line, next) {
    return RE.fence.test(line) || RE.heading.test(line) ||
      RE.rule.test(line) || RE.bullet.test(line) ||
      RE.number.test(line) || RE.quote.test(line) ||
      (line.startsWith('|') && RE.align.test(next || ''));
  }

  function cells(row) {
    return row.replace(/^\|/, '').replace(/\|\s*$/, '').split('|')
      .map(function (c) { return c.trim(); });
  }

  function render(md) {
    var lines = escapeHtml(md.replace(/\r\n?/g, '\n').split(MARK).join(''))
      .split('\n');
    var out = [];
    var seen = new Map();
    var i = 0;

    // Two headings can share a slug ("Notes" under different sections);
    // numbering the repeats keeps every anchor reachable.
    function uniqueId(text) {
      var base = slugify(text) || 'section';
      var n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return n === 1 ? base : base + '-' + n;
    }

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      if (RE.fence.test(line)) {
        // The opening fence's language tag is dropped: it names a
        // highlighter this viewer does not have.
        var body = [];
        i++;
        while (i < lines.length && !RE.fence.test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        i++; // the closing fence
        out.push('<pre><code>' + body.join('\n') + '</code></pre>');
        continue;
      }

      var heading = line.match(RE.heading);
      if (heading) {
        var level = heading[1].length;
        var text = heading[2].trim();
        out.push('<h' + level + ' id="' + uniqueId(text) + '">' +
                 inline(text) + '</h' + level + '>');
        i++;
        continue;
      }

      if (RE.rule.test(line)) { out.push('<hr>'); i++; continue; }

      if (line.startsWith('|') && RE.align.test(lines[i + 1] || '')) {
        var head = cells(line);
        i += 2; // header and alignment rows
        var body2 = [];
        while (i < lines.length && lines[i].startsWith('|')) {
          body2.push(cells(lines[i]));
          i++;
        }
        var th = head.map(function (c) {
          return '<th>' + inline(c) + '</th>';
        }).join('');
        var rows = body2.map(function (r) {
          return '<tr>' + r.map(function (c) {
            return '<td>' + inline(c) + '</td>';
          }).join('') + '</tr>';
        }).join('');
        out.push('<table><thead><tr>' + th + '</tr></thead>' +
                 '<tbody>' + rows + '</tbody></table>');
        continue;
      }

      if (RE.bullet.test(line) || RE.number.test(line)) {
        var ordered = RE.number.test(line);
        var items = [];
        while (i < lines.length) {
          var cur = lines[i];
          if (!cur.trim()) {
            // A blank line ends the list unless another item of the
            // same kind follows it.
            var j = i + 1;
            while (j < lines.length && !lines[j].trim()) j++;
            var same = j < lines.length &&
              (ordered ? RE.number : RE.bullet).test(lines[j]);
            if (!same) break;
            i = j;
            continue;
          }
          var b = cur.match(ordered ? RE.number : RE.bullet);
          if (b) {
            items.push(ordered ? b[1] : b[2]);
          } else if (items.length && !startsBlock(cur, lines[i + 1])) {
            // A wrapped item: the docs indent the rest of a sentence
            // under its bullet.
            items[items.length - 1] += ' ' + cur.trim();
          } else break;
          i++;
        }
        var tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' +
                 items.map(function (t) {
                   return '<li>' + inline(t) + '</li>';
                 }).join('') +
                 '</' + tag + '>');
        continue;
      }

      if (RE.quote.test(line)) {
        var qbody = [];
        while (i < lines.length && RE.quote.test(lines[i])) {
          qbody.push(lines[i].match(RE.quote)[1]);
          i++;
        }
        out.push('<blockquote><p>' + inline(qbody.join('\n')) +
                 '</p></blockquote>');
        continue;
      }

      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !startsBlock(lines[i], lines[i + 1])) {
        para.push(lines[i]);
        i++;
      }
      // A line that only a block rule could have claimed, claimed by
      // nothing: emit it rather than loop forever on it.
      if (!para.length) { para.push(lines[i]); i++; }
      out.push('<p>' + inline(para.join('\n')) + '</p>');
    }

    return out.join('\n');
  }

  global.Markdown = { render: render };
}(window));