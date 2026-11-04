# Durimage

榴莲病虫害拍照 PWA。工人不用登录 Google，拍的照片全部存进**管理员（你）的 Google Drive**。中文 / English / Bahasa Melayu。

## 运作方式

```
1. 手机 ──团队密码 + 照片资料──▶ Apps Script（用你的账号执行）──开上传通道──▶ Google Drive
2. 手机 ──────────────── 原图直接上传 ────────────────────────────────▶ 你的 Google Drive
```

- App 是纯静态网页，没有服务器。
- Apps Script 用你的 Google 账号运行，只负责验证密码、开一个"只能写这一张照片"的上传通道。照片原图由手机直接传进你的 Drive，所以没有大小限制，也不会被压缩。
- 你的 Google 登录凭证不会传到手机上。
- 团队密码存在 Apps Script 的 Script Properties 里，不在程序码、也不在 GitHub。

## 工人怎么用

1. 打开 App，第一次要做两步：
   - **第 1 步：输入团队密码**（需要网络，密码错了不能继续）
   - **第 2 步：输入名字**（没填不能继续）
2. 按中间快门拍照（或从相册选）→ 选文件夹 → 可写备注 → 保存。
3. 照片先存在手机里，有网络就自动上传；果园没信号会排队，有网络再打开 App 会继续传。

**注解（.txt）**：保存照片时可以写注解。有写的话，同一个文件夹里会多一个**同名的 `.txt`**，例如：

```
durian_果腐病_20261104_124426_阿明_e233e4.jpg
durian_果腐病_20261104_124426_阿明_e233e4.txt   ← 注解、拍摄者、时间、GPS
```

没写注解就不会产生 .txt。注解也同时写在照片的 Drive「描述」里，但从 Drive 下载照片时描述不会跟着下载，所以 .txt 才是整理资料时可靠的那份。`.txt` 用 UTF-8 编码，Windows 记事本可以正常显示中文。

上传到 Drive 的照片：
- 文件名：`durian_<文件夹>_<日期_时间>_<名字>_<编号>.jpg`
- 描述：备注、拍摄者、拍摄时间、GPS 座标和 Google Maps 链接
- **上传的是原图**（完整分辨率，保留相机的 EXIF 资料）。
- 备用方案：如果某支手机无法直传原图，那支手机会改传压缩版（长边 2560px），描述最后会注明 `Compressed copy`。这只会在该手机从来没成功传过原图时才启用，避免因为一时没信号就降级。

## 一次性设置（管理员）

### 1. 在 Drive 建文件夹

建一个总文件夹，例如 `Durimage`，里面建分类子文件夹（`果腐病`、`蛀果虫`、`叶斑病`…）。
App 会自动列出总文件夹下的**子文件夹**。以后新增子文件夹，工人在 App 里点「刷新」就会出现。

打开总文件夹，复制网址最后那段 ID：
`https://drive.google.com/drive/folders/`**`1AbCdEf...`** ← 这段

### 2. 建 Apps Script

1. 打开 <https://script.google.com> → 新项目，命名 `Durimage`。
2. 把 `apps-script/Code.gs` 的内容整个贴进去，取代原本的代码，存档。
3. 左边 ⚙️ **项目设置（Project Settings）** → 拉到最下 **脚本属性（Script Properties）** → 新增两个：

   | 属性 | 值 |
   |---|---|
   | `TEAM_PASSWORD` | 你要的团队密码 |
   | `ROOT_FOLDER_ID` | 第 1 步复制的文件夹 ID |

4. 右上 **部署（Deploy）→ 新部署（New deployment）** → 类型选 **网页应用（Web app）**：
   - 执行身份（Execute as）：**我（Me）**
   - 谁可以访问（Who has access）：**任何人（Anyone）**
5. 按部署，第一次会要求授权你的 Google 账号（会要求 Drive 和"连接外部服务"两项权限，后者用来开上传通道）（会出现"Google 尚未验证此应用"，按 *Advanced → Go to Durimage* 继续，因为这是你自己的脚本）。
6. 复制 **网页应用网址**（结尾是 `/exec`）。

### 3. 把网址填进 App

打开 `config.js`，填入：

```js
SCRIPT_URL: 'https://script.google.com/macros/s/xxxxxxxx/exec',
```

提交到 GitHub，GitHub Pages 会自动更新。

## 分享 App

右上角 QR 按钮（或 设置 → 分享 App）会显示 App 网址的 QR code，对方用手机相机扫描就能打开。QR 里**不含**团队密码，要另外告诉对方。

## 更改团队密码

1. 打开 <https://script.google.com> → Durimage 项目 → ⚙️ 项目设置 → 脚本属性。
2. 编辑 `TEAM_PASSWORD`，存档。**马上生效，不用重新部署。**
3. 工人的手机下次上传或刷新文件夹时，App 会跳出「团队密码已更改」画面要他们输入新密码。还没上传的照片不会丢，输入后会继续上传。

> 只有改 `Code.gs` 的代码才需要重新部署：部署 → 管理部署 → ✏️ 编辑 → 版本选「新版本」→ 部署（网址不变）。

## 安全说明

- 团队密码只能挡住"拿到网址就乱传"的情况，不是高强度保护。人员离开团队时建议改密码。
- Apps Script 只允许把照片存进总文件夹的直接子文件夹，只收图片，单张上限 15 MB。

## 本地测试

```bash
python3 -m http.server 8765
# 打开 http://localhost:8765
```

`config.js` 的 `SCRIPT_URL` 留空时是演示模式：假文件夹、假上传，任何密码都可以。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` / `styles.css` | 页面与样式 |
| `app.js` | 首次设置、拍照、压缩、上传队列（IndexedDB） |
| `i18n.js` | 三语文字 |
| `config.js` | Apps Script 网址 |
| `apps-script/Code.gs` | 后端：验证密码、列文件夹、开上传通道（原图）、备用压缩上传 |
| `icons/` | App icon（榴莲法师）与 header 用的 `mark.svg` |
| `vendor/qrcode.js` | QR code 产生器（MIT，Kazuhiko Arase） |
| `sw.js` / `manifest.webmanifest` | PWA 离线缓存与安装 |
