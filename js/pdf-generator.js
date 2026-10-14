/**
 * pdf-generator.js
 * -------------------------------------------------------------
 * Membuat dan mengunduh PDF A4 langsung di browser memakai jsPDF
 * (tanpa backend). Input-nya adalah "model surat" dari
 * letter-generator.js, sehingga isi dan tata letak PDF sama dengan
 * pratinjau.
 *
 * Mengapa jsPDF (bukan html2pdf.js)?
 *   - Teks digambar sebagai teks asli (tajam, bisa dipilih/disalin),
 *     bukan tangkapan gambar.
 *   - Pemisahan halaman dikendalikan penuh: teks tidak terpotong di
 *     tengah baris dan tidak saling menimpa.
 *   - Hasil tidak bergantung pada ukuran layar atau elemen UI.
 *
 * Font standar PDF dipakai agar file kecil dan konsisten:
 *   Arial -> Helvetica, Times New Roman -> Times (metrik huruf setara).
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api; // dipakai saat pengujian di Node
  } else {
    root.PdfGenerator = api;
  }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var PT_TO_MM = 25.4 / 72;
  var EPSILON = 0.01;
  var FALLBACK_LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
  var LIBRARY_TIMEOUT_MS = 10000;

  /* Karakter di luar WinAnsi tidak didukung font standar PDF. */
  var WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹Œ' +
    'Ž‘’“”•–—˜™š›œžŸ';

  /* ---------------------------------------------------------------
   * Library
   * ------------------------------------------------------------- */

  function getConstructor() {
    if (root.jspdf && root.jspdf.jsPDF) { return root.jspdf.jsPDF; }
    if (root.jsPDF) { return root.jsPDF; }
    return null;
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var timer = setTimeout(function () {
        script.remove();
        reject(new Error('Waktu pemuatan library habis.'));
      }, LIBRARY_TIMEOUT_MS);
      script.src = url;
      script.async = true;
      script.onload = function () { clearTimeout(timer); resolve(); };
      script.onerror = function () {
        clearTimeout(timer);
        script.remove();
        reject(new Error('Library gagal dimuat.'));
      };
      document.head.appendChild(script);
    });
  }

  /** Memastikan jsPDF tersedia; mencoba CDN cadangan bila CDN utama gagal. */
  function ensureLibrary() {
    var existing = getConstructor();
    if (existing) { return Promise.resolve(existing); }
    return loadScript(FALLBACK_LIBRARY_URL)
      .catch(function () { /* ditangani di bawah */ })
      .then(function () {
        var loaded = getConstructor();
        if (!loaded) {
          var error = new Error('Library PDF (jsPDF) tidak dapat dimuat.');
          error.code = 'PDF_LIB_MISSING';
          throw error;
        }
        return loaded;
      });
  }

  /* ---------------------------------------------------------------
   * Nama file dan teks aman
   * ------------------------------------------------------------- */

  /** "Yusma Rahman" -> "Surat_Lamaran_Yusma_Rahman.pdf" */
  function buildFileName(fullName) {
    var cleaned = String(fullName || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60)
      .replace(/_+$/g, '');
    return cleaned ? 'Surat_Lamaran_' + cleaned + '.pdf' : 'Surat_Lamaran.pdf';
  }

  function toPdfSafe(text) {
    return String(text)
      .normalize('NFC')
      .replace(/[​-‍﻿]/g, '')
      .replace(/[^ -~ -ÿ]/g, function (character) {
        return WIN_ANSI_EXTRA.indexOf(character) !== -1 ? character : '?';
      });
  }

  /* ---------------------------------------------------------------
   * Penyusun dokumen
   * ------------------------------------------------------------- */

  function hexToRgb(hex) {
    var match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return match
      ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
      : [0, 0, 0];
  }

  /**
   * Membangun dokumen jsPDF dari model surat.
   * @param {Object} model        Hasil LetterGenerator.buildLetter().
   * @param {Function} JsPdfClass Konstruktor jsPDF.
   */
  function buildDocument(model, JsPdfClass) {
    var page = model.page;
    var settings = model.settings;
    var fontName = settings.fontFamily === 'times' ? 'times' : 'helvetica';
    var baseSize = settings.fontSize;
    var baseLine = baseSize * settings.lineHeight * PT_TO_MM;
    var contentWidth = page.width - page.marginX * 2;
    var contentHeight = page.height - page.marginTop - page.marginBottom;
    var bottomLimit = page.height - page.marginBottom;

    var doc = new JsPdfClass({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: true
    });
    doc.setTextColor(0, 0, 0);

    var cursorY = page.marginTop;
    var atPageTop = true;

    /* ---- pengukuran dan pemotongan baris ---- */

    function useFont(bold, size) {
      doc.setFont(fontName, bold ? 'bold' : 'normal');
      doc.setFontSize(size);
    }

    function measure(text, bold, size) {
      useFont(bold, size);
      return doc.getTextWidth(text);
    }

    /** Memecah satu segmen menjadi baris-baris yang muat dalam `width`. */
    function wrapSegment(text, width, bold, size) {
      var words = toPdfSafe(text).split(/\s+/).filter(Boolean);
      var lines = [];
      var current = '';
      words.forEach(function (word) {
        var candidate = current ? current + ' ' + word : word;
        if (measure(candidate, bold, size) <= width) {
          current = candidate;
          return;
        }
        if (current) { lines.push(current); current = ''; }
        if (measure(word, bold, size) <= width) {
          current = word;
          return;
        }
        // Kata lebih panjang dari lebar baris: pecah per karakter.
        var chunk = '';
        Array.from(word).forEach(function (character) {
          if (chunk && measure(chunk + character, bold, size) > width) {
            lines.push(chunk);
            chunk = character;
          } else {
            chunk += character;
          }
        });
        current = chunk;
      });
      if (current) { lines.push(current); }
      return lines.length ? lines : [''];
    }

    /** Memecah teks (dengan \n sebagai pemisah baris paksa). */
    function wrapText(text, width, bold, size) {
      var result = [];
      String(text).split('\n').forEach(function (segment) {
        var lines = wrapSegment(segment, width, bold, size);
        lines.forEach(function (line, index) {
          result.push({ text: line, endsSegment: index === lines.length - 1 });
        });
      });
      return result;
    }

    /* ---- tata letak per blok ---- */

    function layoutTextBlock(block) {
      var size = baseSize * block.scale;
      var lineHeight = size * settings.lineHeight * PT_TO_MM;
      var width = contentWidth - block.indent;
      var left = page.marginX + block.indent;
      var lines = wrapText(block.text, width, block.bold, size).map(function (line) {
        var justify = block.align === 'justify' && !line.endsSegment;
        return {
          text: line.text,
          x: block.align === 'right' ? left + width : left,
          align: block.align === 'right' ? 'right' : 'left',
          bold: block.bold,
          size: size,
          lineHeight: lineHeight,
          justifyWidth: justify ? width : 0,
          extras: []
        };
      });
      return {
        kind: 'text',
        block: block,
        lines: lines,
        lineHeight: lineHeight,
        before: block.before * baseLine,
        after: block.after * baseLine,
        bodyHeight: lines.length * lineHeight
      };
    }

    function layoutDataList(block) {
      var colonWidth = block.colon ? 4 : 0;
      var left = page.marginX + block.indent;
      var valueX = left + block.labelWidth + colonWidth;
      var valueWidth = contentWidth - block.indent - block.labelWidth - colonWidth;
      var lines = [];
      block.items.forEach(function (item) {
        var wrapped = wrapText(item.value, valueWidth, item.bold, baseSize);
        wrapped.forEach(function (line, index) {
          lines.push({
            text: line.text,
            x: valueX,
            align: 'left',
            bold: item.bold,
            size: baseSize,
            lineHeight: baseLine,
            justifyWidth: 0,
            extras: index === 0
              ? [{ text: toPdfSafe(item.label), x: left, bold: false }].concat(
                block.colon ? [{ text: ':', x: left + block.labelWidth, bold: false }] : []
              )
              : []
          });
        });
      });
      return {
        kind: 'datalist',
        block: block,
        lines: lines,
        lineHeight: baseLine,
        before: block.before * baseLine,
        after: block.after * baseLine,
        bodyHeight: lines.length * baseLine
      };
    }

    function layoutRule(block) {
      return {
        kind: 'rule', block: block, lines: [], lineHeight: 0,
        before: block.before * baseLine, after: block.after * baseLine,
        bodyHeight: block.thickness
      };
    }

    function layoutSpacer(block) {
      return {
        kind: 'spacer', block: block, lines: [], lineHeight: 0,
        before: block.before * baseLine, after: block.after * baseLine,
        bodyHeight: block.lines * baseLine
      };
    }

    function layoutBlock(block) {
      switch (block.kind) {
        case 'datalist': return layoutDataList(block);
        case 'rule': return layoutRule(block);
        case 'spacer': return layoutSpacer(block);
        default: return layoutTextBlock(block);
      }
    }

    /* ---- menggambar ---- */

    function startNewPage() {
      doc.addPage();
      cursorY = page.marginTop;
      atPageTop = true;
    }

    function remainingSpace() {
      return bottomLimit - cursorY + EPSILON;
    }

    /** Rata kiri-kanan dengan menambah jarak antarkata (operator PDF "Tw"). */
    function drawJustified(line, baseline) {
      var spaces = line.text.split(' ').length - 1;
      var natural = measure(line.text, line.bold, line.size);
      var extra = line.justifyWidth - natural;
      if (spaces < 1 || extra <= 0.001) {
        doc.text(line.text, line.x, baseline);
        return;
      }
      doc.internal.write((extra / spaces * doc.internal.scaleFactor).toFixed(4) + ' Tw');
      doc.text(line.text, line.x, baseline);
      doc.internal.write('0 Tw');
    }

    function drawLine(line, top) {
      var sizeMm = line.size * PT_TO_MM;
      // Posisi baseline setara dengan perilaku line-height pada CSS.
      var baseline = top + (line.lineHeight - sizeMm * 1.115) / 2 + sizeMm * 0.9;
      line.extras.forEach(function (extra) {
        useFont(extra.bold, line.size);
        doc.text(extra.text, extra.x, baseline);
      });
      useFont(line.bold, line.size);
      if (line.justifyWidth) {
        drawJustified(line, baseline);
      } else {
        doc.text(line.text, line.x, baseline, { align: line.align });
      }
    }

    function drawLines(lines) {
      lines.forEach(function (line) {
        drawLine(line, cursorY);
        cursorY += line.lineHeight;
      });
      if (lines.length) { atPageTop = false; }
    }

    function drawBody(layout) {
      if (layout.kind === 'rule') {
        var rgb = hexToRgb(layout.block.color);
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.rect(page.marginX, cursorY, contentWidth, layout.bodyHeight, 'F');
        cursorY += layout.bodyHeight;
        atPageTop = false;
      } else if (layout.kind === 'spacer') {
        cursorY += layout.bodyHeight;
      } else {
        drawLines(layout.lines);
      }
    }

    function drawWhole(layout) {
      if (!atPageTop) { cursorY += layout.before; }
      drawBody(layout);
      cursorY += layout.after;
    }

    /** Blok teks panjang: dipecah antarhalaman per baris (yatim/janda dicegah). */
    function drawSplittable(layout) {
      var lines = layout.lines;
      var lineHeight = layout.lineHeight;

      if (!atPageTop) {
        var needed = layout.before + Math.min(2, lines.length) * lineHeight;
        if (needed > remainingSpace()) { startNewPage(); } else { cursorY += layout.before; }
      }

      var index = 0;
      while (index < lines.length) {
        var remaining = lines.length - index;
        var room = Math.floor(remainingSpace() / lineHeight);
        if (remaining <= room) {
          drawLines(lines.slice(index));
          break;
        }
        var take = room;
        if (remaining - take === 1 && take >= 3) { take -= 1; }
        if (take < 2) { take = atPageTop ? Math.max(room, 1) : 0; }
        if (take === 0) {
          startNewPage();
          continue;
        }
        drawLines(lines.slice(index, index + take));
        index += take;
        startNewPage();
      }
      cursorY += layout.after;
    }

    function placeSingle(layout) {
      if (layout.kind === 'text' && layout.lines.length > 1) {
        drawSplittable(layout);
        return;
      }
      var needed = (atPageTop ? 0 : layout.before) + layout.bodyHeight;
      if (!atPageTop && needed > remainingSpace()) { startNewPage(); }
      drawWhole(layout);
    }

    function groupHeight(group) {
      var total = 0;
      group.forEach(function (layout) {
        total += layout.before + layout.bodyHeight + layout.after;
      });
      return total - group[group.length - 1].after;
    }

    function placeGroup(group) {
      if (group.length === 1) {
        placeSingle(group[0]);
        return;
      }
      var height = groupHeight(group);
      if (height > contentHeight) {
        group.forEach(placeSingle);
        return;
      }
      if (!atPageTop && height > remainingSpace()) { startNewPage(); }
      group.forEach(drawWhole);
    }

    /* ---- susun blok menjadi kelompok "tetap bersama" ---- */

    var groups = [];
    var currentGroup = [];
    model.blocks.forEach(function (block) {
      currentGroup.push(layoutBlock(block));
      if (!block.keepWithNext) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    });
    if (currentGroup.length) { groups.push(currentGroup); }

    groups.forEach(placeGroup);
    return doc;
  }

  /* ---------------------------------------------------------------
   * API publik
   * ------------------------------------------------------------- */

  /**
   * Membuat PDF dan memicu pengunduhan.
   * @returns {Promise<string>} nama file yang diunduh.
   * Melempar Error (code 'PDF_LIB_MISSING' bila library tidak termuat).
   */
  function download(model, fileName, applicantName) {
    return ensureLibrary().then(function (JsPdfClass) {
      var doc = buildDocument(model, JsPdfClass);
      doc.setProperties({
        title: applicantName ? 'Surat Lamaran - ' + toPdfSafe(applicantName) : 'Surat Lamaran',
        subject: 'Surat Lamaran Pekerjaan',
        creator: 'Job Application Letter Generator'
      });
      doc.save(fileName);
      return fileName;
    });
  }

  return {
    ensureLibrary: ensureLibrary,
    buildFileName: buildFileName,
    buildDocument: buildDocument,
    download: download
  };
}));
