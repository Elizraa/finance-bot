export default {
  calendar: {
    startMsg: 'Pilih tanggal: (tidak bisa pilih tanggal di masa depan)',
  },
  btn: {
    cancel: '❌ Batal',
    save: '✅ Simpan',
    categoryNotFound: '❌ Kategori tidak ditemukan',
    accountNotFound: '❌ Akun tidak ditemukan',
  },
  common: {
    noApiKey:
      '❌ API Key belum diatur.\n\nGunakan /reset untuk mengatur API Key terlebih dahulu.',
  },
  cmd: {
    available:
      'Perintah yang tersedia:\n' +
        '/create - Buat transaksi baru\n' +
        '/balance - Lihat saldo akun\n' +
        '/reset - Ganti API Key\n' +
        '/toggle_categories - Aktifkan/nonaktifkan kategori',
    start: {
      withKey:
        '👋 Selamat datang kembali!\n\n' +
          'Perintah yang tersedia:\n' +
          '/create - Buat transaksi baru\n' +
          '/balance - Lihat saldo akun\n' +
          '/reset - Ganti API Key\n' +
          '/delete - Hapus API Key\n' +
          '/toggle_categories - Aktifkan/nonaktifkan pemilihan kategori',
      withoutKey:
        '👋 Selamat datang!\n\n' +
          'Untuk memulai, silakan atur API Key Anda dengan perintah /reset',
    },
    balance: {
      noAccounts: '📊 Tidak ada akun ditemukan.',
      title: '💰 *Saldo Akun Anda*',
      total: 'Total',
      error: '❌ Gagal mengambil data saldo.',
    },
    delete: {
      noKey: '❌ Anda belum memiliki API Key yang tersimpan.',
      deleted: '✅ API Key berhasil dihapus.\n\nGunakan /reset untuk mengatur API Key baru.',
    },
    new: {
      deprecated:
        'ℹ️  Perintah /new sudah tidak digunakan.\nGunakan /create untuk membuat transaksi baru.',
    },
    toggle: {
      enabled:
        '✅ Pemilihan kategori *diaktifkan*.\n\nSetiap transaksi baru akan meminta Anda memilih kategori.',
      disabled:
        '🔕 Pemilihan kategori *dinonaktifkan*.\n\nTransaksi akan dibuat tanpa kategori.',
    },
    language: {
      prompt: 'Pilih bahasa:',
      changed: '✅ Bahasa diubah ke Bahasa Indonesia.',
      invalid: '❌ Bahasa tidak tersedia. Pilih id atau en.',
    },
  },
  wizard: {
    apiKey: {
      ask:
        '🔑 Silakan masukkan API Key Anda:\n\n' +
          '(API Key akan disimpan dengan enkripsi dan digunakan untuk semua transaksi Anda)',
      nonText: '❌ Harap kirim API Key dalam bentuk teks.',
      saved: '✅ API Key berhasil disimpan!\n\nGunakan /create untuk membuat transaksi baru.',
      invalid:
        '❌ API Key tidak valid atau gagal terhubung ke server.\n\n' +
          'Error: {reason}\n\nSilakan coba lagi dengan /reset',
    },
    transaction: {
      cancelled: '❌ Transaksi dibatalkan.',
      askDescription: 'Deskripsi transaksi? (ketik bebas)',
      askAmount: 'Nominal transaksi? (angka)',
      invalidAmount: 'Nominal tidak valid. Coba lagi.',
      futureDate: '❌ Dibatalkan, Tidak bisa memilih tanggal di masa depan.',
      failedCategories: 'Gagal mengambil daftar kategori dari API. Coba lagi /create.',
      failedAccounts: 'Gagal mengambil daftar sumber dari API. Coba lagi /create.',
      noAccounts: 'Tidak ada sumber tersedia. Tambahkan sumber dulu di aplikasi.',
      labels: {
        description: 'Deskripsi',
        nominal: 'Nominal',
        date: 'Tanggal',
        category: 'Kategori',
        source: 'Sumber',
        selectCategory: 'Pilih Kategori:',
        selectSource: 'Pilih Sumber:',
        prevBalance: 'Saldo sebelumnya',
        newBalance: 'Saldo baru',
      },
      confirm: {
        cancelled: '❌ Dibatalkan.',
      },
      submitted: '✅ Tersimpan!',
      errorStatus: 'Terjadi kesalahan (status {status}).',
      failedSubmit: '❌ Gagal simpan: {reason}',
    },
  },
};
