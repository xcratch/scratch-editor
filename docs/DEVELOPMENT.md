# Xcratch 開発ドキュメント

## 目次

1. [プロジェクト構成](#プロジェクト構成)
2. [主要コンポーネント](#主要コンポーネント)
3. [拡張機能システム](#拡張機能システム)
4. [データフロー](#データフロー)
5. [ビルドプロセス](#ビルドプロセス)
6. [開発ワークフロー](#開発ワークフロー)

---

## プロジェクト構成

Xcratch は monorepo 構成を採用しており、複数のパッケージで構成されています。

```
scratch-editor/
├── packages/
│   ├── scratch-gui/        # フロントエンド UI
│   ├── scratch-vm/         # 仮想マシン (ブロック実行エンジン)
│   ├── scratch-render/     # レンダリングエンジン
│   └── ...
├── .vscode/                # VSCode 設定
├── .github/                # GitHub Actions
└── docs/                   # ドキュメント
```

### パッケージの役割

#### scratch-gui

- **役割**: ユーザーインターフェース
- **技術**: React, Redux
- **主な機能**:
  - エディタ UI
  - 拡張機能ライブラリ
  - メニューバー
  - ステージ表示

#### scratch-vm

- **役割**: ブロックの実行エンジン
- **技術**: JavaScript
- **主な機能**:
  - ブロックの解釈と実行
  - スプライトの管理
  - 拡張機能の読み込み
  - イベント処理

#### scratch-render

- **役割**: グラフィックレンダリング
- **技術**: WebGL
- **主な機能**:
  - スプライトの描画
  - エフェクト処理
  - ステージレンダリング

---

## 主要コンポーネント

### 1. 拡張機能ローダー

#### コンポーネント階層

```
GUI (gui.jsx)
  └── ExtensionLibrary (extension-library.jsx)
       ├── LibraryItem (library-item.jsx)
       └── AsyncModal (async-modal.jsx)
```

#### 処理フロー

1. **拡張機能リストの読み込み**
   ```javascript
   // extension-library.jsx
   const extensions = require('./lib/libraries/extensions/index.jsx');
   ```

2. **タグ・カテゴリによるフィルタリング**
   ```javascript
   const filteredExtensions = extensions.filter(ext => {
     return matchesTag(ext, selectedTag) &&
            matchesCategory(ext, selectedCategory);
   });
   ```

3. **プリロード処理**
   ```javascript
   // preload.mjs で事前に情報を取得
   const preloadData = await fetchExtensionMetadata(extensionURL);
   ```

4. **拡張機能の読み込み**
   ```javascript
   // extension-manager.js
   loadExtensionURL(extensionURL).then(extensionInfo => {
     vm.extensionManager.loadExtensionIdByURL(extensionInfo);
   });
   ```

### 2. VM マネージャー

#### 責務

- プロジェクトの読み込み
- VM のライフサイクル管理
- URL パラメータからのプロジェクト読み込み

#### コード例

```javascript
// vm-manager-hoc.jsx
class VMManager extends React.Component {
  componentDidMount() {
    // URL からプロジェクトを読み込み
    const projectUrl = this.getProjectUrlFromParams();
    if (projectUrl) {
      this.loadProjectFromURL(projectUrl);
    }
  }

  loadProjectFromURL(url) {
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buffer => this.props.vm.loadProject(buffer));
  }
}
```

### 3. バックパックシステム

#### アーキテクチャ

```
Backpack Container (backpack.jsx)
  └── Backpack API (backpack-api.js)
       └── localStorage
```

#### ストレージ構造

```javascript
// localStorage key
const BACKPACK_KEY = 'xcratch-backpack';

// データ構造
{
  items: [
    {
      type: 'block',
      data: { ... },
      thumbnail: 'data:image/png;base64,...'
    },
    {
      type: 'sprite',
      data: { ... },
      thumbnail: 'data:image/png;base64,...'
    }
  ]
}
```

---

## 拡張機能システム

### 拡張機能の構造

拡張機能は以下のインターフェースに従います:

```javascript
class ExtensionExample {
  constructor(runtime) {
    this.runtime = runtime;
  }

  getInfo() {
    return {
      id: 'extensionExample',
      name: '拡張機能例',
      blocks: [
        {
          opcode: 'exampleBlock',
          blockType: BlockType.COMMAND,
          text: '例ブロック [TEXT]',
          arguments: {
            TEXT: {
              type: ArgumentType.STRING,
              defaultValue: 'こんにちは'
            }
          }
        }
      ]
    };
  }

  exampleBlock(args) {
    console.log(args.TEXT);
  }
}
```

### 拡張機能の登録

#### 静的登録

```javascript
// extensions/index.jsx
export default [
  {
    name: '拡張機能例',
    extensionId: 'extensionExample',
    iconURL: extensionExampleIconURL,
    insetIconURL: extensionExampleInsetIconURL,
    description: '拡張機能の説明',
    featured: true,
    disabled: false,
    bluetoothRequired: false,
    internetConnectionRequired: false,
    helpLink: 'https://example.com/help',
    tags: ['device', 'sensor']
  }
];
```

#### 動的ロード

```javascript
// extension-manager.js
loadExtensionURL(extensionURL) {
  return this.securityManager.canLoadExtensionFromOrigin(extensionURL)
    .then(() => fetch(extensionURL))
    .then(response => response.text())
    .then(body => {
      const extension = this._loadExtensionFromScript(body);
      return extension;
    });
}
```

### プリロードシステム

#### プリロードルール

先読みする拡張機能のURLリストは [scratch-gui/scripts/preload-rules.json](../packages/scratch-gui/scripts/preload-rules.json) に定義されています。

`npm run preload` コマンドでこれらの拡張機能がダウンロードされ、`preload/` フォルダに保存されます。

```json
{
    "approved": [
        "https://yokobond.github.io/xcx-costumex/dist/costumex.mjs",
        "https://microbit-more.github.io/dist/microbitMore.mjs"
    ]
}
```

#### プリロードスクリプト

```javascript
// preload.mjs
async function preloadExtension(extensionPath) {
  const module = await import(extensionPath);
  const metadata = {
    name: module.name,
    description: module.description,
    tags: module.tags
  };
  return metadata;
}
```

#### プリロードのフロー

プリロードシステムは、ビルド時とランタイムの2段階で動作します。

##### 1. ビルド時プリロード (`npm run preload`)

```
npm run preload
  ↓
scripts/preload.mjs 実行
  ↓
preload-rules.json から承認済みURLリストを読み込み
  ↓
各URLに対して:
  ├─ fetchWithTimeout() で拡張機能をダウンロード
  ├─ isValidExtensionContent() でコンテンツを検証
  │   └─ 'entry' または 'blockClass' の存在を確認
  ├─ コンテンツタイプを判定:
  │   ├─ entry のみ (Separate型):
  │   │   ├─ entry.mjs として保存
  │   │   ├─ extractExtensionURL() で extensionURL を抽出
  │   │   ├─ resolveExtensionURL() で相対パスを解決
  │   │   └─ blockClass をダウンロードして extension.mjs として保存
  │   └─ entry + blockClass (Integrated型):
  │       └─ extension.mjs として保存
  └─ preload/{エンコードされたURL}/ に保存
  ↓
ダウンロード成功した拡張機能のリストを
preload/preload.json に出力
  └─ [{url: "...", path: "...", extensionURL: "..."}]
      ├─ url: preload-rules.json に書かれたソース URL
      └─ extensionURL: blockClass を含むモジュールの URL
          (Separate型では entry の extensionURL を解決した body の URL、Integrated型では url と同じ)
```

##### 2. ランタイムロード (アプリ起動時)

```
アプリ起動
  ↓
extension-library.jsx の loadModules() が実行
  ↓
require.context() で preload.json を遅延ロード
  ├─ preload.json が存在しない場合は空配列を返す
  └─ preload.json から拡張機能リストを取得
  ↓
require.context() で preload/**/(entry|extension).mjs を登録
  ↓
各拡張機能に対して:
  ├─ ディレクトリ内のファイル構造を判定:
  │   ├─ entry.mjs + extension.mjs → Separate型
  │   └─ extension.mjs のみ → Integrated型
  ├─ Separate型の場合:
  │   ├─ entry.mjs をロード (entry情報のみ)
  │   ├─ blockClass は null に設定
  │   └─ blockClassContextKey に extension.mjs のパスを保存
  │       (実際のロードは拡張機能選択時に遅延実行)
  └─ Integrated型の場合:
      ├─ extension.mjs をロード
      └─ entry と blockClass の両方を取得
  ↓
ロードした拡張機能を名前順にソート
  ↓
extensionLibraryContent に追加
  ├─ category を 'preloaded' に設定
  ├─ extensionURL に preload.json の extensionURL (blockClass を含むモジュールの URL) を設定
  │   └─ カードの "Module:" 表示・プロジェクトに保存される URL はこの値になる
  └─ 重複チェック (extensionId または extensionURL で判定)
  ↓
拡張機能ライブラリに表示可能
```

##### プリロードの型の違い

TensorFlow のような様々な拡張機能で利用されるライブラリを含む拡張機能ではSeparate型を使用して、拡張機能選択時に blockClass を遅延ロードすることで、ライブラリのバージョン違いによる衝突の回避を図っています。

**Integrated型** (統合型):
```javascript
// extension.mjs
export const entry = { /* entry情報 */ };
export const blockClass = class { /* ブロック実装 */ };
```
- entry と blockClass が同じファイルに含まれる
- ビルド時に1つのファイルとしてダウンロード
- ランタイムで entry と blockClass を同時にロード

**Separate型** (分離型):
```javascript
// entry.mjs
export const entry = {
  extensionURL: 'https://example.com/extension.mjs',
  /* その他の entry 情報 */
};

// extension.mjs (別ファイル)
export const blockClass = class { /* ブロック実装 */ };
```
- entry と blockClass が別々のファイル
- ビルド時に両方のファイルをダウンロード
- ランタイムでは entry のみを先にロード
- blockClass は拡張機能選択時に遅延ロード (利用ライブラリの衝突を回避)

---

## データフロー

### プロジェクト読み込みフロー

```
URL パラメータ
  ↓
HashParserHOC (hash-parser-hoc.jsx)
  ↓
VMManagerHOC (vm-manager-hoc.jsx)
  ↓
VM.loadProject() (virtual-machine.js)
  ↓
SB3 デシリアライゼーション (sb3.js)
  ↓
スプライト・ブロック・アセットの復元
  ↓
レンダリング
```

### 拡張機能読み込みフロー

```
ユーザー選択
  ↓
ExtensionLibrary (extension-library.jsx)
  ↓
VM.extensionManager.loadExtensionURL()
  ↓
拡張機能スクリプトのフェッチ
  ↓
拡張機能クラスのインスタンス化
  ↓
ブロックの登録
  ↓
UI 更新
```

### ブロック実行フロー

```
ユーザー操作 (緑の旗クリック)
  ↓
VM.runtime.startHats() (runtime.js)
  ↓
ブロックの実行キューに追加
  ↓
Sequencer (sequencer.js)
  ↓
execute() でブロックを実行
  ↓
拡張機能のメソッド呼び出し
  ↓
結果を返す
```

---

## ビルドプロセス

### Webpack 設定

#### 主要な設定

```javascript
// webpack.config.js
module.exports = {
  entry: {
    gui: './src/playground/index.jsx',
    player: './src/playground/player.jsx'
  },
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: '[name].js'
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/playground/index.ejs'
    }),
    new WorkboxPlugin.GenerateSW({
      // PWA Service Worker 設定
      clientsClaim: true,
      skipWaiting: true
    })
  ]
};
```

### ビルドステップ

1. **依存関係のインストール**
   ```bash
   npm install
   ```

2. **開発ビルド**
   ```bash
   npm run start
   ```

3. **プロダクションビルド**
   ```bash
   npm run build
   ```

4. **PWA アセットマニフェスト生成**
   ```bash
   node scripts/makePWAAssetsManifest.js
   ```

5. **拡張機能プリロード**
   ```bash
   node scripts/preload.mjs
   ```

### GitHub Actions ワークフロー

[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) で、GitHub Pages への自動デプロイを設定しています。

依存パッケージのインストールは `NODE_ENV=development npm ci` で行っています。

ビルドされたファイルは `editor/` にコピーされ、`gh-pages` ブランチにデプロイされます。

GitHub Pages を `gh-pages` ブランチの `/(root)` フォルダから配信する設定にすると次のURLでエディタにアクセスできます:
`https://<username>.github.io/scratch-editor/editor/`

---

## 開発ワークフロー

### ローカル開発

#### 1. リポジトリのクローン

```bash
git clone https://github.com/xcratch/scratch-editor.git
cd scratch-editor
```

#### 2. 依存関係のインストール

```bash
npm install
```

#### 3. 開発サーバーの起動

webpack-dev-server は [packages/scratch-gui/webpack.config.js](../packages/scratch-gui/webpack.config.js) で HTTPS として起動するように変更されています。
HTTPS に必要な認証情報は、それぞれの環境で設定してください。 [mkcert](https://github.com/FiloSottile/mkcert) などでローカルに証明書を用意する必要があります。

webpack.config.js :
```javascript
// ...

// Enable HTTPS for the dev server
buildConfig.merge({
    devServer: {
        server: {
            type: 'https',
            options: {
                key: '../../.vscode/localhost-key.pem', // パスは環境に合わせて変更してください
                cert: '../../.vscode/localhost.pem' // パスは環境に合わせて変更してください
            }
        }
    }
});

// ...
```

```bash
npm run start
```

ブラウザで `https://localhost:8601` にアクセス

---

### VSCode デバッグ

#### デバッグ設定

[.vscode/tasks.json](../.vscode/tasks.json) で開発サーバーの起動タスクを定義しています。

```json
{
	"version": "2.0.0",
	"tasks": [
		{
			"type": "shell",
			"command": "export NODE_ENV='development' && npm run start --prefix ./packages/scratch-gui/",
      // ...
    }
  ]
}
```

[.vscode/launch.json](../.vscode/launch.json) で Chrome デバッガーを設定しています。
`webRoot` はワークスペースの親に設定してあり、開発中の拡張機能のリポジトリをこのディレクトリに並べてローカルサーバーでアクセスさせると、その拡張機能のソースマップを解決できるようにしています。`sourceMapPathOverrides` の ` "https://0.0.0.0:5500/*": "${webRoot}/*"` はローカルで拡張機能サーバーを立ててデバッグする場合の例です。 `

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "launch",
      "preLaunchTask": "start https",
      "name": "debug on dev-server",
      "url": "https://localhost:8601/",
      "webRoot": "${workspaceFolder}/..",
      "sourceMaps": true,
      "sourceMapRenames": true,
      "sourceMapPathOverrides": {
        "webpack://GUI/*": "${webRoot}/scratch-editor/packages/scratch-gui/*",
        "webpack://GUI/scratch-vm/*": "${webRoot}/scratch-editor/packages/scratch-vm/*",
        "webpack://GUI/scratch-render/*": "${webRoot}/scratch-editor/packages/scratch-render/*",
        "webpack://GUI/scratch-svg-renderer/*": "${webRoot}/scratch-editor/packages/scratch-svg-renderer/*",
        "https://0.0.0.0:5500/*": "${webRoot}/*", // local extension server for debugging
      }
    },
    // ...
  ]
}
```

#### 使い方

1. VSCode でプロジェクトを開く
2. F5 キーを押してデバッグ開始
3. ブレークポイントを設定してデバッグ

---
### ブランチ戦略

- **develop**: 開発ブランチ (デフォルト)
- **xcratch**: Xcratch 固有の機能
- **xc/***: 機能ブランチ
- **hotfix/***: 緊急修正

### コミットメッセージ

Conventional Commits に従います:

```
feat: 新機能追加
fix: バグ修正
docs: ドキュメント更新
style: コードスタイル変更
refactor: リファクタリング
test: テスト追加
chore: ビルド・設定変更
```

---

## テスト

### テストの実行

```bash
# すべてのテストを実行
npm test

# 特定のパッケージのテストを実行
cd packages/scratch-gui
npm test

# ウォッチモード
npm test -- --watch
```

---

## トラブルシューティング

### よくある問題

#### 1. ビルドエラー

```bash
# node_modules を削除して再インストール
rm -rf node_modules package-lock.json
npm install
```

#### 2. 拡張機能が読み込めない

- HTTPS で配信されているか確認
- CORS ヘッダーが正しく設定されているか確認
- 拡張機能の URL が正しいか確認

#### 3. PWA が動作しない

- HTTPS で配信されているか確認
- Service Worker が正しく登録されているか確認
- manifest.json が正しく配置されているか確認

---

## 参考資料

- [Scratch Wiki](https://en.scratch-wiki.info/)
- [React ドキュメント](https://react.dev/)
- [Redux ドキュメント](https://redux.js.org/)
- [Webpack ドキュメント](https://webpack.js.org/)
- [PWA ドキュメント](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
