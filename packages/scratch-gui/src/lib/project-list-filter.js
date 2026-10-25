/**
 * Helpers for the browser project list: search, sort and size formatting.
 */

const SORT_ORDERS = ['modified', 'created', 'name', 'size'];

const projectBytes = (usage, id) => {
    const entry = usage && usage.projects[id];
    return entry ? entry.bytes : 0;
};

/**
 * Filter projects by a case-insensitive substring of name or comment, then
 * sort them. 'size' falls back to 'modified' until usage has been measured.
 * @param {Array<object>} projects - list items ({id, name, comment, created, modified})
 * @param {object} options - filter and sort settings
 * @param {string} options.query - search text
 * @param {string} options.sortOrder - one of SORT_ORDERS
 * @param {?object} options.usage - result of storage.getStorageUsage(), or null
 * @returns {Array<object>} a new, filtered and sorted array
 */
const filterAndSortProjects = (projects, {query = '', sortOrder = 'modified', usage = null} = {}) => {
    const needle = query.trim().toLowerCase();
    const filtered = needle ?
        projects.filter(project =>
            (project.name || '').toLowerCase().includes(needle) ||
            (project.comment || '').toLowerCase().includes(needle)) :
        projects.slice();

    const order = sortOrder === 'size' && !usage ? 'modified' : sortOrder;
    const compare = {
        modified: (a, b) => b.modified - a.modified,
        created: (a, b) => (b.created || 0) - (a.created || 0),
        name: (a, b) => (a.name || '').localeCompare(b.name || '', [], {numeric: true}),
        size: (a, b) => projectBytes(usage, b.id) - projectBytes(usage, a.id)
    }[order] || ((a, b) => b.modified - a.modified);
    return filtered.sort(compare);
};

/**
 * Format a byte count as a short human-readable string (B, KB, MB, GB).
 * @param {number} bytes - size in bytes
 * @returns {string} formatted size
 */
const formatBytes = bytes => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

export {
    SORT_ORDERS,
    filterAndSortProjects,
    formatBytes
};
