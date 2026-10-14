/**
 * app.js
 * -------------------------------------------------------------
 * Pengelola antarmuka: membaca formulir, validasi, live preview,
 * penyimpanan otomatis (localStorage), cetak, unduh PDF, reset,
 * dan notifikasi. Penyusunan surat ada di letter-generator.js dan
 * pembuatan PDF ada di pdf-generator.js.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'jobLetterGenerator:v1:form';
  var AUTOSAVE_PREF_KEY = 'jobLetterGenerator:v1:autosave';
  var SAVE_DELAY_MS = 400;

  var TEXT_FIELDS = [
    'fullName', 'address', 'email', 'phone',
    'position', 'company', 'companyAddress', 'city', 'letterDate',
    'openingParagraph', 'qualifications', 'motivation', 'attachments', 'closingParagraph'
  ];
  var SELECT_SETTINGS = ['fontFamily', 'fontSize', 'lineHeight'];
  var REQUIRED_FIELDS = {
    fullName: 'Nama lengkap',
    position: 'Posisi yang dilamar',
    company: 'Nama perusahaan atau instansi',
    letterDate: 'Tanggal surat'
  };
  /** Field yang memiliki elemen pesan galat (#error-<id>). */
  var VALIDATED_FIELDS = ['fullName', 'email', 'position', 'company', 'letterDate'];

  var TEMPLATE_LABELS = { classic: 'Formal Klasik', modern: 'Profesional Modern' };
  var FONT_LABELS = { arial: 'Arial', times: 'Times New Roman' };

  var els = {};
  var touched = new Set();
  var saveTimer = null;
  var renderQueued = false;
  var isBusy = false;

  /* ---------------------------------------------------------------
   * Utilitas
   * ------------------------------------------------------------- */

  function byId(id) { return document.getElementById(id); }

  function pad(number) { return String(number).padStart(2, '0'); }

  function todayIso() {
    var now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function currentTimeLabel() {
    var now = new Date();
    return pad(now.getHours()) + ':' + pad(now.getMinutes());
  }

  /* ---------------------------------------------------------------
   * Pembacaan & pengisian formulir
   * ------------------------------------------------------------- */

  function getFormData() {
    var data = {};
    TEXT_FIELDS.forEach(function (id) { data[id] = els[id].value; });
    return data;
  }

  function getSettings() {
    var checked = document.querySelector('input[name="template"]:checked');
    var settings = { template: checked ? checked.value : 'classic' };
    SELECT_SETTINGS.forEach(function (id) { settings[id] = els[id].value; });
    return settings;
  }

  function optionExists(select, value) {
    return Array.prototype.some.call(select.options, function (option) {
      return option.value === value;
    });
  }

  function applySettings(settings) {
    if (!settings) { return; }
    var radio = document.querySelector('input[name="template"][value="' + settings.template + '"]');
    if (radio) { radio.checked = true; }
    SELECT_SETTINGS.forEach(function (id) {
      var value = settings[id] === undefined ? '' : String(settings[id]);
      if (optionExists(els[id], value)) { els[id].value = value; }
    });
  }

  function applyFormData(data) {
    if (!data) { return; }
    TEXT_FIELDS.forEach(function (id) {
      if (typeof data[id] === 'string') { els[id].value = data[id]; }
    });
  }

  /* ---------------------------------------------------------------
   * Validasi
   * ------------------------------------------------------------- */

  function validateData(data) {
    var errors = {};
    if (!data.fullName.trim()) { errors.fullName = 'Nama lengkap wajib diisi.'; }
    if (!data.position.trim()) { errors.position = 'Posisi yang dilamar wajib diisi.'; }
    if (!data.company.trim()) { errors.company = 'Nama perusahaan atau instansi wajib diisi.'; }
    if (!data.letterDate) {
      errors.letterDate = 'Tanggal surat wajib diisi.';
    } else if (!LetterGenerator.isValidIsoDate(data.letterDate)) {
      errors.letterDate = 'Tanggal surat tidak valid.';
    }
    var email = data.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Format email tidak valid, contoh: nama@email.com.';
    }
    return errors;
  }

  function showFieldError(id, message) {
    var input = els[id];
    var errorElement = byId('error-' + id);
    if (!input || !errorElement) { return; }
    errorElement.textContent = message || '';
    errorElement.hidden = !message;
    input.classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  /** Menampilkan galat hanya untuk field yang sudah disentuh. */
  function showTouchedErrors() {
    var errors = validateData(getFormData());
    VALIDATED_FIELDS.forEach(function (id) {
      showFieldError(id, touched.has(id) ? errors[id] : '');
    });
    return errors;
  }

  function clearAllErrors() {
    VALIDATED_FIELDS.forEach(function (id) { showFieldError(id, ''); });
  }

  /** Validasi penuh sebelum unduh/cetak: menandai semua field dan fokus ke galat pertama. */
  function validateBeforeAction() {
    VALIDATED_FIELDS.forEach(function (id) { touched.add(id); });
    var errors = showTouchedErrors();
    var firstInvalid = VALIDATED_FIELDS.filter(function (id) { return errors[id]; })[0];
    if (!firstInvalid) { return true; }

    var missing = Object.keys(REQUIRED_FIELDS)
      .filter(function (id) { return errors[id]; })
      .map(function (id) { return REQUIRED_FIELDS[id]; });
    showToast(
      missing.length
        ? 'Lengkapi field wajib terlebih dahulu: ' + missing.join(', ') + '.'
        : errors[firstInvalid],
      'error'
    );
    els[firstInvalid].focus();
    return false;
  }

  function updateStatus() {
    var data = getFormData();
    var errors = validateData(data);
    var requiredIds = Object.keys(REQUIRED_FIELDS);
    var missing = requiredIds.filter(function (id) { return errors[id]; });
    var filled = requiredIds.length - missing.length;

    els.statusCount.textContent = filled + '/' + requiredIds.length;
    els.statusBar.style.width = (filled / requiredIds.length * 100) + '%';
    els.statusCard.classList.toggle('is-complete', missing.length === 0);
    els.statusText.textContent = missing.length === 0
      ? 'Semua field wajib sudah terisi. Surat siap diunduh.'
      : 'Field wajib belum lengkap: ' + missing.map(function (id) {
        return REQUIRED_FIELDS[id];
      }).join(', ') + '.';
  }

  /* ---------------------------------------------------------------
   * Pratinjau
   * ------------------------------------------------------------- */

  function fitPreview() {
    var scroller = els.previewScroll;
    var page = els.letterPage;
    var scaler = els.previewScaler;
    var styles = window.getComputedStyle(scroller);
    var horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    var available = scroller.clientWidth - horizontalPadding;
    var pageWidth = page.offsetWidth;
    if (!pageWidth || available <= 0) { return; }

    var scale = Math.min(1, available / pageWidth);
    page.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
    scaler.style.width = (pageWidth * scale) + 'px';
    scaler.style.height = (page.offsetHeight * scale) + 'px';
  }

  function estimatePageCount(model) {
    var pxPerMm = 96 / 25.4;
    var contentMm = els.letterPage.offsetHeight / pxPerMm -
      model.page.marginTop - model.page.marginBottom;
    var usable = model.page.height - model.page.marginTop - model.page.marginBottom;
    return Math.max(1, Math.ceil((contentMm - 0.5) / usable));
  }

  function updatePreview() {
    var settings = getSettings();
    var model = LetterGenerator.buildLetter(getFormData(), settings, { usePlaceholders: true });
    LetterGenerator.renderLetter(model, els.letterPage);
    fitPreview();

    var pages = estimatePageCount(model);
    els.previewMeta.textContent = 'A4 · ' + TEMPLATE_LABELS[model.settings.template] + ' · ' +
      FONT_LABELS[model.settings.fontFamily] + ' ' + model.settings.fontSize + ' pt · ' +
      pages + ' halaman';
  }

  function scheduleRender() {
    if (renderQueued) { return; }
    renderQueued = true;
    window.requestAnimationFrame(function () {
      renderQueued = false;
      updatePreview();
    });
  }

  /* ---------------------------------------------------------------
   * Penyimpanan lokal
   * ------------------------------------------------------------- */

  function isAutosaveEnabled() { return els.autosaveToggle.checked; }

  function setIndicator(message) { els.saveIndicator.textContent = message; }

  function saveNow() {
    if (!isAutosaveEnabled()) { return; }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        data: getFormData(),
        settings: getSettings()
      }));
      setIndicator('Tersimpan otomatis di browser ini pukul ' + currentTimeLabel() + '.');
    } catch (error) {
      setIndicator('Penyimpanan otomatis tidak tersedia di browser ini (mode privat atau penyimpanan penuh).');
    }
  }

  function scheduleSave() {
    if (!isAutosaveEnabled()) { return; }
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, SAVE_DELAY_MS);
  }

  function readSaved() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) { return null; }
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function readAutosavePreference() {
    try {
      return window.localStorage.getItem(AUTOSAVE_PREF_KEY) !== 'off';
    } catch (error) {
      return true;
    }
  }

  function writeAutosavePreference(enabled) {
    try {
      window.localStorage.setItem(AUTOSAVE_PREF_KEY, enabled ? 'on' : 'off');
    } catch (error) { /* diabaikan */ }
  }

  function removeSaved() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ---------------------------------------------------------------
   * Notifikasi
   * ------------------------------------------------------------- */

  var TOAST_ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  function showToast(message, type) {
    var kind = type || 'info';
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + kind;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    var icon = document.createElement('i');
    icon.className = 'fa-solid ' + TOAST_ICONS[kind];
    icon.setAttribute('aria-hidden', 'true');

    var text = document.createElement('span');
    text.className = 'toast__text';
    text.textContent = message;

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.setAttribute('aria-label', 'Tutup notifikasi');
    close.textContent = '×';

    function dismiss() { if (toast.parentNode) { toast.parentNode.removeChild(toast); } }
    close.addEventListener('click', dismiss);

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(close);
    els.toastRegion.appendChild(toast);
    window.setTimeout(dismiss, kind === 'error' ? 9000 : 5000);
  }

  /* ---------------------------------------------------------------
   * Aksi tombol
   * ------------------------------------------------------------- */

  function setBusy(button, busy) {
    isBusy = busy;
    button.disabled = busy;
    button.classList.toggle('is-loading', busy);
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function buildFinalModel() {
    return LetterGenerator.buildLetter(getFormData(), getSettings(), { usePlaceholders: false });
  }

  function pdfErrorMessage(error) {
    if (error && error.code === 'PDF_LIB_MISSING') {
      return 'Library PDF gagal dimuat (periksa koneksi internet lalu muat ulang halaman). ' +
        'Sementara itu, gunakan "Cetak Surat" lalu pilih "Simpan sebagai PDF".';
    }
    return 'PDF gagal dibuat. Silakan coba lagi atau gunakan "Cetak Surat" > "Simpan sebagai PDF".';
  }

  function handleDownload(button) {
    if (isBusy) { return; }
    if (!validateBeforeAction()) { return; }
    if (typeof PdfGenerator === 'undefined') {
      showToast(pdfErrorMessage({ code: 'PDF_LIB_MISSING' }), 'error');
      return;
    }

    setBusy(button, true);
    var data = getFormData();
    var fileName = PdfGenerator.buildFileName(data.fullName);

    Promise.resolve()
      .then(function () { return PdfGenerator.download(buildFinalModel(), fileName, data.fullName.trim()); })
      .then(function () { showToast('PDF berhasil dibuat: ' + fileName, 'success'); })
      .catch(function (error) {
        if (window.console) { console.error(error); }
        showToast(pdfErrorMessage(error), 'error');
      })
      .then(function () { setBusy(button, false); });
  }

  function handlePrint() {
    if (!validateBeforeAction()) { return; }
    // Render ulang tanpa placeholder agar hasil cetak = surat final.
    LetterGenerator.renderLetter(buildFinalModel(), els.letterPage);
    var restore = function () {
      window.removeEventListener('afterprint', restore);
      updatePreview();
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  function handleReset() {
    if (!window.confirm('Kosongkan seluruh formulir? Data yang sudah Anda isi akan dihapus.')) { return; }
    TEXT_FIELDS.forEach(function (id) { els[id].value = ''; });
    els.letterDate.value = todayIso();
    touched.clear();
    clearAllErrors();
    syncAttachmentChips();
    updateStatus();
    updatePreview();
    saveNow();
    showToast('Formulir telah dikosongkan.', 'success');
    els.fullName.focus();
  }

  function handleClearStorage() {
    if (!window.confirm('Hapus data yang tersimpan di browser ini? Isi formulir yang sedang tampil tidak berubah.')) { return; }
    window.clearTimeout(saveTimer);
    if (removeSaved()) {
      setIndicator(isAutosaveEnabled()
        ? 'Data tersimpan dihapus. Perubahan berikutnya akan disimpan kembali.'
        : 'Data tersimpan dihapus.');
      showToast('Data tersimpan di browser ini telah dihapus.', 'success');
    } else {
      showToast('Tidak dapat mengakses penyimpanan browser.', 'error');
    }
  }

  var ACTIONS = {
    download: handleDownload,
    print: handlePrint,
    reset: handleReset,
    'clear-storage': handleClearStorage
  };

  /* ---------------------------------------------------------------
   * Pilih cepat lampiran
   * ------------------------------------------------------------- */

  function attachmentLines() {
    return els.attachments.value.split('\n').map(function (line) { return line.trim(); });
  }

  /** Menyelaraskan status tombol dengan isi kolom lampiran. */
  function syncAttachmentChips() {
    var lines = attachmentLines();
    Array.prototype.forEach.call(document.querySelectorAll('[data-attachment]'), function (chip) {
      var active = lines.indexOf(chip.getAttribute('data-attachment')) !== -1;
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function toggleAttachment(chip) {
    var item = chip.getAttribute('data-attachment');
    var lines = attachmentLines().filter(Boolean);
    var index = lines.indexOf(item);
    if (index === -1) { lines.push(item); } else { lines.splice(index, 1); }
    els.attachments.value = lines.join('\n');
    // Memicu pembaruan pratinjau, status, dan simpan otomatis.
    els.attachments.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---------------------------------------------------------------
   * Event
   * ------------------------------------------------------------- */

  function onFieldChanged(event) {
    if (event.target === els.attachments) { syncAttachmentChips(); }
    var target = event.target;
    if (target.id && VALIDATED_FIELDS.indexOf(target.id) !== -1 && touched.has(target.id)) {
      showTouchedErrors();
    }
    updateStatus();
    scheduleRender();
    scheduleSave();
  }

  function onFieldBlur(event) {
    var id = event.target.id;
    if (VALIDATED_FIELDS.indexOf(id) !== -1) {
      touched.add(id);
      showTouchedErrors();
    }
  }

  function onAutosaveToggle() {
    var enabled = isAutosaveEnabled();
    writeAutosavePreference(enabled);
    if (enabled) {
      saveNow();
    } else {
      window.clearTimeout(saveTimer);
      setIndicator('Penyimpanan otomatis dimatikan. Data yang sudah tersimpan tetap ada sampai Anda menghapusnya.');
    }
  }

  function bindEvents() {
    var form = byId('letter-form');
    form.addEventListener('input', onFieldChanged);
    form.addEventListener('change', onFieldChanged);
    form.addEventListener('focusout', onFieldBlur);
    form.addEventListener('submit', function (event) { event.preventDefault(); });

    els.autosaveToggle.addEventListener('change', onAutosaveToggle);

    document.addEventListener('click', function (event) {
      var chip = event.target.closest ? event.target.closest('[data-attachment]') : null;
      if (chip) { toggleAttachment(chip); return; }
      var button = event.target.closest ? event.target.closest('[data-action]') : null;
      if (!button) { return; }
      var action = ACTIONS[button.getAttribute('data-action')];
      if (action) { action(button); }
    });

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(fitPreview).observe(els.previewScroll);
    } else {
      window.addEventListener('resize', fitPreview);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(updatePreview);
    }
  }

  /* ---------------------------------------------------------------
   * Inisialisasi
   * ------------------------------------------------------------- */

  function cacheElements() {
    TEXT_FIELDS.concat(SELECT_SETTINGS).forEach(function (id) { els[id] = byId(id); });
    els.statusCard = byId('form-status');
    els.statusText = byId('status-text');
    els.statusCount = byId('status-count');
    els.statusBar = byId('status-bar');
    els.saveIndicator = byId('save-indicator');
    els.autosaveToggle = byId('autosaveToggle');
    els.previewScroll = byId('preview-scroll');
    els.previewScaler = byId('preview-scaler');
    els.previewMeta = byId('preview-meta');
    els.letterPage = byId('letter-page');
    els.toastRegion = byId('toast-region');
  }

  function init() {
    if (typeof LetterGenerator === 'undefined') {
      var notice = document.createElement('p');
      notice.className = 'noscript-note';
      notice.textContent = 'Modul penyusun surat (js/letter-generator.js) gagal dimuat. Muat ulang halaman.';
      document.body.insertBefore(notice, document.body.firstChild);
      return;
    }
    cacheElements();
    els.autosaveToggle.checked = readAutosavePreference();

    var saved = readSaved();
    if (saved) {
      applyFormData(saved.data);
      applySettings(saved.settings);
      setIndicator('Data tersimpan sebelumnya telah dipulihkan.');
    }
    if (!els.letterDate.value) { els.letterDate.value = todayIso(); }

    bindEvents();
    syncAttachmentChips();
    updateStatus();
    updatePreview();

    if (saved) { showToast('Data sebelumnya dipulihkan dari browser ini.', 'info'); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
