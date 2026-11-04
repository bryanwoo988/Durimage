# Durimage

榴莲病虫害拍照 PWA：拍照 → 选 Google Drive 文件夹 → 自动上传。中文 / English / Bahasa Melayu。

纯静态文件（HTML/CSS/JS），不需要后端，不需要 build。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` / `styles.css` | 页面与样式 |
| `app.js` | 拍照、上传队列（IndexedDB）、Google 登录、Picker |
| `i18n.js` | 三语文字 |
| `config.js` | 填 Google Client ID / API key / Project number |
| `sw.js` / `manifest.webmanifest` | PWA 离线缓存与安装 |

`config.js` 的 `CLIENT_ID` 留空时是 **演示模式**（假文件夹、假上传），可先看界面。

## 用到的 Google API

| API | 用途 |
|---|---|
| Google Identity Services（token model） | 浏览器内 OAuth 登录拿 access token |
| Google Picker API | 让用户从自己 Drive 选已建好的文件夹 |
| Google Drive API v3 `files.create`（resumable upload） | 把照片上传到选定文件夹 |
| Drive API `about.get` | 显示登录账号 |

OAuth scope 只用 `https://www.googleapis.com/auth/drive.file`（非敏感 scope）。App 只能访问：用户在 Picker 里选过的文件夹，以及 App 自己上传的文件。

## Google Cloud 设置步骤

1. 到 <https://console.cloud.google.com/> 新建项目（例：`durimage`）。
2. **APIs & Services → Library**，启用 **Google Drive API** 和 **Google Picker API**。
3. **OAuth consent screen**（Google Auth Platform）：
   - User type 选 External（个人 Gmail）或 Internal（Workspace）。
   - Scope 加 `.../auth/drive.file`。
   - 保持 *Testing* 状态时，把会用这个 App 的 Gmail 加进 **Test users**（上限 100 人）。
4. **Credentials → Create credentials → OAuth client ID**，类型 *Web application*：
   - Authorized JavaScript origins 填你部署的网址，例如 `https://<你的用户名>.github.io`，本地测试加 `http://localhost:8765`。
   - 复制 Client ID 填进 `config.js` 的 `CLIENT_ID`。
5. **Credentials → Create credentials → API key**：限制为 *Google Picker API*，并加 HTTP referrer 限制为你的网址。填进 `API_KEY`。
6. 项目首页（Dashboard）的 **Project number** 填进 `APP_ID`（Picker 需要它才能把文件夹权限授权给 App）。

## 部署

需要 HTTPS（相机、Service Worker、OAuth 都要求）。最简单：GitHub Pages（Settings → Pages → 选 branch / root）。

本地测试：

```bash
python3 -m http.server 8765
# 打开 http://localhost:8765
```

## 使用流程

1. 在 Google Drive 先建好文件夹（例：`果腐病`、`蛀果虫`、`叶斑病`）。
2. App 里登录 Google → 文件夹 → 「从 Drive 添加文件夹」→ 多选。
3. 按中间快门拍照（用手机原生相机，保留完整分辨率和 EXIF）→ 选文件夹 → 可写备注 → 保存。
4. 照片先存手机（IndexedDB），有网络就自动上传；果园没信号时会排队，回到有网络的地方打开 App 继续传。

上传到 Drive 的文件：
- 文件名：`durian_<文件夹名>_YYYYMMDD_HHMMSS.jpg`
- 描述（Description）：备注、拍摄时间、GPS 座标与 Google Maps 链接
