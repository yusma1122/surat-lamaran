/**
 * letter-generator.js
 * -------------------------------------------------------------
 * Bertanggung jawab atas:
 *   1. Menyusun isi surat lamaran (teks + tata letak) dari data formulir.
 *   2. Menghasilkan "model surat" berupa daftar blok yang netral terhadap
 *      media. Model yang sama dipakai oleh pratinjau (DOM) dan oleh
 *      pembuat PDF (jsPDF) sehingga hasilnya konsisten.
 *   3. Merender model ke elemen DOM dengan aman (hanya textContent).
 *
 * Tidak ada akses ke formulir, localStorage, maupun library PDF di sini.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api; // dipakai saat pengujian di Node
  } else {
    root.LetterGenerator = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------
   * Konstanta
   * ------------------------------------------------------------- */

  /** Ukuran kertas A4 dan margin dokumen (satuan: milimeter). */
  var PAGE = Object.freeze({
    width: 210,
    height: 297,
    marginX: 25,
    marginTop: 20,
    marginBottom: 20
  });

  /** Warna aksen (hanya untuk garis pada template Profesional Modern). */
  var ACCENT = '#1e3a8a';

  var MONTHS = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  var ALLOWED = {
    template: ['classic', 'modern'],
    fontFamily: ['arial', 'times'],
    fontSize: [11, 12],
    lineHeight: [1.15, 1.3, 1.5]
  };

  var DEFAULT_SETTINGS = Object.freeze({
    template: 'classic',
    fontFamily: 'arial',
    fontSize: 12,
    lineHeight: 1.3
  });

  var FONT_STACKS = {
    arial: 'Arial, Helvetica, "Liberation Sans", sans-serif',
    times: '"Times New Roman", Times, "Liberation Serif", serif'
  };

  var PLACEHOLDERS = {
    fullName: '[Nama Lengkap]',
    position: '[Posisi yang Dilamar]',
    company: '[Nama Perusahaan]',
    letterDate: '[Tanggal Surat]'
  };

  /* ---------------------------------------------------------------
   * Utilitas teks dan tanggal
   * ------------------------------------------------------------- */

  function isValidIsoDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) { return false; }
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
  }

  /** "2026-10-14" -> "14 Oktober 2026" */
  function formatDateIndonesian(isoDate) {
    if (!isValidIsoDate(isoDate)) { return ''; }
    var parts = isoDate.split('-');
    return Number(parts[2]) + ' ' + MONTHS[Number(parts[1]) - 1] + ' ' + parts[0];
  }

  /** Normalisasi newline, spasi ganda, dan karakter kontrol. */
  function normalizeText(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[ \t ]+/g, ' ');
  }

  /** Satu baris tunggal (newline diubah menjadi spasi). */
  function toSingleLine(value) {
    return normalizeText(value).replace(/\s*\n\s*/g, ' ').trim();
  }

  /** Daftar baris tidak kosong. */
  function toLines(value) {
    return normalizeText(value)
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  }

  function pickAllowed(value, allowed, fallback) {
    var candidate = typeof allowed[0] === 'number' ? Number(value) : String(value);
    return allowed.indexOf(candidate) !== -1 ? candidate : fallback;
  }

  function normalizeSettings(settings) {
    var input = settings || {};
    return {
      template: pickAllowed(input.template, ALLOWED.template, DEFAULT_SETTINGS.template),
      fontFamily: pickAllowed(input.fontFamily, ALLOWED.fontFamily, DEFAULT_SETTINGS.fontFamily),
      fontSize: pickAllowed(input.fontSize, ALLOWED.fontSize, DEFAULT_SETTINGS.fontSize),
      lineHeight: pickAllowed(input.lineHeight, ALLOWED.lineHeight, DEFAULT_SETTINGS.lineHeight)
    };
  }

  /* ---------------------------------------------------------------
   * Pembuat blok
   *
   * Satuan jarak `before` / `after` / `lines` adalah "baris" dengan
   * tinggi = ukuran font dasar x jarak antarbaris.
   * ------------------------------------------------------------- */

  function textBlock(text, options) {
    return Object.assign({
      kind: 'text',
      text: text,
      align: 'left',     // left | right | justify
      bold: false,
      scale: 1,          // pengali ukuran font dasar
      indent: 0,         // mm dari margin kiri
      before: 0,
      after: 0,
      keepWithNext: false
    }, options || {});
  }

  function dataListBlock(items, options) {
    return Object.assign({
      kind: 'datalist',
      items: items,      // [{ label, value, bold }]
      labelWidth: 28,    // mm
      colon: true,       // tampilkan ":" setelah label
      indent: 0,
      before: 0,
      after: 0,
      keepWithNext: false
    }, options || {});
  }

  /** Daftar bernomor (mis. lampiran): "1.  Fotokopi KTP". */
  function numberedListBlock(texts, options) {
    var items = texts.map(function (text, index) {
      return { label: (index + 1) + '.', value: text, bold: false };
    });
    return dataListBlock(items, Object.assign({ labelWidth: 7, colon: false }, options || {}));
  }

  function ruleBlock(options) {
    return Object.assign({
      kind: 'rule',
      color: ACCENT,
      thickness: 0.6,    // mm
      before: 0,
      after: 0,
      keepWithNext: false
    }, options || {});
  }

  function spacerBlock(lines, options) {
    return Object.assign({
      kind: 'spacer',
      lines: lines,
      before: 0,
      after: 0,
      keepWithNext: false
    }, options || {});
  }

  /* ---------------------------------------------------------------
   * Teks surat (template kalimat yang dapat dimodifikasi)
   * ------------------------------------------------------------- */

  var TEXT_TEMPLATES = {
    greeting: 'Dengan hormat,',
    recipientTitle: 'Yth. Bagian Personalia (HRD)',
    recipientInPlace: 'di Tempat',
    identityIntro: 'Adapun data diri saya adalah sebagai berikut:',
    identityNote: 'Data diri dan kontak saya tercantum pada bagian atas surat ini.',
    closingSalutation: 'Hormat saya,',
    attachmentsIntro: 'Sebagai kelengkapan, bersama surat ini saya lampirkan:',
    opening: function (position, company) {
      return 'Dengan surat ini, saya mengajukan lamaran untuk posisi ' +
        position + ' di ' + company + '.';
    },
    qualifications: function () {
      return 'Saya memiliki ketertarikan dan kesungguhan untuk bekerja di bidang ' +
        'yang sesuai dengan posisi tersebut. Uraian lebih lengkap mengenai ' +
        'latar belakang pendidikan dan pengalaman saya dapat saya sampaikan ' +
        'lebih lanjut apabila diperlukan.';
    },
    motivation: function (position, company) {
      return 'Posisi ' + position + ' menarik minat saya, dan saya berharap ' +
        'dapat memberikan kontribusi yang baik bagi ' + company + '.';
    },
    closing: function () {
      return 'Demikian surat lamaran ini saya sampaikan. Besar harapan saya ' +
        'untuk dapat diberi kesempatan mengikuti proses seleksi selanjutnya. ' +
        'Atas perhatian dan waktu Bapak/Ibu, saya ucapkan terima kasih.';
    }
  };

  /** Teks buatan pengguna (tiap baris = satu paragraf) atau cadangan umum. */
  function paragraphsOrFallback(userText, fallbackText) {
    var paragraphs = toLines(userText);
    return paragraphs.length ? paragraphs : [fallbackText];
  }

  /* ---------------------------------------------------------------
   * Template surat
   * ------------------------------------------------------------- */

  function recipientBlock(ctx) {
    var lines = [TEXT_TEMPLATES.recipientTitle, ctx.company];
    if (ctx.companyAddressLines.length) {
      lines = lines.concat(ctx.companyAddressLines);
    } else {
      lines.push(TEXT_TEMPLATES.recipientInPlace);
    }
    return textBlock(lines.join('\n'), { after: 1.5 });
  }

  function subjectBlock(ctx) {
    if (!ctx.position) { return null; }
    return dataListBlock([
      { label: 'Perihal', value: 'Lamaran Pekerjaan sebagai ' + ctx.position, bold: true }
    ], { labelWidth: 18, after: 1.5 });
  }

  function paragraphBlocks(list, align, keepLastWithNext) {
    return list.map(function (text, index) {
      return textBlock(text, {
        align: align,
        after: 1,
        keepWithNext: !!keepLastWithNext && index === list.length - 1
      });
    });
  }

  function compact(blocks) {
    return blocks.filter(Boolean);
  }

  /** Daftar lampiran (opsional): tidak ditampilkan bila kosong. */
  function attachmentBlocks(ctx) {
    if (!ctx.attachments.length) { return []; }
    return [
      textBlock(TEXT_TEMPLATES.attachmentsIntro, { after: 0.5, keepWithNext: true }),
      numberedListBlock(ctx.attachments, { after: 1, indent: 4 })
    ];
  }

  /** Template 1: Formal Klasik. */
  function buildClassicBlocks(ctx) {
    var identityItems = [{ label: 'Nama', value: ctx.name, bold: false }];
    if (ctx.addressLines.length) {
      identityItems.push({ label: 'Alamat', value: ctx.addressLines.join(', '), bold: false });
    }
    if (ctx.email) { identityItems.push({ label: 'Email', value: ctx.email, bold: false }); }
    if (ctx.phone) { identityItems.push({ label: 'No. Telepon', value: ctx.phone, bold: false }); }

    return compact([
      ctx.dateline ? textBlock(ctx.dateline, { align: 'right', after: 1.5 }) : null,
      subjectBlock(ctx),
      recipientBlock(ctx),
      textBlock(TEXT_TEMPLATES.greeting, { after: 1, keepWithNext: true })
    ])
      .concat(paragraphBlocks(ctx.openingParagraphs, 'justify'))
      .concat([
        textBlock(TEXT_TEMPLATES.identityIntro, { after: 0.5, keepWithNext: true }),
        dataListBlock(identityItems, { after: 1, indent: 0 })
      ])
      .concat(paragraphBlocks(ctx.qualificationParagraphs, 'justify'))
      .concat(paragraphBlocks(ctx.motivationParagraphs, 'justify'))
      .concat(attachmentBlocks(ctx))
      .concat(paragraphBlocks(ctx.closingParagraphs, 'justify', true))
      .concat([
        textBlock(TEXT_TEMPLATES.closingSalutation, { align: 'right', keepWithNext: true }),
        spacerBlock(4, { keepWithNext: true }),
        textBlock(ctx.name, { align: 'right', bold: true })
      ]);
  }

  /** Template 2: Profesional Modern. */
  function buildModernBlocks(ctx) {
    var header = [textBlock(ctx.name, { bold: true, scale: 1.6, after: 0.3 })];

    var contactLines = [];
    if (ctx.addressLines.length) { contactLines.push(ctx.addressLines.join(', ')); }
    var contactParts = [ctx.email, ctx.phone].filter(Boolean);
    if (contactParts.length) { contactLines.push(contactParts.join('  |  ')); }
    if (contactLines.length) {
      header.push(textBlock(contactLines.join('\n'), { scale: 0.9, after: 0.6 }));
    }
    header.push(ruleBlock({ after: 1.5 }));

    var openingBlocks = paragraphBlocks(ctx.openingParagraphs, 'left');
    if (contactLines.length) {
      openingBlocks.push(textBlock(TEXT_TEMPLATES.identityNote, { after: 1 }));
    }

    return header
      .concat(compact([
        ctx.dateline ? textBlock(ctx.dateline, { after: 1.5 }) : null,
        recipientBlock(ctx),
        subjectBlock(ctx),
        textBlock(TEXT_TEMPLATES.greeting, { after: 1, keepWithNext: true })
      ]))
      .concat(openingBlocks)
      .concat(paragraphBlocks(ctx.qualificationParagraphs, 'left'))
      .concat(paragraphBlocks(ctx.motivationParagraphs, 'left'))
      .concat(attachmentBlocks(ctx))
      .concat(paragraphBlocks(ctx.closingParagraphs, 'left', true))
      .concat([
        textBlock(TEXT_TEMPLATES.closingSalutation, { keepWithNext: true }),
        spacerBlock(4, { keepWithNext: true }),
        textBlock(ctx.name, { bold: true })
      ]);
  }

  /* ---------------------------------------------------------------
   * API utama: data formulir -> model surat
   * ------------------------------------------------------------- */

  /**
   * @param {Object} data      Data formulir (string semua).
   * @param {Object} settings  Pengaturan tampilan (template, font, dst).
   * @param {Object} [options] { usePlaceholders: boolean } — hanya untuk pratinjau.
   * @returns {{settings:Object, page:Object, accent:string, blocks:Array}}
   */
  function buildLetter(data, settings, options) {
    var usePlaceholders = !!(options && options.usePlaceholders);
    var input = data || {};
    var normalized = normalizeSettings(settings);

    var name = toSingleLine(input.fullName) || (usePlaceholders ? PLACEHOLDERS.fullName : '');
    var position = toSingleLine(input.position) || (usePlaceholders ? PLACEHOLDERS.position : '');
    var company = toSingleLine(input.company) || (usePlaceholders ? PLACEHOLDERS.company : '');
    var dateText = formatDateIndonesian(input.letterDate) ||
      (usePlaceholders ? PLACEHOLDERS.letterDate : '');
    var city = toSingleLine(input.city);

    var ctx = {
      name: name,
      position: position,
      company: company,
      addressLines: toLines(input.address),
      email: toSingleLine(input.email),
      phone: toSingleLine(input.phone),
      companyAddressLines: toLines(input.companyAddress),
      attachments: toLines(input.attachments).map(function (line) {
        // Hapus penanda daftar yang diketik sendiri ("-", "•", "1.", "2)").
        return line.replace(/^(?:[-•*]|\d+[.)])\s*/, '');
      }).filter(Boolean),
      dateline: [city, dateText].filter(Boolean).join(', '),
      openingParagraphs: paragraphsOrFallback(
        input.openingParagraph, TEXT_TEMPLATES.opening(position, company)),
      qualificationParagraphs: paragraphsOrFallback(
        input.qualifications, TEXT_TEMPLATES.qualifications()),
      motivationParagraphs: paragraphsOrFallback(
        input.motivation, TEXT_TEMPLATES.motivation(position, company)),
      closingParagraphs: paragraphsOrFallback(
        input.closingParagraph, TEXT_TEMPLATES.closing())
    };

    var blocks = normalized.template === 'modern'
      ? buildModernBlocks(ctx)
      : buildClassicBlocks(ctx);

    return { settings: normalized, page: PAGE, accent: ACCENT, blocks: blocks };
  }

  /* ---------------------------------------------------------------
   * Render model -> DOM (aman: hanya textContent, tanpa innerHTML)
   * ------------------------------------------------------------- */

  function lineUnits(count) {
    return 'calc(var(--lh) * ' + count + ')';
  }

  function applySpacing(element, block) {
    if (block.before) { element.style.paddingTop = lineUnits(block.before); }
    if (block.after) { element.style.paddingBottom = lineUnits(block.after); }
    if (block.keepWithNext) { element.classList.add('keep-next'); }
  }

  function renderTextBlock(block) {
    var element = document.createElement('p');
    element.className = 'l-text';
    element.textContent = block.text;
    element.style.textAlign = block.align;
    if (block.bold) { element.style.fontWeight = '700'; }
    if (block.scale !== 1) { element.style.fontSize = block.scale + 'em'; }
    if (block.indent) { element.style.marginLeft = block.indent + 'mm'; }
    applySpacing(element, block);
    return element;
  }

  function renderDataListBlock(block) {
    var element = document.createElement('div');
    element.className = 'l-datalist';
    element.style.gridTemplateColumns = block.colon
      ? block.labelWidth + 'mm 4mm minmax(0, 1fr)'
      : block.labelWidth + 'mm minmax(0, 1fr)';
    if (block.indent) { element.style.marginLeft = block.indent + 'mm'; }
    block.items.forEach(function (item) {
      var label = document.createElement('span');
      label.textContent = item.label;
      var value = document.createElement('span');
      value.textContent = item.value;
      if (item.bold) { value.style.fontWeight = '700'; }
      element.appendChild(label);
      if (block.colon) {
        var colon = document.createElement('span');
        colon.textContent = ':';
        element.appendChild(colon);
      }
      element.appendChild(value);
    });
    applySpacing(element, block);
    return element;
  }

  function renderRuleBlock(block) {
    var wrapper = document.createElement('div');
    wrapper.className = 'l-rule-wrap';
    var line = document.createElement('div');
    line.className = 'l-rule';
    line.style.height = block.thickness + 'mm';
    line.style.backgroundColor = block.color;
    wrapper.appendChild(line);
    applySpacing(wrapper, block);
    return wrapper;
  }

  function renderSpacerBlock(block) {
    var element = document.createElement('div');
    element.className = 'l-spacer';
    element.style.height = lineUnits(block.lines);
    applySpacing(element, block);
    return element;
  }

  var RENDERERS = {
    text: renderTextBlock,
    datalist: renderDataListBlock,
    rule: renderRuleBlock,
    spacer: renderSpacerBlock
  };

  /** Menampilkan model surat pada elemen halaman A4. */
  function renderLetter(model, pageElement) {
    var settings = model.settings;
    var page = model.page;

    pageElement.textContent = '';
    pageElement.className = 'letter-page template-' + settings.template;
    pageElement.style.width = page.width + 'mm';
    pageElement.style.minHeight = page.height + 'mm';
    pageElement.style.padding = page.marginTop + 'mm ' + page.marginX + 'mm ' +
      page.marginBottom + 'mm';
    pageElement.style.fontFamily = FONT_STACKS[settings.fontFamily];
    pageElement.style.fontSize = settings.fontSize + 'pt';
    pageElement.style.lineHeight = String(settings.lineHeight);
    pageElement.style.setProperty('--lh', (settings.fontSize * settings.lineHeight) + 'pt');

    var fragment = document.createDocumentFragment();
    model.blocks.forEach(function (block) {
      var render = RENDERERS[block.kind];
      if (render) { fragment.appendChild(render(block)); }
    });
    pageElement.appendChild(fragment);
  }

  return {
    PAGE: PAGE,
    ACCENT: ACCENT,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    ALLOWED: ALLOWED,
    FONT_STACKS: FONT_STACKS,
    isValidIsoDate: isValidIsoDate,
    formatDateIndonesian: formatDateIndonesian,
    normalizeSettings: normalizeSettings,
    buildLetter: buildLetter,
    renderLetter: renderLetter
  };
}));
