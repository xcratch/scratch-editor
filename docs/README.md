# Xcratch ドキュメント

このディレクトリには、Xcratch の開発に関するドキュメントが含まれています。

## ドキュメント一覧

### [CHANGELOG.md](CHANGELOG.md)
コミット e7565a720ecf766fad3662768387eff3a4be2a66 以降の変更履歴をまとめたドキュメントです。

**内容:**
- 新機能の一覧
- バグ修正
- UI/UX の改善
- ローカライゼーション
- 開発環境の改善
- パッケージ更新

**対象読者:**
- プロジェクトマネージャー
- 開発者
- ユーザー

---

### [PRELOAD.md](PRELOAD.md)
先読み拡張機能（ビルド後に差し替えられるセット、`?preload=`、PWA のオフライン対応）の説明です。

**対象読者:**
- editor を配布する人
- 開発者

---

### [FEATURES.md](FEATURES.md)
Xcratch の主要機能について詳しく説明したドキュメントです。

**内容:**
- 拡張機能ローダー
- PWA サポート
- Web Bluetooth API
- ローカルバックパック
- URL からのプロジェクト読み込み
- ワークスペースクリーンアップ
- 日本語対応
- その他の改善

**対象読者:**
- ユーザー
- 開発者
- ドキュメント作成者

---

### [DEVELOPMENT.md](DEVELOPMENT.md)
Xcratch の技術的なアーキテクチャや開発プロセスについて詳しく説明したドキュメントです。

**内容:**
- プロジェクト構成
- 主要コンポーネント
- 拡張機能システム
- データフロー
- ビルドプロセス
- 開発ワークフロー
- テスト
- パフォーマンス最適化
- セキュリティ
- トラブルシューティング

**対象読者:**
- 開発者
- アーキテクト
- コントリビューター

---

## クイックスタート

### ユーザー向け

Xcratch を使い始めるには:

1. [Xcratch 公式サイト](https://xcratch.github.io/) にアクセス
2. 拡張機能を選択してプロジェクトを作成
3. [FEATURES.md](FEATURES.md) で各機能の使い方を確認

### 開発者向け

Xcratch の開発に参加するには:

1. リポジトリをクローン
   ```bash
   git clone https://github.com/xcratch/scratch-editor.git
   cd scratch-editor
   ```

2. 依存関係をインストール
   ```bash
   npm install
   ```

3. 開発サーバーを起動
   ```bash
   npm run start
   ```

4. [DEVELOPMENT.md](DEVELOPMENT.md) でアーキテクチャを理解

---

## 主要な変更のハイライト

### 拡張機能ローダー

動的に拡張機能を読み込む機能を実装しました。タグとカテゴリによる分類、検索機能、プリロード機能をサポートしています。

詳細: [FEATURES.md#拡張機能ローダー](FEATURES.md#拡張機能ローダー)

### PWA サポート

Progressive Web App として動作するようになり、オフラインでも使用可能になりました。

詳細: [FEATURES.md#pwa-サポート](FEATURES.md#pwa-サポート)

### Web Bluetooth API

BLE デバイスとの通信をサポートしました。micro:bit や Arduino などのデバイスと接続できます。

詳細: [FEATURES.md#web-bluetooth-api](FEATURES.md#web-bluetooth-api)

### 日本語対応の強化

カスタム翻訳と全角文字サポートにより、日本語環境での使いやすさが向上しました。

詳細: [FEATURES.md#日本語対応](FEATURES.md#日本語対応)

---

## ディレクトリ構造

```
docs/
├── README.md              # このファイル
├── CHANGELOG.md           # 変更履歴
├── FEATURES.md            # 機能ドキュメント
└── DEVELOPMENT.md        # デベロップメントドキュメント
```

---

## 貢献ガイド

Xcratch への貢献を歓迎します！

### 貢献の流れ

1. Issue を作成して機能提案やバグ報告
2. Fork してブランチを作成
3. コードを変更
4. テストを追加・実行
5. Pull Request を作成

### コーディング規約

- Conventional Commits に従う
- ESLint のルールに従う
- テストを書く
- ドキュメントを更新

---

## サポート

### 質問・バグ報告

- [GitHub Issues](https://github.com/xcratch/scratch-editor/issues)
- [Xcratch コミュニティ](https://xcratch.github.io/)

### リソース

- [Xcratch 公式サイト](https://xcratch.github.io/)
- [Scratch 公式サイト](https://scratch.mit.edu/)
- [Scratch Wiki](https://en.scratch-wiki.info/)

---

## ライセンス

このプロジェクトは BSD-3-Clause ライセンスの下で公開されています。

---

## 変更履歴の概要

### 統計 (コミット e7565a720ecf766fad3662768387eff3a4be2a66 以降)

- **総コミット数**: 32個 (マージコミット除く)
- **変更ファイル数**: 71ファイル
- **追加行数**: 約24,769行
- **削除行数**: 約20,127行

### 主要な変更カテゴリ

1. **新機能** (19件)
   - 拡張機能ローダー
   - PWA サポート
   - Web Bluetooth API
   - ローカルバックパック
   - など

2. **バグ修正** (7件)
   - ブロック削除時のコメント処理
   - スプライト複製時のコメントコピー
   - など

3. **UI/UX 改善** (5件)
   - Xcratch ブランディング
   - メニューバーの調整
   - など

4. **ローカライゼーション** (3件)
   - 日本語ブロック翻訳
   - 欠落翻訳の追加
   - など

5. **開発環境** (5件)
   - VSCode デバッグ設定
   - GitHub Actions ワークフロー
   - など

詳細: [CHANGELOG.md](CHANGELOG.md)

---

## 更新履歴

- **2025-12-31**: 初回作成 (コミット e7565a720ecf766fad3662768387eff3a4be2a66 以降の変更をドキュメント化)

---

最終更新: 2025-12-31
