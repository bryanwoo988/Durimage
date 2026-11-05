// Release history shown in Settings → Update history, and in the "What's new" popup.
// When releasing: add a new entry at the TOP and set the same version in sw.js (VERSION).
// date = the real release time in UTC (the moment it is pushed), e.g. from `date -u +%Y-%m-%dT%H:%M:%SZ`.
window.DURIMAGE_CHANGELOG = [
  {
    version: '1.7.3',
    date: '2026-11-05T23:55:10Z',
    notes: {
      zh: ['全面检查后的修正：审核中心和首页的「选择」工具列，离开那个画面后不会再浮在别的画面上', '设置里的「清除记录」会先确认，而且不会清掉还没送审完成的照片', '手机保留 1000 张照片时，不会清掉还在排队送审的照片', '送审途中按「撤回送审」，现在会正确撤回', '审核员送出的照片如果已被移除或撤回，提示会说清楚原因'],
      en: ['Fixes from a full check: the "Select" bar of the home screen / review hub no longer floats over the other screen', '"Clear history" in Settings now asks first and keeps photos still waiting to be sent for review', 'Keeping the last 1000 photos never drops a photo still queued for review', 'Withdrawing while the submission is being sent now withdraws it properly', 'Reviews of a photo that was removed or withdrawn now say why they were not sent'],
      ms: ['Pembaikan daripada semakan penuh: bar "Pilih" skrin utama / pusat semakan tidak lagi terapung di atas skrin lain', '"Kosongkan sejarah" dalam Tetapan kini bertanya dahulu dan menyimpan foto yang masih menunggu dihantar untuk semakan', 'Menyimpan 1000 foto terakhir tidak lagi membuang foto yang masih beratur untuk semakan', 'Menarik balik semasa penghantaran sedang berjalan kini berfungsi dengan betul', 'Semakan untuk foto yang telah dialih keluar atau ditarik balik kini menyatakan sebabnya'],
    },
  },
  {
    version: '1.7.2',
    date: '2026-11-05T15:03:14Z',
    notes: {
      zh: ['缺缩图的照片改向 Drive 拿它自己的小缩图，并存回 Sheet，下次不用再拿；不会再为了缩图下载整张原图', '手机里以前拍的照片，送审时缩图太大也会自动缩小'],
      en: ['Missing thumbnails are now fetched as Drive\'s own small thumbnail and saved back to the Sheet, so they are not fetched again; the full photo is no longer downloaded just for a thumbnail', 'Older photos on the phone get their thumbnail shrunk when sent, if it is too big'],
      ms: ['Lakaran kecil yang tiada kini diambil sebagai lakaran kecil Drive sendiri dan disimpan semula ke Sheet, jadi tidak diambil lagi; foto penuh tidak lagi dimuat turun hanya untuk lakaran kecil', 'Foto lama dalam telefon akan dikecilkan lakarannya semasa dihantar jika terlalu besar'],
    },
  },
  {
    version: '1.7.1',
    date: '2026-11-05T14:50:17Z',
    notes: {
      zh: ['修好：有些照片在审核清单没有缩图（草地、落叶这类画面比较复杂的照片，缩图太大，存不进去）', '以前缺缩图的照片，现在会直接从 Drive 拿一张小图来显示'],
      en: ['Fixed: some photos had no thumbnail in the review list (busy photos like grass or fallen leaves made thumbnails too big to save)', 'Photos that are already missing a thumbnail now load a small copy from Drive'],
      ms: ['Dibaiki: sesetengah foto tiada imej kecil dalam senarai semakan (foto sibuk seperti rumput atau daun gugur menghasilkan imej kecil yang terlalu besar untuk disimpan)', 'Foto yang sudah tiada imej kecil kini memuatkan salinan kecil dari Drive'],
    },
  },
  {
    version: '1.7.0',
    date: '2026-11-05T14:12:09Z',
    notes: {
      zh: ['管理员可以移除照片（随便拍、模糊、重复…）：照片搬到 Drive 的「_已移除」文件夹，不会再出现在审核清单，也不会混进训练资料', '审核中心多一个「已移除」分页，可以复原；也可以在首页或审核中心「选择」多张一起移除', '拍照的人可以「撤回送审」还没被专家审核的照片'],
      en: ['The admin can remove photos (random shots, blurry, duplicates…): they move to the "_已移除" Drive folder, leave the review list and stay out of the training data', 'New "Removed" tab in the Review hub with Restore; several photos can be selected and removed at once', 'Photographers can withdraw a submission that no expert has reviewed yet'],
      ms: ['Pentadbir boleh mengalih keluar foto (gambar rambang, kabur, pendua…): foto dialihkan ke folder Drive "_已移除", keluar dari senarai semakan dan tidak masuk data latihan', 'Tab "Dialih keluar" baharu di Pusat semakan dengan Pulihkan; beberapa foto boleh dipilih dan dialih keluar sekali gus', 'Jurugambar boleh menarik balik penghantaran yang belum disemak oleh pakar'],
    },
  },
  {
    version: '1.6.5',
    date: '2026-11-05T12:17:38Z',
    notes: {
      zh: ['「_推送记录」记下每支手机真正收到通知的时间和点开的时间（手机收到时会自动回报），跟发出时间一比就知道慢在哪里'],
      en: ['"_推送记录" now records when each phone actually received a notification and when it was tapped (the phone reports back), next to when it was sent'],
      ms: ['"_推送记录" kini merekod bila setiap telefon benar-benar menerima notifikasi dan bila ia diketik (telefon melaporkan kembali), di sebelah masa ia dihantar'],
    },
  },
  {
    version: '1.6.4',
    date: '2026-11-05T12:08:53Z',
    notes: {
      zh: ['「_推送记录」多了「设备」一栏（Android / iPhone），测试通知也会记录，看得出每条通知送到哪一支手机'],
      en: ['"_推送记录" now has a "Device" column (Android / iPhone), and test notifications are logged too, so you can see which phone each notification went to'],
      ms: ['"_推送记录" kini ada lajur "Peranti" (Android / iPhone), dan notifikasi ujian juga direkod, jadi anda boleh lihat ke telefon mana setiap notifikasi dihantar'],
    },
  },
  {
    version: '1.6.3',
    date: '2026-11-05T12:02:35Z',
    notes: {
      zh: ['设置 → 通知 显示这支手机登记的身份和名字（通知是按名字对上的）', '每次打开 App 都会向服务器确认这支手机，不会因为被清掉而收不到通知', 'Google Sheet 新增隐藏分页「_推送记录」：每条通知发给谁、有没有送出，方便查问题'],
      en: ['Settings → Notifications shows the role and name this phone is registered with (notifications are matched by name)', 'The phone is re-confirmed with the server each time the app opens, so it is not left out after a cleanup', 'New hidden tab "_推送记录" in the Google Sheet: who each notification went to and whether it was delivered'],
      ms: ['Tetapan → Notifikasi menunjukkan peranan dan nama yang didaftarkan untuk telefon ini (notifikasi dipadankan mengikut nama)', 'Telefon disahkan semula dengan pelayan setiap kali aplikasi dibuka, jadi tidak tertinggal selepas pembersihan', 'Tab tersembunyi baharu "_推送记录" dalam Google Sheet: kepada siapa setiap notifikasi dihantar dan sama ada berjaya'],
    },
  },
  {
    version: '1.6.2',
    date: '2026-11-05T11:22:37Z',
    notes: {
      zh: ['审核清单按真正的时间排序，最新送审的在最上面；「我审核过的」「已审核」里，刚审核完的排在最上面'],
      en: ['The review list is sorted by real time, newest submission on top; in "Reviewed by me" / "Reviewed" the most recently reviewed photo is on top'],
      ms: ['Senarai semakan diisih mengikut masa sebenar, penghantaran terbaharu di atas; dalam "Disemak oleh saya" / "Disemak" foto yang paling baru disemak berada di atas'],
    },
  },
  {
    version: '1.6.1',
    date: '2026-11-05T11:19:06Z',
    notes: {
      zh: ['首页开着筛选时，在照片详情保存初步判断或送审后，照片会离开筛选结果，左右滑动就失效了；现在会照打开时的顺序继续滑'],
      en: ['With a home-screen filter on, saving a judgement or sending a photo could move it out of the filter and stop left/right swiping in photo details; swiping now keeps the order from when the details were opened'],
      ms: ['Dengan penapis skrin utama aktif, menyimpan penilaian atau menghantar foto boleh mengeluarkannya daripada penapis dan menghentikan leretan dalam butiran foto; leretan kini mengekalkan susunan semasa butiran dibuka'],
    },
  },
  {
    version: '1.6.0',
    date: '2026-11-05T07:55:30Z',
    notes: {
      zh: ['新增通知：有照片送审时通知审核员和管理员；专家审核完成时通知拍照的人，管理员收到全部审核的摘要', '手机推送每 5 分钟合并一次，不会一直响；App 里也会出现提醒，主画面图示会显示数字', '设置 → 通知：每支手机自己开关要收哪些通知'],
      en: ['New notifications: reviewers and the admin are told when photos are sent for review; photographers are told when experts have reviewed their photos, and the admin gets a summary of all reviews', 'Phone push is merged every 5 minutes so it does not keep buzzing; notices also appear inside the app and as a number on the app icon', 'Settings → Notifications: each phone chooses which notifications it gets'],
      ms: ['Notifikasi baharu: penyemak dan pentadbir dimaklumkan apabila foto dihantar untuk semakan; jurugambar dimaklumkan apabila pakar selesai menyemak foto mereka, dan pentadbir menerima ringkasan semua semakan', 'Push telefon digabung setiap 5 minit supaya tidak berbunyi berterusan; notis juga muncul dalam aplikasi dan sebagai nombor pada ikon aplikasi', 'Tetapan → Notifikasi: setiap telefon memilih notifikasi yang diterima'],
    },
  },
  {
    version: '1.5.6',
    date: '2026-11-05T07:30:04Z',
    notes: {
      zh: ['审核员送出审核后直接跳到清单里的下一张照片，不用回清单再点；最后一张送出后才回到清单', '下一张照片会在审核当前这张时先在后台载好，换过去更快'],
      en: ['After sending a review, the next photo in the list opens straight away; the list comes back only after the last one', 'The next photo is fetched in the background while the current one is reviewed, so it opens faster'],
      ms: ['Selepas menghantar semakan, foto seterusnya dalam senarai dibuka terus; senarai muncul semula hanya selepas foto terakhir', 'Foto seterusnya dimuat di latar belakang semasa foto semasa disemak, jadi ia dibuka lebih cepat'],
    },
  },
  {
    version: '1.5.5',
    date: '2026-11-05T07:10:46Z',
    notes: {
      zh: ['审核员按「送出审核」后马上关闭、马上可以审下一张，审核在后台送出，不用等', '没有网络也可以送出审核：先存在手机里，有网络时自动送出'],
      en: ['After "Send review" the panel closes at once and the next photo can be reviewed right away; the review is sent in the background', 'Reviews can be sent without a connection: they are kept on the phone and sent automatically when online'],
      ms: ['Selepas "Hantar semakan" panel ditutup serta-merta dan foto seterusnya boleh disemak terus; semakan dihantar di latar belakang', 'Semakan boleh dihantar tanpa talian: disimpan dalam telefon dan dihantar secara automatik apabila ada talian'],
    },
  },
  {
    version: '1.5.4',
    date: '2026-11-05T06:49:48Z',
    notes: {
      zh: ['照片详情左右滑动更顺：画面不会再跳一下，换照片时也不会闪白或闪出破图'],
      en: ['Smoother swiping in photo details: the panel no longer jumps, and no blank or broken image flashes while changing photos'],
      ms: ['Leretan lebih lancar dalam butiran foto: panel tidak lagi melompat, dan tiada imej kosong atau rosak berkelip semasa menukar foto'],
    },
  },
  {
    version: '1.5.3',
    date: '2026-11-05T06:28:40Z',
    notes: {
      zh: ['用审核密码登录时，手机里还没上传的照片会先暂停，换回团队或管理员密码后自动继续上传，不会变成「上传失败」'],
      en: ['While signed in with the review password, photos not yet uploaded wait on the phone and continue automatically after switching back to the team or admin password, instead of failing'],
      ms: ['Semasa log masuk dengan kata laluan semakan, foto yang belum dimuat naik menunggu dalam telefon dan diteruskan secara automatik selepas bertukar kembali ke kata laluan pasukan atau pentadbir, bukannya gagal'],
    },
  },
  {
    version: '1.5.2',
    date: '2026-11-05T06:10:58Z',
    notes: {
      zh: ['照片详情可以左右滑动，直接看上一张、下一张（跟首页一样的顺序，有筛选时只在筛选结果里切换），照片上也有左右箭头和「第几张 / 共几张」', '登录画面改成「输入密码」：拍照的人输入团队密码，审核员输入审核密码，App 按密码自动分辨身份'],
      en: ['Swipe left or right in photo details to see the previous or next photo (same order as the home screen; only within the filter results when a filter is on). The photo also shows arrows and "n / total"', 'The login screen now says "Enter password": photographers use the team password, reviewers the review password, and the app knows the role from the password'],
      ms: ['Leret ke kiri atau kanan dalam butiran foto untuk melihat foto sebelum atau seterusnya (susunan sama seperti skrin utama; hanya dalam hasil penapis jika penapis aktif). Foto juga menunjukkan anak panah dan "n / jumlah"', 'Skrin log masuk kini berkata "Masukkan kata laluan": jurugambar guna kata laluan pasukan, penyemak guna kata laluan semakan, dan aplikasi mengenal peranan daripada kata laluan'],
    },
  },
  {
    version: '1.5.1',
    date: '2026-11-05T06:02:03Z',
    notes: {
      zh: ['拍照的人也能在照片上画标记了：「保存照片」画面按「在照片上标记」（一次一张），或在照片详情按「标记」，送审前后都能改，改了会自动重新送审', '审核员看到的拍照者标记是虚线，自己画的是实线；可以先关掉拍照者的标记，自己判断'],
      en: ['Photographers can now mark the photo too: tap "Mark the photo" in Save photos (one photo at a time), or "Mark" in the photo details; marks can be changed before or after sending, and changes are sent again automatically', "Reviewers see the photographer's marks as dashed lines and their own as solid; they can switch the photographer's marks off to judge on their own first"],
      ms: ['Jurugambar kini boleh menanda foto: ketik "Tanda pada foto" dalam Simpan foto (satu foto setiap kali), atau "Tanda" dalam butiran foto; tanda boleh diubah sebelum atau selepas dihantar, dan perubahan dihantar semula secara automatik', 'Penyemak melihat tanda jurugambar sebagai garis putus dan tanda sendiri sebagai garis penuh; tanda jurugambar boleh dimatikan untuk menilai sendiri dahulu'],
    },
  },
  {
    version: '1.5.0',
    date: '2026-11-05T05:22:32Z',
    notes: {
      zh: ['专家审核：拍照时可以填初步判断（多选 + 手写 + 确定/不确定），保存后送审，或在首页「选择」多张一起送审', '审核员用审核密码登录：待审核清单、放大照片、同意或改正、手写补充、留言，还能在照片上画圈、框、箭头和画笔标注', '审核员之间看不到彼此的结果；管理员在「审核中心」看得到所有专家的意见和分歧，也能管理病虫害清单', '拍照的人在照片详情看得到专家审核结果和标注', '首页新增筛选：按果园、树、病虫害、日期、状态、文件夹，或搜索；手机保留最近 1000 张照片'],
      en: ['Expert review: add a first judgement when saving (multi-select + free text + sure/unsure), send it for review, or select several photos on the home screen and send them together', 'Reviewers sign in with the review password: list of photos to review, zoom, agree or correct, write in categories, comment, and draw circles, boxes, arrows and pen marks on the photo', 'Reviewers cannot see each other; the admin sees every expert and any disagreement in the Review hub, and manages the pest/disease list', 'Photographers see expert reviews and marks in the photo details', 'Home screen filter: orchard, tree, pest, date, status, folder or search; the phone keeps the last 1000 photos'],
      ms: ['Semakan pakar: tambah penilaian awal semasa menyimpan (pilihan berbilang + teks bebas + pasti/tidak pasti), hantar untuk semakan, atau pilih beberapa foto di skrin utama dan hantar bersama', 'Penyemak log masuk dengan kata laluan semakan: senarai foto, zum, setuju atau betulkan, tulis kategori, komen, dan lukis bulatan, kotak, anak panah dan pen pada foto', 'Penyemak tidak dapat melihat satu sama lain; pentadbir melihat semua pakar dan perbezaan pendapat di Pusat semakan, serta mengurus senarai perosak/penyakit', 'Jurugambar melihat semakan dan tanda pakar dalam butiran foto', 'Penapis di skrin utama: kebun, pokok, perosak, tarikh, status, folder atau carian; telefon menyimpan 1000 foto terakhir'],
    },
  },
  {
    version: '1.4.4',
    date: '2026-11-05T04:37:29Z',
    notes: {
      zh: ['照片可以放大了：点照片打开全屏，两指放大、双击放大，放大后可以拖动', '「保存照片」画面里刚拍的照片也能点开放大检查', '新拍的照片在手机里保留更清楚的预览图，放大看得更清楚'],
      en: ['Photos can now be zoomed: tap to open full screen, pinch or double-tap to zoom, drag to move', 'Just-taken photos in Save photos can be opened full size to check them', 'New photos keep a sharper preview on the phone for clearer zooming'],
      ms: ['Foto kini boleh dizum: ketik untuk skrin penuh, cubit atau ketik dua kali untuk zum, seret untuk alih', 'Foto yang baru diambil dalam Simpan foto boleh dibuka saiz penuh untuk disemak', 'Foto baharu menyimpan pratonton lebih tajam dalam telefon untuk zum lebih jelas'],
    },
  },
  {
    version: '1.4.3',
    date: '2026-11-05T01:16:04Z',
    notes: {
      zh: ['拍照时刚好遇到 App 自动更新，刚拍的照片不会再丢失', '登录完成后就先询问定位权限，第一次按快门时不会跟相机抢画面'],
      en: ['A photo being taken while an automatic update arrives is no longer lost', 'Location permission is asked right after login, so it does not clash with the camera on the first shot'],
      ms: ['Foto yang sedang diambil semasa kemas kini automatik tiba tidak lagi hilang', 'Kebenaran lokasi diminta sejurus selepas log masuk, jadi tidak bertembung dengan kamera pada foto pertama'],
    },
  },
  {
    version: '1.4.2',
    date: '2026-11-05T01:09:10Z',
    notes: {
      zh: ['GPS 更准确：一按快门就开始定位，持续更新，只留最准的那一笔；误差很大时会提示', '首页底部导航栏恢复原本高度', '一次选很多照片时保存更快、更省电', '缩图的「已上传」改成只显示打勾，不会再被时间挤掉'],
      en: ['More accurate GPS: starts when you tap the shutter, keeps updating and keeps the best fix; warns when it is far off', 'Bottom bar back to its normal height', 'Saving many photos at once is faster and uses less battery', 'Uploaded photos show a tick instead of squeezed text'],
      ms: ['GPS lebih tepat: bermula bila butang kamera ditekan, terus dikemas kini dan simpan bacaan terbaik; beri amaran jika jauh tersasar', 'Bar bawah kembali ke ketinggian biasa', 'Menyimpan banyak foto sekali gus lebih pantas dan jimat bateri', 'Foto dimuat naik menunjukkan tanda semak'],
    },
  },
  {
    version: '1.4.1',
    date: '2026-11-05T00:52:43Z',
    notes: {
      zh: ['树牌模式还没输入树牌时，按快门会先请你输入树牌，填好后相机直接打开', '从相册上传时，会清楚提示还没填果园还是树号；没填的话照片会归类成仅训练集'],
      en: ['In tree-tag mode without a tag, the shutter asks for the tag first and then opens the camera', 'Gallery uploads say exactly whether the orchard or the tree is missing; missing ones make the photos training-only'],
      ms: ['Dalam mod tag pokok tanpa tag, butang kamera minta tag dahulu kemudian buka kamera', 'Muat naik galeri menyatakan dengan jelas sama ada kebun atau pokok belum diisi; jika tidak diisi foto jadi latihan sahaja'],
    },
  },
  {
    version: '1.4.0',
    date: '2026-11-05T00:48:34Z',
    notes: {
      zh: ['新增「果园」和「树号」：写进文件名，以后可以按树分训练和测试', '首页有「下一棵树」按钮；支持流水号和树牌号码两种编号方式', '从相册上传旧照片：果园和树号选填，不知道就标成 NA（仅用于训练集）', '文件名改成只用英文；名字请改用英文或拼音', '同一张照片不会重复上传；有注解或仅训练集的照片会记录到 Google Sheet'],
      en: ['New: orchard and tree number, written into file names so training and test sets can be split by tree', 'Next tree button on the home screen; running numbers or tree tags', 'Old gallery photos: orchard and tree are optional; unknown is marked NA (training only)', 'File names are now English-only; please use an English name', 'The same photo is never uploaded twice; photos with a note or for training only are logged in the Google Sheet'],
      ms: ['Baharu: kebun dan nombor pokok dalam nama fail, supaya set latihan dan ujian boleh dipisah ikut pokok', 'Butang Pokok seterusnya pada skrin utama; nombor berjujukan atau tag pokok', 'Foto lama dari galeri: kebun dan pokok pilihan; tidak tahu ditanda NA (latihan sahaja)', 'Nama fail kini dalam huruf Inggeris sahaja; sila guna nama Inggeris', 'Foto yang sama tidak dimuat naik dua kali; foto bernota atau latihan sahaja direkod dalam Google Sheet'],
    },
  },
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
