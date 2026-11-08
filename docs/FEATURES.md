# Xcratch 主要機能ドキュメント

## 目次

1. [拡張機能ローダー](#拡張機能ローダー)
2. [PWA サポート](#pwa-サポート)
3. [Web Bluetooth API](#web-bluetooth-api)
4. [ローカルバックパック](#ローカルバックパック)
5. [URL からのプロジェクト読み込み](#url-からのプロジェクト読み込み)
6. [ワークスペースクリーンアップ](#ワークスペースクリーンアップ)
7. [日本語対応](#日本語対応)

---

## 拡張機能ローダー

### 概要

Xcratch の拡張機能ローダーは、Scratch の機能を動的に拡張するための仕組みです。ユーザーは必要な拡張機能を検索、選択、ロードすることができます。

### 主な機能

#### 1. タグベースの分類

拡張機能は以下のようなタグで分類されます:
- **image**: 画像処理
- **sound**: 音声処理
- **text**: 文字列操作
- **calculation**: 数学・計算
- **network**: ネットワーク通信
- **device**: ハードウェア連携
- **function**: 機能・ロジック
- **ai**: 人工知能/機械学習

タグの定義は [src/lib/libraries/extension-tags.js](../packages/scratch-gui/src/lib/libraries/extension-tags.js) にあります。

#### 2. カテゴリベースの分類

拡張機能は読み込み方式別にカテゴリ分けされています:

- **ビルトイン拡張機能**: Scratch 公式が提供する拡張機能
- **読み込み済み**: ユーザーがそのプロジェクトに追加したカスタム拡張機能
- **先読み済み拡張機能**: 事前にプリロードされている拡張機能

#### 3. 検索機能

- キーワードによる拡張機能の検索
- タグによるフィルタリング

#### 4. 先読み拡張機能

editor と一緒に配る拡張機能のミラーです。配布元につながらないフィルタ環境や、PWA のオフライン環境でも拡張機能を読み込めます。先読みするセットは editor のビルド後に差し替えられ、`?preload=<manifest の URL>` でも選べます。

詳しくは [PRELOAD.md](PRELOAD.md) を見てください。

### 実装の詳細

#### 主要ファイル

- **拡張機能ライブラリ UI**: [src/containers/extension-library.jsx](../packages/scratch-gui/src/containers/extension-library.jsx)
- **ライブラリアイテム**: [src/components/library-item/library-item.jsx](../packages/scratch-gui/src/components/library-item/library-item.jsx)
- **拡張機能マネージャー**: [packages/scratch-vm/src/extension-support/extension-manager.js](../packages/scratch-vm/src/extension-support/extension-manager.js)

#### カスタマイズ

拡張機能ローダーの翻訳やカスタマイズは以下のファイルで行います:

- [src/containers/extension-library-translations.js](../packages/scratch-gui/src/containers/extension-library-translations.js)
- [src/lib/libraries/xcratch-category-translations.js](../packages/scratch-gui/src/lib/libraries/xcratch-category-translations.js)
- [src/lib/libraries/xcratch-tag-translations.js](../packages/scratch-gui/src/lib/libraries/xcratch-tag-translations.js)

---

## PWA サポート

### 概要

Progressive Web App (PWA) サポートにより、Xcratch をホーム画面にインストールして、オフラインでも使用できるようになりました。

### 主な機能

1. **オフライン動作**
   - Service Worker によるアセットのキャッシング
   - オフライン時でもアプリケーションが動作

2. **インストール可能**
   - ホーム画面への追加
   - ネイティブアプリのような体験

3. **アイコン**
   - 通常アイコン: [static/pwa-icon.png](../packages/scratch-gui/static/pwa-icon.png)
   - マスカブルアイコン: [static/pwa-maskable_icon.png](../packages/scratch-gui/static/pwa-maskable_icon.png)

### 実装の詳細

#### アセットマニフェスト生成

[scripts/makePWAAssetsManifest.js](../packages/scratch-gui/scripts/makePWAAssetsManifest.js) スクリプトが、PWA に必要なアセットマニフェストを自動生成します。

#### Service Worker

Service Worker の設定は [src/playground/index.ejs](../packages/scratch-gui/src/playground/index.ejs) で行われています。

---

## Web Bluetooth API

### 概要

Web Bluetooth API を使用して、BLE (Bluetooth Low Energy) デバイスと通信できるようになりました。

### サポートデバイス

- micro:bit
- Arduino (BLE 対応)
- その他の BLE デバイス

### 実装の詳細

#### 主要ファイル

- **BLE Web 実装**: [packages/scratch-vm/src/io/ble-web.js](../packages/scratch-vm/src/io/ble-web.js)
- **BLE インターフェース**: [packages/scratch-vm/src/io/ble.js](../packages/scratch-vm/src/io/ble.js)

#### 使用方法

```javascript
// BLE デバイスへの接続
const device = await navigator.bluetooth.requestDevice({
  filters: [{ services: ['service-uuid'] }]
});

// GATT サーバーへの接続
const server = await device.gatt.connect();
```

### セキュリティ

Web Bluetooth API は HTTPS 接続が必要です。開発時は localhost でのみ動作します。

---

## ローカルバックパック

### 概要

`localStorage` を使用したバックパック実装により、オフライン環境でもブロックやスプライトを保存・再利用できます。

### 主な機能

1. **ローカルストレージ**
   - ブラウザの localStorage にデータを保存
   - サーバー接続不要

2. **データの永続化**
   - ブラウザを閉じてもデータが保持される
   - ブロック、スプライト、コスチューム、サウンドをバックパックに保存

### 実装の詳細

#### 主要ファイル

- **バックパック API**: [src/lib/backpack-api.js](../packages/scratch-gui/src/lib/backpack-api.js)
- **バックパックコンテナ**: [src/containers/backpack.jsx](../packages/scratch-gui/src/containers/backpack.jsx)
- **コスチュームペイロード**: [src/lib/backpack/costume-payload.js](../packages/scratch-gui/src/lib/backpack/costume-payload.js)

#### ストレージキー

バックパックのデータは以下のキーで保存されます:

```javascript
const BACKPACK_KEY = 'xcratch-backpack';
```

---

## URL からのプロジェクト読み込み

### 概要

URL パラメータまたはハッシュパラメータを使用して、プロジェクトを直接読み込むことができます。

### 使用方法

#### 1. URL パラメータを使用

```
https://xcratch.github.io/?url=https://example.com/project.sb3
```

#### 2. ハッシュパラメータを使用

```
https://xcratch.github.io/#https://example.com/project.sb3
```

### 実装の詳細

#### 主要ファイル

- **ハッシュパーサー**: [src/lib/hash-parser-hoc.jsx](../packages/scratch-gui/src/lib/hash-parser-hoc.jsx)
- **VM マネージャー**: [src/lib/vm-manager-hoc.jsx](../packages/scratch-gui/src/lib/vm-manager-hoc.jsx)

#### プロジェクトデータの取得

```javascript
// URL からプロジェクトデータを取得
const response = await fetch(projectUrl);
const projectData = await response.arrayBuffer();
```

---

## コードクリーンアップ

### 概要

コードを整理整頓するための「きれいにする」機能を強化しています。縦方向だけでなく、横方向の整理もサポートし、ブロックの移動アニメーションによる視覚的なフィードバックも追加しました。

### 主な機能

1. **ブロックの整理**
   - 縦方向および横方向の整理

2. **ユーザビリティ向上**
   - アニメーションによる視覚的フィードバック
   - undo/redo サポート

### 実装の詳細

#### 主要ファイル

- **拡張クリーンアップ**: [src/lib/enhanced-cleanup.js](../packages/scratch-gui/src/lib/enhanced-cleanup.js)
- **クリーンアップユーティリティ**: [src/lib/cleanup-utils.js](../packages/scratch-gui/src/lib/cleanup-utils.js)

#### 詳細ドキュメント

詳しい使い方は [enhanced-cleanup-ja.md](../packages/scratch-gui/docs/enhanced-cleanup-ja.md) を参照してください。

---

## 日本語対応

### 概要

日本語環境での使いやすさを向上させるため、カスタム翻訳と全角文字サポートを追加しました。

### 主な機能

#### 1. カスタムブロック翻訳

Scratch のデフォルト翻訳を上書きして、より適切な日本語訳を提供します。

**実装ファイル**:
- [src/lib/blocks-override-translations.js](../packages/scratch-gui/src/lib/blocks-override-translations.js)
- [src/lib/blocks.js](../packages/scratch-gui/src/lib/blocks.js)

#### 2. 欠落翻訳の追加

未翻訳だった項目の日本語訳を追加しました。

**実装ファイル**:
- [src/lib/missing-translations.js](../packages/scratch-gui/src/lib/missing-translations.js)

#### 3. 全角数字サポート

全角数字を自動的に半角数字に変換して処理します。

```javascript
// 例: "123" → 123
// 例: "1.23" → 1.23
```

**実装ファイル**:
- [packages/scratch-vm/src/util/cast.js](../packages/scratch-vm/src/util/cast.js)

#### 4. 制御文字列のサポート

'say'、'think'、'equal' ブロックで改行 (`\n`) とタブ (`\t`) が使えるようになりました。

```
say "こんにちは\n世界"
```

**実装ファイル**:
- [packages/scratch-vm/src/blocks/scratch3_looks.js](../packages/scratch-vm/src/blocks/scratch3_looks.js)

---

## その他の改善

### ブロックパレットの改善

マウスオーバー時にブロック全体の形状を表示することで、ブロックの接続部分を確認しやすくなりました。

**実装ファイル**:
- [src/components/blocks/blocks.css](../packages/scratch-gui/src/components/blocks/blocks.css)

### プレイヤーコンポーネント

埋め込みプレイヤーからエディタを開く機能や、フルスクリーンモードのサポートを追加しました。

**実装ファイル**:
- [src/playground/player.jsx](../packages/scratch-gui/src/playground/player.jsx)

---

## 開発者向け情報

### VSCode デバッグ設定

VSCode でのデバッグをサポートしています。

**設定ファイル**:
- [.vscode/launch.json](../.vscode/launch.json)
- [.vscode/settings.json](../.vscode/settings.json)
- [.vscode/tasks.json](../.vscode/tasks.json)

### GitHub Actions

GitHub Pages へのデプロイワークフローを追加しました。

**ワークフローファイル**:
- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)

### ビルド設定

Webpack 設定を更新して、PWA サポートや拡張機能ローダーに対応しました。

**設定ファイル**:
- [packages/scratch-gui/webpack.config.js](../packages/scratch-gui/webpack.config.js)

---

## 参考資料

- [Xcratch 公式サイト](https://xcratch.github.io/)
- [Scratch 公式サイト](https://scratch.mit.edu/)
- [Web Bluetooth API ドキュメント](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [PWA ドキュメント](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
