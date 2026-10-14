# Job Application Letter Generator

Aplikasi web sederhana untuk membuat **surat lamaran pekerjaan berbahasa Indonesia** yang formal dan profesional dari data yang Anda isi pada formulir. Berjalan sepenuhnya di browser (client-side): tanpa backend, database, login, maupun API key.

## Cara menjalankan

1. Unduh/salin folder `job-application-generator/` dengan struktur apa adanya.
2. Buka `index.html` langsung di browser modern (Chrome, Edge, Firefox, Safari).

Alternatif (opsional) dengan server lokal:

```bash
cd job-application-generator
python3 -m http.server 8000
# buka http://localhost:8000
```

**Koneksi internet** dibutuhkan saat pertama membuka halaman untuk memuat dua library CDN:

| Library | Fungsi | Wajib? |
|---|---|---|
| [jsPDF 2.5.1](https://github.com/parallax/jsPDF) (cdnjs, cadangan jsDelivr) | Membuat file PDF | Hanya untuk tombol **Unduh PDF** |
| [Font Awesome 6.5.1](https://fontawesome.com) (cdnjs) | Ikon | Tidak (hanya tampilan) |

Fitur lain (formulir, pratinjau, cetak, penyimpanan otomatis) tetap berfungsi tanpa kedua library tersebut.

## Fitur

- **Formulir bertahap**: Data Pribadi, Informasi Lamaran, Isi Surat, Tampilan Surat.
- **Pratinjau langsung** berbentuk kertas A4; berubah setiap kali Anda mengetik. Desktop: dua kolom; ponsel: vertikal (pratinjau otomatis diperkecil agar muat).
- **Penyusun surat otomatis** dengan struktur surat formal Indonesia: kota & tanggal, perihal, tujuan, salam pembuka, paragraf pembuka, data diri, kualifikasi, ketertarikan, penutup, salam penutup, nama.
  - Kolom opsional yang kosong **tidak ditampilkan** di surat.
  - Bila paragraf isi dikosongkan, dipakai kalimat umum yang profesional **tanpa mengarang** pengalaman, pendidikan, atau keahlian.
  - Teks yang Anda isi menggantikan kalimat standar pada bagian terkait; setiap baris baru menjadi satu paragraf.
- **Lampiran (opsional)**: tulis satu lampiran per baris atau klik tombol pilih cepat (KTP, CV, ijazah, dst.). Tampil sebagai daftar bernomor setelah paragraf kualifikasi dan sebelum penutup ("Sebagai kelengkapan, bersama surat ini saya lampirkan: 1. …"). Bila kosong, bagian ini tidak muncul.
- **Tanda tangan**: pada template Formal Klasik, "Hormat saya," dan nama berada rata kanan penuh; pada Profesional Modern rata kiri.
- **Unduh PDF** (A4, nama file otomatis, mis. `Surat_Lamaran_Yusma_Rahman.pdf`).
- **Cetak Surat** lewat dialog cetak browser (hanya dokumen surat yang tercetak; bisa disimpan sebagai PDF).
- **Template**: Formal Klasik dan Profesional Modern; dapat diganti tanpa mengisi ulang.
- **Pengaturan tampilan**: font (Arial / Times New Roman), ukuran (11 / 12 pt), jarak baris (rapat / normal / longgar). Berlaku di pratinjau, PDF, dan cetak.
- **Validasi**: field wajib (nama lengkap, posisi, perusahaan, tanggal) ditandai dan diberi pesan jelas; indikator kelengkapan di atas formulir.
- **Simpan otomatis** ke `localStorage` (dapat dimatikan), **Reset Form**, dan **Hapus Data Tersimpan**, masing-masing dengan konfirmasi.

## Struktur proyek

```
job-application-generator/
├── index.html              # Struktur halaman & elemen formulir
├── css/
│   └── style.css           # Gaya aplikasi, responsif, dokumen, @media print
├── js/
│   ├── app.js              # Formulir, validasi, preview, localStorage, aksi tombol
│   ├── letter-generator.js # Template teks surat -> "model blok" + render ke DOM
│   └── pdf-generator.js    # Model blok -> PDF A4 (jsPDF) + nama file
└── README.md
```

### Arsitektur singkat

```
Formulir ──► app.js ──► LetterGenerator.buildLetter()  ──► model blok surat
                                 │                              │
                                 │                 ┌────────────┴─────────────┐
                                 ▼                 ▼                          ▼
                       renderLetter() → Pratinjau/Cetak            PdfGenerator.buildDocument() → PDF
```

Pratinjau dan PDF dibangun dari **satu model blok yang sama** (satuan milimeter, ukuran font dalam pt, margin 25 mm kiri-kanan dan 20 mm atas-bawah) sehingga margin, ukuran font, dan spasi konsisten. Semua teks dimasukkan ke DOM lewat `textContent` (tanpa `innerHTML`, tanpa `eval`), jadi input berisi `<`, `&`, atau tanda kutip aman.

### Mengapa jsPDF?

- Teks digambar sebagai **teks asli** (tajam, dapat dipilih/disalin), bukan tangkapan gambar seperti pada html2pdf.js.
- Pemisahan halaman dikendalikan sendiri: teks tidak terpotong di tengah baris, paragraf panjang berlanjut ke halaman berikutnya, dan salam penutup + tanda tangan tidak terpisah dari paragraf terakhir.
- Hasil tidak bergantung pada ukuran layar atau elemen antarmuka.

Catatan: PDF memakai font standar (Arial → Helvetica, Times New Roman → Times). Karakter di luar set Latin-1/Windows-1252 (mis. aksara Mandarin, emoji) diganti `?` pada PDF. Huruf berdiakritik Latin seperti é atau ö tetap aman. Pembagian baris pada pratinjau dan PDF dapat berbeda satu-dua kata karena mesin penata teks keduanya berbeda; margin, ukuran, dan isi tetap sama.

### Menyesuaikan teks surat

Seluruh kalimat standar ada di objek `TEXT_TEMPLATES` pada `js/letter-generator.js`; tata letak per template ada pada `buildClassicBlocks()` dan `buildModernBlocks()`. Margin halaman ada pada konstanta `PAGE` di berkas yang sama.

## Panduan pengujian

1. **Mengisi seluruh field**: isi semua kolom, lalu periksa pratinjau memuat kota & tanggal ("Muara Teweh, 14 Oktober 2026"), perihal, tujuan, salam, paragraf, data diri, penutup, dan nama.
2. **Mengosongkan field opsional**: isi hanya nama, posisi, perusahaan, tanggal. Pastikan tidak ada baris kosong/label alamat/email/telepon dan surat tetap utuh dengan kalimat umum.
3. **Mengubah data**: ketik di setiap field dan pastikan pratinjau berubah seketika. Ganti template, font, ukuran, dan jarak baris.
4. **Unduh PDF**: klik **Unduh PDF**. Periksa file `Surat_Lamaran_<Nama>.pdf`: ukuran A4, tanpa tombol/formulir, notifikasi hijau muncul. Kosongkan nama lalu klik lagi: field ditandai merah dan PDF tidak dibuat.
5. **Cetak**: klik **Cetak Surat** (atau Ctrl/Cmd+P). Pratinjau cetak hanya menampilkan surat pada kertas A4; pilih "Simpan sebagai PDF" untuk uji tanpa printer.
6. **Smartphone**: buka lewat ponsel (atau mode responsif DevTools, lebar ±375 px). Formulir di atas, pratinjau di bawah dan muat lebar layar; tombol mudah ditekan.
7. **Muat ulang**: isi beberapa field, tunggu indikator "Tersimpan otomatis…", muat ulang halaman; data dan pengaturan kembali. Coba **Hapus Data Tersimpan** dan **Reset Form**.
8. **Lebih dari satu halaman**: isi kolom kualifikasi dan alasan dengan ±10 paragraf panjang. Indikator di toolbar menampilkan jumlah halaman; PDF berlanjut ke halaman berikutnya tanpa teks terpotong atau bertumpuk.
9. **Karakter khusus**: isi nama dengan `Ångström <b>&"Zoë"</b>` dan alamat dengan satu kata sangat panjang. Teks tampil apa adanya (tidak ditafsirkan sebagai HTML) dan kata panjang dipatahkan agar tidak keluar halaman.
10. **Library PDF gagal dimuat**: pada DevTools > Network, blokir `cdnjs.cloudflare.com` dan `cdn.jsdelivr.net` (atau matikan internet), muat ulang, lalu klik **Unduh PDF**. Muncul notifikasi galat yang menyarankan **Cetak Surat > Simpan sebagai PDF**; fitur lain tetap berjalan.

## Kredit

Dibuat oleh **Yusma** · [GitHub](https://github.com/yusma1122) · [LinkedIn](https://www.linkedin.com/in/yusmarahman09/)

Footer kredit hanya tampil di layar dan otomatis disembunyikan saat mencetak, sehingga tidak masuk ke surat maupun PDF.

## Privasi

Seluruh data diproses lokal di browser. Satu-satunya penyimpanan adalah `localStorage` pada perangkat Anda (dapat dimatikan dan dihapus kapan saja). Tidak ada data yang dikirim ke server; CDN hanya mengirim berkas library ke browser Anda.
