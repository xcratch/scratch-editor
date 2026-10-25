import PropTypes from 'prop-types';
import {ScratchStorage} from 'scratch-storage';

export type GUIConfigFactory = () => GUIConfig;
export type ProjectId = string | number;

/*
 * Space taken by browser-stored projects. Per-project bytes count only what
 * deleting that project would free: assets shared with another project are
 * excluded there but included in totalBytes.
 */
export interface StorageUsage {
    projects: Record<string, {bytes: number; versionCount: number}>;
    totalBytes: number;
    // Origin-wide figures from navigator.storage.estimate(), when available
    quota?: {usage: number; quota: number};
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

    // Browser storage housekeeping (optional; callers must feature-detect
    // with `typeof storage.xxx === 'function'`).
    // Delete every version except the newest, kept and commented ones.
    // Resolves with the number of versions deleted.
    pruneVersions?(id: ProjectId): Promise<number>;
    getStorageUsage?(): Promise<StorageUsage>;

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

    saveProject: PropTypes.func.isRequired,

    saveProjectThumbnail: PropTypes.func,

    pruneVersions: PropTypes.func,
    getStorageUsage: PropTypes.func,

    saveVersionWithMeta: PropTypes.func
});
