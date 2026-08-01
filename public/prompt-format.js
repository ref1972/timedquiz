(function () {
  "use strict";

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function format(prompt, highlightedText) {
    var source = String(prompt || "");
    var phrase = String(highlightedText || "");
    var chars = [];
    var italic = false;
    for (var i = 0; i < source.length; i++) {
      if (source[i] === "*" && (italic || source.indexOf("*", i + 1) !== -1)) { italic = !italic; continue; }
      chars.push({ value: source[i], italic: italic, highlighted: false });
    }
    var text = chars.map(function (char) { return char.value; }).join("");
    var lowerText = text.toLocaleLowerCase("en-US");
    var lowerPhrase = phrase.toLocaleLowerCase("en-US");
    if (lowerPhrase) {
      var from = 0;
      var at;
      while ((at = lowerText.indexOf(lowerPhrase, from)) !== -1) {
        for (var j = at; j < at + phrase.length; j++) chars[j].highlighted = true;
        from = at + phrase.length;
      }
    }
    var html = "";
    var openItalic = false;
    var openHighlight = false;
    chars.forEach(function (char) {
      if (char.highlighted !== openHighlight || char.italic !== openItalic) {
        if (openItalic) html += "</em>";
        if (openHighlight) html += "</span>";
        openHighlight = char.highlighted;
        openItalic = char.italic;
        if (openHighlight) html += '<span class="highlighted-text">';
        if (openItalic) html += "<em>";
      }
      html += escapeHtml(char.value);
    });
    if (openItalic) html += "</em>";
    if (openHighlight) html += "</span>";
    return html;
  }

  window.TimedQuizPrompt = { format: format };
})();
