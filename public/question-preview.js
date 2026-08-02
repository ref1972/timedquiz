(function () {
  "use strict";
  var data = JSON.parse(document.querySelector("#previewData").textContent);
  var themeToggle = document.querySelector("#themeToggle");
  function currentTheme() { return document.documentElement.dataset.theme || "light"; }
  function updateThemeButton() { themeToggle.textContent = currentTheme() === "dark" ? "Light mode" : "Dark mode"; }
  updateThemeButton();
  themeToggle.onclick = function () {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pcb-theme", next); } catch (e) {}
    updateThemeButton();
  };
  document.querySelector("#previewPrompt").innerHTML = window.TimedQuizPrompt.format(data.prompt, data.highlightedText);
  window.TimedQuizPrompt.fit();
  window.addEventListener("resize", window.TimedQuizPrompt.fit);
})();
