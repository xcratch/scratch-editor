import {filterAndSortProjects, formatBytes} from '../../../src/lib/project-list-filter';

const projects = [
    {id: '1', name: 'Cat game', comment: '', created: 30, modified: 100},
    {id: '2', name: 'project 10', comment: 'micro:bit demo', created: 10, modified: 300},
    {id: '3', name: 'project 9', comment: '', created: 20, modified: 200}
];
const ids = list => list.map(project => project.id);

describe('filterAndSortProjects', () => {
    test('sorts by last modified by default', () => {
        expect(ids(filterAndSortProjects(projects))).toEqual(['2', '3', '1']);
    });

    test('matches name or comment case-insensitively', () => {
        expect(ids(filterAndSortProjects(projects, {query: 'CAT'}))).toEqual(['1']);
        expect(ids(filterAndSortProjects(projects, {query: ' Micro '}))).toEqual(['2']);
        expect(filterAndSortProjects(projects, {query: 'none'})).toEqual([]);
    });

    test('sorts by created date and by name with numeric ordering', () => {
        expect(ids(filterAndSortProjects(projects, {sortOrder: 'created'}))).toEqual(['1', '3', '2']);
        expect(ids(filterAndSortProjects(projects, {sortOrder: 'name'}))).toEqual(['1', '3', '2']);
    });

    test('sorts by size, falling back to modified until usage is known', () => {
        const usage = {projects: {1: {bytes: 50}, 2: {bytes: 10}, 3: {bytes: 90}}, totalBytes: 150};
        expect(ids(filterAndSortProjects(projects, {sortOrder: 'size', usage}))).toEqual(['3', '1', '2']);
        expect(ids(filterAndSortProjects(projects, {sortOrder: 'size'}))).toEqual(['2', '3', '1']);
    });

    test('does not mutate the input', () => {
        const copy = projects.slice();
        filterAndSortProjects(projects, {sortOrder: 'name'});
        expect(projects).toEqual(copy);
    });
});

describe('formatBytes', () => {
    test('formats with binary units', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
        expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
    });
});
