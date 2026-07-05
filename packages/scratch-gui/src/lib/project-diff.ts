export interface VersionDiff {
    code: boolean;
    assets: boolean;
    sprites: number;
}

export const computeVersionDiff = (oldBodyStr: string | null | undefined, newBodyStr: string): VersionDiff => {
    const diff: VersionDiff = {
        code: false,
        assets: false,
        sprites: 0
    };

    if (!oldBodyStr) {
        // もし以前のボディがなければ、すべて変更ありとして扱う
        diff.code = true;
        diff.assets = true;
        diff.sprites = 0;
        return diff;
    }

    try {
        const oldBody = JSON.parse(oldBodyStr);
        const newBody = JSON.parse(newBodyStr);

        const oldTargets = oldBody.targets || [];
        const newTargets = newBody.targets || [];

        // 1. スプライトの増減 (ステージは必ず含まれるため、全体の数で比較可能)
        diff.sprites = newTargets.length - oldTargets.length;

        // targetのマップを作成して比較しやすくする
        const oldTargetsMap = new Map();
        for (const target of oldTargets) {
            oldTargetsMap.set(target.name, target);
        }

        let codeChanged = false;
        let assetsChanged = false;

        for (const newTarget of newTargets) {
            const oldTarget = oldTargetsMap.get(newTarget.name);

            if (!oldTarget) {
                // 新しいスプライトが追加された場合、その中身も新規なので変更ありとみなす
                codeChanged = true;
                assetsChanged = true;
                continue;
            }

            // 2. コードの変更を検知 (blocks, variables, lists)
            if (!codeChanged) {
                const oldBlocks = JSON.stringify(oldTarget.blocks || {});
                const newBlocks = JSON.stringify(newTarget.blocks || {});
                const oldVars = JSON.stringify(oldTarget.variables || {});
                const newVars = JSON.stringify(newTarget.variables || {});
                const oldLists = JSON.stringify(oldTarget.lists || {});
                const newLists = JSON.stringify(newTarget.lists || {});

                if (oldBlocks !== newBlocks || oldVars !== newVars || oldLists !== newLists) {
                    codeChanged = true;
                }
            }

            // 3. 画像/音の変更を検知 (costumes, sounds)
            if (!assetsChanged) {
                const oldCostumes = JSON.stringify(oldTarget.costumes || []);
                const newCostumes = JSON.stringify(newTarget.costumes || []);
                const oldSounds = JSON.stringify(oldTarget.sounds || []);
                const newSounds = JSON.stringify(newTarget.sounds || []);

                if (oldCostumes !== newCostumes || oldSounds !== newSounds) {
                    assetsChanged = true;
                }
            }
        }

        // 削除されたターゲットの確認
        for (const oldTarget of oldTargets) {
            const newTarget = newTargets.find((t: any) => t.name === oldTarget.name);
            if (!newTarget) {
                // スプライトが削除された場合はコードとアセットに変更があったとみなす
                codeChanged = true;
                assetsChanged = true;
                break;
            }
        }

        diff.code = codeChanged;
        diff.assets = assetsChanged;

    } catch (e) {
        // パースエラーなどの場合は安全側に倒して変更ありとする
        diff.code = true;
        diff.assets = true;
    }

    return diff;
};
