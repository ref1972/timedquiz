(function () {
  "use strict";
  var root = document.querySelector("#app");
  var state = null;
  var sequence = 0;
  var tickTimer = null;
  var draftTimer = null;
  var themeToggle = document.querySelector("#themeToggle");

  function currentTheme() {
    return document.documentElement.dataset.theme || "light";
  }

  function updateThemeButton() {
    if (themeToggle) themeToggle.textContent = currentTheme() === "dark" ? "Light mode" : "Dark mode";
  }

  if (themeToggle) {
    updateThemeButton();
    themeToggle.onclick = function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("pcb-theme", next); } catch (e) {}
      updateThemeButton();
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function api(url, body) {
    return fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || "Request failed");
        return data;
      });
    });
  }

  function load() {
    clearInterval(tickTimer);
    return api("/api/state")
      .then(function (data) {
        state = data;
        render();
      })
      .catch(function (e) {
        root.innerHTML =
          "<h1>Unable to load</h1><p>" + escapeHtml(e.message) + "</p><button id=\"retry\">Try again</button>";
        document.querySelector("#retry").onclick = load;
      });
  }

  function render() {
    if (state.state === "closed") {
      root.innerHTML =
        '<p class="eyebrow">Trivia Nationals</p><h1>The entry window has closed</h1><p>New attempts can no longer be started. If you were already in progress, contact Trivia Nationals.</p>';
    } else if (state.state === "prestart") {
      var intro = state.intro || {};
      root.innerHTML =
        '<p class="eyebrow">' + escapeHtml(intro.eyebrow || "Trivia Nationals") + '</p><h1>' + escapeHtml(intro.title || "Pop Culture Bee Preliminary") + '</h1>' +
        '<p>' + escapeHtml(intro.instructions || ("You will answer " + state.questionCount + " text questions, one at a time. Each question has " + state.durationSeconds + " seconds.")) + '</p>' +
        '<p>' + escapeHtml(intro.advancement || "You will not see correctness or a score. Your result determines whether you advance to the LIVE game Saturday.") + '</p>' +
        '<button id="start">' + escapeHtml(intro.buttonLabel || "I’m ready to begin") + '</button>';
      document.querySelector("#start").onclick = ready;
    } else if (state.state === "ready") {
      root.innerHTML = '<div class="play-stage">' +
        '<p class="eyebrow">Question ' +
        state.nextPosition +
        ' of 50</p><p class="category">' + escapeHtml(state.category || "Pop Culture") + '</p>' +
        '<div class="prompt-stage ready-copy"><div><h1>Ready?</h1><p>Your ' + escapeHtml(state.durationSeconds) + ' seconds begin the moment the question appears.</p></div></div>' +
        '<div class="answer-zone ready-action"><button id="readyBtn" class="submit-answer">Show question</button></div><p class="muted save-status" aria-hidden="true">&nbsp;</p></div>';
      document.querySelector("#readyBtn").onclick = ready;
    } else if (state.state === "complete") {
      root.innerHTML =
        '<p class="eyebrow">Finished</p><h1>Thank you!</h1><p>Your score determines whether you advance to the LIVE Pop Culture Bee game on Saturday. Trivia Nationals will announce results separately.</p>';
    } else {
      showQuestion();
    }
  }

  function ready() {
    // `this` is the actual button that was clicked (assigned via
    // `.onclick = ready`) -- not document.querySelector("button"), which
    // would return the theme toggle instead, since it appears earlier in
    // the DOM than anything inside #app, and permanently disable it after
    // the first Ready click of the session.
    var button = this;
    button.disabled = true;
    api("/api/ready", {})
      .then(function (data) {
        state = data;
        render();
      })
      .catch(function (e) {
        alert(e.message);
        button.disabled = false;
      });
  }

  function showQuestion() {
    sequence = 0;
    // The deadline came from the server in this exact response (a fresh
    // Ready serve) or from a prior one (resuming after a refresh) -- either
    // way it is always the true, authoritative deadline, never a locally
    // guessed one.
    //
    // The device clock is used only to measure elapsed time forward from the
    // moment this response arrived, never to decide what time it is now: a
    // phone running minutes fast or slow would otherwise read the absolute
    // deadline as long past (auto-submitting all 50 answers blank) or far
    // away. `skew` converts local time to server time; it also absorbs this
    // response's transit, which can only ever be in the player's favor and is
    // far inside the server's own grace allowance.
    var deadline = new Date(state.deadlineAt).getTime();
    var serverNow = state.serverNow ? new Date(state.serverNow).getTime() : NaN;
    var skew = isFinite(serverNow) ? Date.now() - serverNow : 0;
    root.innerHTML = '<div class="play-stage">' +
      '<div class="quizhead"><span>Question ' +
      state.position +
      ' of 50</span><strong id="clock">' + Number(state.durationSeconds || 30).toFixed(1) + '</strong></div>' +
      '<p class="category">' + escapeHtml(state.category || "Pop Culture") + '</p>' +
      '<div class="prompt-stage"><h1 class="prompt">' +
      window.TimedQuizPrompt.format(state.prompt, state.highlightedText) +
      '</h1></div><form id="answerForm" class="answer-zone"><label for="answer">Your answer</label>' +
      '<input id="answer" maxlength="500" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="' +
      escapeHtml(state.draft || "") +
      '"><button class="submit-answer">Submit Answer</button></form>' +
      '<p id="saveStatus" class="muted save-status">Your draft saves automatically.</p></div>';

    window.TimedQuizPrompt.fit();

    var input = document.querySelector("#answer");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    api("/api/displayed", { nonce: state.nonce }).catch(function () {});

    input.addEventListener("input", function () {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(saveDraft, 350);
    });
    document.querySelector("#answerForm").onsubmit = function (e) {
      e.preventDefault();
      submit();
    };

    function tick() {
      var left = Math.max(0, deadline - (Date.now() - skew));
      var clock = document.querySelector("#clock");
      if (clock) clock.textContent = (left / 1000).toFixed(1);
      if (left <= 0) {
        clearInterval(tickTimer);
        submit();
      }
    }
    tick();
    tickTimer = setInterval(tick, 100);
  }

  window.addEventListener("resize", window.TimedQuizPrompt.fit);

  function saveDraft() {
    sequence++;
    var input = document.querySelector("#answer");
    if (!input) return;
    api("/api/draft", { nonce: state.nonce, sequence: sequence, text: input.value })
      .then(function () {
        var s = document.querySelector("#saveStatus");
        if (s) s.textContent = "Draft saved.";
      })
      .catch(function () {});
  }

  function submit() {
    clearInterval(tickTimer);
    clearTimeout(draftTimer);
    var input = document.querySelector("#answer");
    var text = input ? input.value : "";
    root.querySelectorAll("button, input").forEach(function (x) {
      x.disabled = true;
    });
    api("/api/submit", { nonce: state.nonce, text: text })
      .then(load)
      .catch(function (e) {
        root.querySelectorAll("button, input").forEach(function (x) {
          x.disabled = false;
        });
        alert(e.message);
      });
  }

  load();
})();
