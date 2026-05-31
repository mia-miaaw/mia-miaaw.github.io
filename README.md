# 🤖 MIA - AI Chat App (Frontend Client)
Selamat datang di repositori frontend **AI Chat "MIA"**! Ini adalah klien web modern, responsif, dan interaktif yang dibangun menggunakan **Ionic Core v8**, **Vanilla JavaScript**, dan didukung oleh backend Cloudflare Workers AI.
Aplikasi ini tidak hanya berfungsi sebagai obrolan AI biasa, tetapi juga dilengkapi dengan fitur **asynchronous file reader** dan **multimodal vision (Llama 3.2 Vision)** yang memungkinkan pengguna mengirim berkas teks (seperti dokumen, baris kode sumber) atau gambar (tangkapan layar, sketsa desain) untuk kemudian langsung dianalisis oleh AI.
## ✨ Fitur Unggulan
 * **📸 Multimodal Vision (Image-to-HTML/Text):** Unggah gambar, *mock-up*, tangkapan layar, atau coretan sketsa kasar Anda. AI "MIA" akan menganalisis tata letaknya dan secara otomatis menghasilkan kode HTML5/CSS/Tailwind CSS yang responsif dan fungsional.
 * **📁 Asynchronous Text File Attachment:** Mendukung pengunggahan banyak berkas teks sekaligus (.txt, .js, .py, .json, .css, dll). Berkas dibaca secara paralel di sisi klien menggunakan FileReader API sebelum dikirim ke AI tanpa membebani server backend.
 * **⚡ Real-time SSE (Server-Sent Events) Streaming:** Jawaban dari AI dikirimkan dan dirender secara mengalir (*streaming*) huruf demi huruf secara langsung untuk performa interaksi yang cepat dan dinamis.
 * **📋 Custom Code Block with Copy Button:** Blok kode pemrograman yang dihasilkan oleh AI akan otomatis disorot (*highlighted*) dan dilengkapi dengan tombol "Salin" (*Copy*) yang elegan.
 * **📂 Manajemen Riwayat Obrolan Lokal:** Riwayat percakapan Anda otomatis tersimpan di dalam localStorage sehingga obrolan lama tidak akan hilang walaupun tab browser ditutup atau halaman dimuat ulang.
 * **📱 Desain Adaptif & Mobile Friendly:** Tata letak antarmuka dirancang dengan mulus untuk semua ukuran layar (Desktop, Tablet, dan Smartphone) memanfaatkan Ionic Split Pane.
 * **📝 Input Box Pintar:** Kotak input yang otomatis meluas ketika berfokus (*focus*) atau mengetik banyak baris (*multi-row*) dan mengempis kembali ke ukuran semula saat kosong.
## 📂 Struktur Direktori
```text
├── index.html              # Struktur antarmuka utama menggunakan Ionic Core
├── assets/
│   ├── css/
│   │   └── style.css       # Kustomisasi stylesheet UI modern & file-chip
│   └── js/
│   │   └── app.js          # Logika aplikasi utama (manajemen state, FileReader, SSE)
└── README.md               # Dokumentasi panduan ini

```
## 🛠️ Dependensi Pihak Ketiga (Melalui CDN)
Aplikasi ini menggunakan beberapa pustaka gratis berkualitas tinggi yang dimuat langsung melalui CDN di index.html:
 1. **Ionic Framework v8 (CSS & JS Core):** Digunakan untuk merender kerangka kerja aplikasi, menu sidebar laci, dan elemen antarmuka siap pakai yang bersahabat dengan sentuhan mobile.
 2. **Ionicons:** Pustaka ikon resmi dari Ionic untuk menghias elemen aksi.
 3. **Marked.js:** Penerjemah (*parser*) teks mentah Markdown menjadi format HTML yang bersih.
 4. **DOMPurify:** Pembersih (*sanitizer*) XSS (Cross-Site Scripting) untuk memastikan balasan HTML dari AI aman dari serangan skrip jahat sebelum disuntikkan ke dalam DOM halaman.
## ⚙️ Cara Instalasi & Konfigurasi
### 1. Kloning Repositori
Unduh atau klon repositori ini ke dalam komputer lokal Anda:
```bash
git clone https://github.com/mia-miaaw/mia-miaaw.github.io.git

```
### 2. Konfigurasi Endpoint API
Buka berkas assets/js/app.js, lalu cari baris **Global Config** di bagian paling atas. Ubah nilai API_BASE_URL sesuai dengan alamat endpoint Cloudflare Workers Anda yang aktif:
```javascript
// assets/js/app.js
const API_BASE_URL = 'https://ai-coding-worker.cloudflare.workers.dev'; // Ganti

```
### 3. Jalankan Secara Lokal
Karena aplikasi ini dibangun tanpa *framework compiler* yang rumit (Pure Vanilla HTML/JS), Anda dapat langsung membukanya di browser:
 * Klik ganda pada berkas index.html, ATAU
 * Gunakan ekstensi editor seperti **Live Server** di VS Code untuk pengalaman pengembangan yang lebih mulus dengan fitur *auto-reload*.
## ☁️ Panduan Deploy
Anda bisa mendeploy frontend ini secara gratis dalam hitungan menit menggunakan beberapa layanan web hosting statis terbaik:
### A. Github Pages (Sangat Direkomendasikan)
 1. Buat repositori baru di akun GitHub Anda.
 2. Unggah semua berkas proyek (index.html, folder assets/).
 3. Buka tab **Settings** -> **Pages** di repositori GitHub Anda.
 4. Pada bagian *Build and deployment*, pilih sumber dari cabang main (atau master) dan folder / (root).
 5. Klik **Save**. Halaman web Anda akan aktif dalam waktu beberapa detik!
### B. Vercel atau Netlify
 1. Hubungkan akun Vercel/Netlify Anda ke repositori GitHub proyek ini.
 2. Pilih repositori proyek ini, dan kosongkan semua pengaturan *Build Command* dan *Output Directory* (biarkan default karena ini situs statis).
 3. Klik **Deploy**.
## 📝 Format Pembacaan Berkas Lampiran (Penting)
MIA diprogram untuk mengenali letak berkas yang diunggah melalui format terstruktur markdown berikut:
**Untuk Berkas Teks (.txt, .js, .py, dll):**
```text
--- ISI BERKAS LAMPIRAN: nama_file.ext ---

```
*Teks kode isi berkas dibaca secara asinkronus oleh frontend menggunakan FileReader.readAsText()*
**Untuk Berkas Gambar (.png, .jpg, .webp):**
MIA akan mengonversinya menjadi bentuk string **Base64 Data URL** lewat metode FileReader.readAsDataURL(), kemudian mengirimkannya dalam objek payload JSON ke backend Cloudflare Workers untuk dianalisis oleh model multimodal **Llama 3.2 Vision**.
## 📄 Lisensi
Proyek ini dilisensikan di bawah **MIT License** - bebas digunakan, dimodifikasi, dan didistribusikan secara komersial maupun personal.
