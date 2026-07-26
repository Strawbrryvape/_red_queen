/* Red Queen v2.2 — ui-plus.js
   Enterprise UX layer. Loads AFTER app.js; never modifies it.
   Features: copy-response button, toast notifications, auto-grow
   prompt box with char count, Ctrl+Enter send, document attachments. */
(function () {
  'use strict';

  /* ---------- TOAST ---------- */
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.add('hidden');
    }, 2200);
  }

  /* ---------- COPY RESPONSE (top-right) ---------- */
  var copyBtn = document.getElementById('copyBtn');
  var consensusText = document.getElementById('consensusText');
  var consensusBar = document.getElementById('consensusBar');

  function currentResponse() {
    if (!consensusText || !consensusBar) return '';
    if (consensusBar.classList.contains('is-empty')) return '';
    var t = consensusText.textContent || '';
    return t.trim();
  }

  function refreshCopyBtn() {
    if (!copyBtn) return;
    copyBtn.classList.toggle('hidden', currentResponse().length === 0);
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var t = currentResponse();
      if (!t) { toast('Nothing to copy yet'); return; }
      copyText(t).then(
        function () { toast('Response copied'); },
        function () { toast('Copy failed — long-press to select'); }
      );
    });
  }

  /* Watch the consensus bar for any text/state change and toggle the button. */
  if (consensusBar && window.MutationObserver) {
    new MutationObserver(refreshCopyBtn).observe(consensusBar, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class']
    });
  }
  refreshCopyBtn();

  /* ---------- PROMPT BOX: auto-grow + char count + Ctrl+Enter ---------- */
  var queryInput = document.getElementById('queryInput');
  var charCount = document.getElementById('charCount');
  var sendBtn = document.getElementById('sendBtn');

  function autoGrow() {
    if (!queryInput) return;
    queryInput.style.height = 'auto';
    var max = Math.round(window.innerHeight * 0.4);
    var next = Math.min(queryInput.scrollHeight, Math.max(max, 140));
    queryInput.style.height = Math.max(next, 140) + 'px';
  }

  function updateCount() {
    if (!queryInput || !charCount) return;
    var n = queryInput.value.length;
    charCount.textContent = n.toLocaleString() + (n === 1 ? ' char' : ' chars');
  }

  if (queryInput) {
    queryInput.addEventListener('input', function () { autoGrow(); updateCount(); });
    queryInput.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && sendBtn) {
        e.preventDefault();
        sendBtn.click();
      }
    });
    autoGrow();
    updateCount();
  }

  /* ---------- DOCUMENT ATTACHMENTS ---------- */
  var dropZone = document.getElementById('dropZone');
  var fileInput = document.getElementById('fileInput');
  var attachmentList = document.getElementById('attachmentList');
  var MAX_FILE_BYTES = 512 * 1024; /* 512 KB per file — prompts have budgets */
  var MAX_FILES = 5;
  /* Total budget for the injected bundle. 512KB x 5 files could put ~2.5MB into
     queryInput.value, and app.js stores the RAW prompt in the browser ledger
     (localStorage, 200 entries, ~5MB quota) — two such rounds would blow the
     quota and kill council memory. It would also be sent verbatim to every seat.
     Supabase is safe either way: rq_events clips the prompt to 900 chars. */
  var MAX_BUNDLE_CHARS = 24000;
  var attachments = []; /* {name, size, content} */

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderAttachments() {
    if (!attachmentList) return;
    attachmentList.innerHTML = '';
    attachmentList.classList.toggle('hidden', attachments.length === 0);
    attachments.forEach(function (att, i) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.className = 'att-name';
      name.textContent = att.name;
      var size = document.createElement('span');
      size.className = 'att-size';
      size.textContent = fmtBytes(att.size);
      var rm = document.createElement('button');
      rm.className = 'att-remove';
      rm.setAttribute('aria-label', 'Remove ' + att.name);
      rm.textContent = '×';
      rm.addEventListener('click', function () {
        attachments.splice(i, 1);
        renderAttachments();
        toast(att.name + ' removed');
      });
      li.appendChild(name);
      li.appendChild(size);
      li.appendChild(rm);
      attachmentList.appendChild(li);
    });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    files.slice(0, MAX_FILES - attachments.length).forEach(function (file) {
      if (file.size > MAX_FILE_BYTES) {
        toast(file.name + ' is over 512 KB — skipped');
        return;
      }
      readFile(file).then(function (content) {
        attachments.push({ name: file.name, size: file.size, content: content });
        renderAttachments();
        toast(file.name + ' attached');
      }, function () {
        toast('Could not read ' + file.name);
      });
    });
    if (attachments.length + files.length > MAX_FILES) {
      toast('Max ' + MAX_FILES + ' attachments');
    }
  }

  /* On send: prepend attachments to the query so app.js picks them up
     through the existing #queryInput value — no app.js changes needed. */
  function injectAttachments() {
    if (!queryInput || attachments.length === 0) return;
    var bundle = attachments.map(function (att) {
      return '--- ATTACHED DOCUMENT: ' + att.name + ' ---\n' + att.content.trim() + '\n--- END ATTACHMENT ---';
    }).join('\n\n');
    if (bundle.length > MAX_BUNDLE_CHARS) {
      bundle = bundle.slice(0, MAX_BUNDLE_CHARS) +
        '\n--- ATTACHMENT TRUNCATED at ' + MAX_BUNDLE_CHARS + ' chars ---';
      toast('Attachments truncated to ' + Math.round(MAX_BUNDLE_CHARS / 1000) + 'k chars');
    }
    queryInput.value = bundle + '\n\nOPERATOR QUERY:\n' + queryInput.value;
    attachments = [];
    renderAttachments();
    autoGrow();
    updateCount();
  }

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', function () { fileInput.click(); });
    dropZone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener('change', function () {
      addFiles(fileInput.files);
      fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropZone.addEventListener(ev, function (e) {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropZone.addEventListener(ev, function (e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
      });
    });
    dropZone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', injectAttachments, true); /* capture phase: run before app.js handler */
  }
})();
