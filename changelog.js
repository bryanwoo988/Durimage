// Release history shown in Settings → Update history, and in the "What's new" popup.
// When releasing: add a new entry at the TOP and set the same version in sw.js (VERSION).
// date = the real release time in UTC (the moment it is pushed), e.g. from `date -u +%Y-%m-%dT%H:%M:%SZ`.
window.DURIMAGE_CHANGELOG = [
  {
    version: '1.3.3',
    date: '2026-11-04T15:41:32Z',
    notes: {
      zh: ['更新记录的日期和时间改成正确的发布时间', '修正 iPhone 主屏幕 App 更新后，弹出页面下方出现黑边的问题'],
      en: ['Update history now shows the correct release date and time', 'Fixed a dark strip under pop-up sheets on the iPhone home-screen app after an update'],
      ms: ['Sejarah kemas kini kini menunjukkan tarikh dan masa keluaran yang betul', 'Membaiki jalur gelap di bawah helaian timbul pada aplikasi skrin utama iPhone selepas kemas kini'],
    },
  },
  {
    version: '1.3.2',
    date: '2026-11-04T15:35:18Z',
    notes: {
      zh: ['修正 iPhone 主屏幕 App 自动更新后，首页底部导航栏往上浮的问题'],
      en: ['Fixed the bottom bar floating up on the iPhone home-screen app after an automatic update'],
      ms: ['Membaiki bar bawah yang terapung pada aplikasi skrin utama iPhone selepas kemas kini automatik'],
    },
  },
  {
    version: '1.3.1',
    date: '2026-11-04T15:17:24Z',
    notes: {
      zh: ['保存多张照片时又拍了新照片，新照片不会再不见', '「保存照片」画面不小心点到上方空白处，不会再把刚拍的照片丢掉', '信号不稳或 Google 一时忙碌时，会自动重试上传，不用手动按', '新手机第一次上传断线一下，不会再把照片变成压缩版', '手机空间不足时会提示，删除排队中的照片不会再自己跑回来'],
      en: ['A photo taken while another batch is saving is no longer lost', 'Tapping the empty area above "Save photos" no longer throws the photo away', 'Uploads retry by themselves on weak signal or when Google is busy', 'A brief drop on a new phone no longer turns a photo into a compressed copy', 'Shows a message when phone storage is full; deleted queued photos stay deleted'],
      ms: ['Foto yang diambil semasa kumpulan lain disimpan tidak lagi hilang', 'Ketik ruang kosong di atas "Simpan foto" tidak lagi membuang foto', 'Muat naik cuba semula sendiri bila liputan lemah atau Google sibuk', 'Gangguan singkat pada telefon baharu tidak lagi menukar foto kepada salinan dimampatkan', 'Mesej bila storan telefon penuh; foto beratur yang dipadam kekal dipadam'],
    },
  },
  {
    version: '1.3.0',
    date: '2026-11-04T15:05:44Z',
    notes: {
      zh: ['新增启动画面：打开 App 时显示 Durimage 的 icon，iPhone 不会再先出现一片白'],
      en: ['New splash screen: the Durimage icon shows while the app opens, no more white screen on iPhone'],
      ms: ['Skrin pembuka baharu: ikon Durimage dipaparkan semasa aplikasi dibuka, tiada lagi skrin putih pada iPhone'],
    },
  },
  {
    version: '1.2.2',
    date: '2026-11-04T14:48:44Z',
    notes: {
      zh: ['修正 iPhone 主屏幕 App 在打过字（键盘收起）之后，首页底部导航栏往上浮、下面出现黑边的问题'],
      en: ['Fixed the bottom bar floating up with a dark strip below it on the iPhone home-screen app after typing (keyboard closed)'],
      ms: ['Membaiki bar bawah yang terapung dengan jalur gelap di bawahnya pada aplikasi skrin utama iPhone selepas menaip'],
    },
  },
  {
    version: '1.2.1',
    date: '2026-11-04T14:41:31Z',
    notes: {
      zh: ['修正 iPhone 主屏幕 App 的登录页和首页比屏幕高、需要往下滑、底部出现一条黑边的问题'],
      en: ['Fixed login and home screens being taller than the screen on the iPhone home-screen app (extra scrolling and a dark strip at the bottom)'],
      ms: ['Membaiki skrin log masuk dan utama yang lebih tinggi daripada skrin pada aplikasi skrin utama iPhone (perlu skrol dan jalur gelap di bawah)'],
    },
  },
  {
    version: '1.2.0',
    date: '2026-11-04T14:38:51Z',
    notes: {
      zh: ['登录页的密码框加了眼睛按钮，可以查看自己打的密码', 'App 有新版本时会自动更新，并告诉你更新了什么', '设置里可以查看更新记录，也可以手动检查更新', '修正 iPhone 主屏幕 App 登录页底部被切掉的问题'],
      en: ['Eye button on the password field to show what you typed', 'The app updates itself and tells you what changed', 'Update history and "Check for updates" in Settings', 'Fixed the bottom of the login screen being cut off on iPhone home-screen app'],
      ms: ['Butang mata pada kata laluan untuk lihat apa yang ditaip', 'Aplikasi dikemas kini sendiri dan beritahu apa yang berubah', 'Sejarah kemas kini dan "Semak kemas kini" dalam Tetapan', 'Bahagian bawah skrin log masuk tidak lagi terpotong pada iPhone'],
    },
  },
  {
    version: '1.1.0',
    date: '2026-11-04T14:21:34Z',
    notes: {
      zh: ['离线拍的照片可以一次全部上传，3 张同时传，首页显示上传进度', '点照片可以看详情：拍摄时间、文件夹、拍摄者、注解、GPS', '还没上传或失败的照片可以重试或从手机删除', '首页照片按日期分组，缩图显示拍摄时间'],
      en: ['Upload all offline photos at once, 3 at a time, with a progress bar', 'Tap a photo to see its details: time, folder, photographer, note, GPS', 'Retry or delete photos that are queued or failed', 'Recent photos grouped by day, with the time on each photo'],
      ms: ['Muat naik semua foto luar talian sekali gus, 3 serentak, dengan bar kemajuan', 'Ketik foto untuk lihat butiran: masa, folder, perakam, nota, GPS', 'Cuba lagi atau padam foto yang beratur atau gagal', 'Foto terkini dikumpul ikut hari, dengan masa pada setiap foto'],
    },
  },
  {
    version: '1.0.0',
    date: '2026-11-04T13:34:56Z',
    notes: {
      zh: ['首次上线：拍照后原图直接存进团队的 Google Drive', '按病虫害选文件夹，文件夹由管理员在 Drive 建立', '果园没信号也能拍，有网络自动上传', '写注解的照片会记录到 Google Sheet', '华文 / English / Bahasa Melayu，8 款浅色与深色主题，QR 分享'],
      en: ['First release: original photos go straight to the team Google Drive', 'Choose a pest/disease folder; folders are created by the admin in Drive', 'Shoot without signal, upload when back online', 'Photos with a note are logged in a Google Sheet', '华文 / English / Bahasa Melayu, 8 light and dark themes, QR sharing'],
      ms: ['Keluaran pertama: foto asal terus ke Google Drive pasukan', 'Pilih folder perosak/penyakit; folder dicipta oleh pentadbir dalam Drive', 'Rakam tanpa liputan, muat naik bila ada internet', 'Foto yang ada nota direkod dalam Google Sheet', '华文 / English / Bahasa Melayu, 8 tema cerah dan gelap, kongsi QR'],
    },
  },
];
window.DURIMAGE_VERSION = window.DURIMAGE_CHANGELOG[0].version;
