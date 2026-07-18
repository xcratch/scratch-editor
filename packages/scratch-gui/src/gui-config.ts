import PropTypes from 'prop-types';
import {ScratchStorage} from 'scratch-storage';

import {VersionDiff} from './lib/project-diff';

export type GUIConfigFactory = () => GUIConfig;
export type ProjectId = string | number;

// Re-exported so storage implementations only need to import from gui-config.
export type {VersionDiff};

/*
 * Shared shape of a single version-history entry, used by both
 * LocalProjectStorage (IndexedDB) and WorkshopProjectStorage (server-backed
 * history). LocalProjectVersionItem is an alias of this type.
 */
export interface ProjectVersionItem {
    projectId?: string;
    timestamp: number;
    parentTimestamp?: number | null;
    thumbnail: Blob | null;
    comment?: string;
    diff?: VersionDiff;
    isKeep?: boolean;
}

export interface GUIConfig {
    storage: GUIStorage;
}

export interface GUIStorage {
    scratchStorage: ScratchStorage;

    // Called multiple times (as changes happen)
    setProjectHost?(host: string): void;
    setProjectToken?(token: string): void;
    setProjectMetadata?(projectId: string | null | undefined): void;
    setAssetHost?(host: string): void;
    setTranslatorFunction?(formatMessageFn: TranslatorFunction): void;
    setBackpackHost?(host: string): void;
    // Set by project-fetcher-hoc.jsx from the `versionTimestamp` prop (see
    // render-workshop-gui.jsx's `version` query param). When set, the storage
    // should serve that version's body instead of the project's current one.
    setVersionOverride?(timestamp: number | null): void;

    saveProject(
        projectId: ProjectId | null | undefined,
        vmState: string,
        params: {
            originalId?: ProjectId;
            isCopy?: boolean | 1;
            isRemix?: boolean | 1;
            title?: string;
        }
    ): Promise<{ id: ProjectId }>;

    saveProjectThumbnail?(projectId: ProjectId, thumbnail: Blob): void;

    // Version history (optional: implementations that don't support history,
    // e.g. plain LegacyStorage, simply omit these methods; callers must
    // feature-detect with `typeof storage.xxx === 'function'`).
    listVersions?(id: ProjectId): Promise<ProjectVersionItem[]>;
    getVersionBody?(id: ProjectId, timestamp: number): Promise<string | undefined>;
    restoreVersion?(id: ProjectId, timestamp: number, options?: {saveCurrent?: boolean}): Promise<string>;
    setVersionComment?(id: ProjectId, timestamp: number, comment: string): Promise<void>;
    setVersionKeep?(id: ProjectId, timestamp: number, isKeep: boolean): Promise<void>;
    deleteVersion?(id: ProjectId, timestamp: number): Promise<void>;
    canManageVersions?(id: ProjectId): boolean;
    getVersionPlayerUrl?(id: ProjectId, timestamp: number): string;
    getVersionEditorUrl?(id: ProjectId, timestamp: number): string;

    // Force-saves a new version with a comment and keep flag set at creation
    // time (e.g. from an extension block via runtime.saveProjectVersion).
    // Implementations that don't support history simply omit this method;
    // callers must feature-detect with `typeof storage.xxx === 'function'`.
    saveVersionWithMeta?(
        projectId: ProjectId,
        vmState: string,
        meta: {comment?: string; isKeep?: boolean}
    ): Promise<{id: ProjectId; timestamp: number}>;

    // TODO: Support backpack storage
}

export type TranslatorFunction = (
    msgObj: MessageObject,
    options?: { index: number }
) => string;

export interface MessageObject {
    id: string;
    description: string;
    defaultMessage: string;
}

export const GUIStoragePropType = PropTypes.shape({
    scratchStorage: PropTypes.object.isRequired,

    setProjectHost: PropTypes.func,
    setProjectToken: PropTypes.func,
    setProjectMetadata: PropTypes.func,
    setAssetHost: PropTypes.func,
    setTranslatorFunction: PropTypes.func,
    setBackpackHost: PropTypes.func,
    setVersionOverride: PropTypes.func,

    saveProject: PropTypes.func.isRequired,

    saveProjectThumbnail: PropTypes.func,

    listVersions: PropTypes.func,
    getVersionBody: PropTypes.func,
    restoreVersion: PropTypes.func,
    setVersionComment: PropTypes.func,
    setVersionKeep: PropTypes.func,
    deleteVersion: PropTypes.func,
    canManageVersions: PropTypes.func,
    getVersionPlayerUrl: PropTypes.func,
    getVersionEditorUrl: PropTypes.func,

    saveVersionWithMeta: PropTypes.func
});
