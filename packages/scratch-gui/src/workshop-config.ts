import {GUIConfig} from './gui-config';
import {WorkshopProjectStorage} from './lib/workshop-project-storage';

/*
 * Config factory for the workshop launch adapter (render-workshop-gui.jsx).
 * Mirrors localStorageConfigFactory in playground/render-gui.jsx, but backs
 * project/asset/version storage with the xcratch-workshop server instead of
 * IndexedDB.
 */
export const workshopConfigFactory = (): GUIConfig => ({
    storage: new WorkshopProjectStorage()
});
